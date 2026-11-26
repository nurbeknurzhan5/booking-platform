import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { decrypt, encrypt } from '../common/crypto';
import { getConfig } from '../config/config';
import { PrismaService } from '../common/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';
import { AppError } from '../common/errors';

/** Хранение паролей (argon2id) и TOTP-секретов (зашифрованы AES-256-GCM). */
@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }

  async verify(hash: string | null, password: string): Promise<boolean> {
    if (!hash) {
      // Выравнивание времени ответа, чтобы не раскрывать существование учётной записи.
      await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
      return false;
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}

const TOTP_STEP_SEC = 30;
const TOTP_OPTIONS = { window: 1, step: TOTP_STEP_SEC, digits: 6 } as const;
/** Неверных TOTP-кодов на пользователя (вход + подтверждение действий) за окно, после чего — 429. */
export const MFA_MAX_FAILURES = 10;
export const MFA_FAILURE_WINDOW_SEC = 900;

/**
 * TOTP (§22): лимит неверных попыток на пользователя (rate limit на PostgreSQL, общий для входа и step-up)
 * и защита от повторного использования кода — принимается только временной шаг новее последнего принятого.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  generateSecret(): { secret: string; secretEnc: string } {
    const secret = authenticator.generateSecret(20);
    return { secret, secretEnc: encrypt(getConfig().ENCRYPTION_KEY, secret) };
  }

  keyUri(account: string, secret: string): string {
    return authenticator.keyuri(account, 'BookingPlatform', secret);
  }

  /** Временной шаг, которому соответствует код (с допуском ±1 шаг), или null. Без побочных эффектов. */
  matchStep(secretEnc: string | null, code: string | undefined, now = Date.now()): number | null {
    if (!secretEnc || !code || !/^\d{6}$/.test(code)) return null;
    try {
      const secret = decrypt(getConfig().ENCRYPTION_KEY, secretEnc);
      const delta = authenticator.clone({ ...TOTP_OPTIONS, epoch: now }).checkDelta(code, secret);
      return delta === null ? null : Math.floor(now / 1000 / TOTP_STEP_SEC) + delta;
    } catch {
      return null;
    }
  }

  /**
   * Проверка TOTP-кода пользователя: лимит неверных попыток → 429 RATE_LIMITED; неверный или уже
   * использованный код → `invalid()`. Попытка списывается атомарно до проверки (параллельный перебор
   * не обходит лимит), успешная — возвращается в счётчик.
   */
  async verifyForUser(userId: string, secretEnc: string | null, code: string | undefined, invalid: (message?: string) => AppError): Promise<void> {
    const key = `mfa:user:${userId}`;
    const hit = await this.rateLimit.hit(key, MFA_MAX_FAILURES, MFA_FAILURE_WINDOW_SEC);
    if (!hit.allowed) throw AppError.rateLimited(hit.retryAfterSec);
    const step = this.matchStep(secretEnc, code);
    if (step === null) throw invalid();
    // Атомарно: код принимается, только если его шаг новее последнего принятого (повтор перехваченного кода).
    const claimed = await this.prisma.user.updateMany({
      where: { id: userId, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
      data: { mfaLastUsedStep: step },
    });
    if (claimed.count !== 1) {
      throw invalid('Код уже использован, дождитесь следующего кода в приложении');
    }
    await this.rateLimit.refund(key);
  }
}
