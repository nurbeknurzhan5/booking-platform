import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { generateOtpCode, hmacSha256, randomToken, safeEqualHex } from '../common/crypto';
import { getConfig } from '../config/config';
import { RateLimitService } from '../common/rate-limit.service';
import { SystemSettingsService } from '../common/system-settings.service';

export type OtpPurpose = 'login' | 'booking' | 'waitlist';

const GLOBAL_OTP_PER_HOUR = 5000;

/**
 * OTP (§10): 6 цифр из CSPRNG, хранится как HMAC-SHA256 с серверным секретом,
 * TTL 5 минут по умолчанию, ограничение попыток (атомарный счётчик), частоты отправки
 * (по номеру, по IP, глобально), одноразовость. Код никогда не логируется.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly settings: SystemSettingsService,
  ) {}

  private hash(id: string, code: string): string {
    return hmacSha256(getConfig().OTP_HMAC_SECRET, `${id}:${code}`);
  }

  /** Проверка лимитов отправки. Вызывается до создания кода. */
  async assertCanSend(phone: string, purpose: OtpPurpose, ip: string): Promise<void> {
    const s = await this.settings.get();
    const last = await this.prisma.otpCode.findFirst({
      where: { phone, purpose },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (last) {
      const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
      if (elapsed < s.otpResendCooldownSeconds) {
        throw AppError.rateLimited(s.otpResendCooldownSeconds - elapsed, 'OTP_RATE_LIMITED');
      }
    }
    await this.rateLimit.consume(`otp:phone:${phone}`, s.otpMaxPerPhonePerHour, 3600, 'OTP_RATE_LIMITED');
    await this.rateLimit.consume(`otp:ip:${ip}`, s.otpMaxPerIpPerHour, 3600, 'OTP_RATE_LIMITED');
    await this.rateLimit.consume('otp:global', GLOBAL_OTP_PER_HOUR, 3600, 'OTP_RATE_LIMITED');
  }

  /** Создаёт новый код (предыдущие активные коды этого назначения аннулируются). Возвращает код для отправки. */
  async issue(
    tx: Tx,
    /** fresh: код для только что созданного объекта — прежних кодов по нему нет, инвалидация не нужна. */
    args: { phone: string; purpose: OtpPurpose; appointmentId?: string | null; ip: string; fresh?: boolean },
  ): Promise<{ code: string; otpId: string; expiresAt: Date }> {
    const s = await this.settings.get();
    if (!(args.fresh && args.appointmentId)) {
      await tx.otpCode.updateMany({
        where: {
          phone: args.phone,
          purpose: args.purpose,
          appointmentId: args.appointmentId ?? null,
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: new Date() },
      });
    }
    const id = randomUUID();
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + s.otpTtlSeconds * 1000);
    await tx.otpCode.create({
      data: {
        id,
        phone: args.phone,
        purpose: args.purpose,
        appointmentId: args.appointmentId ?? null,
        codeHash: this.hash(id, code),
        maxAttempts: s.otpMaxAttempts,
        expiresAt,
        ip: args.ip,
      },
    });
    return { code, otpId: id, expiresAt };
  }

  /**
   * Одноразовая ссылка подтверждения (D-42) вместо кода: та же запись otp_codes, но секрет — 192 бита
   * (в базе только HMAC). Каждая выдача — новая уникальная ссылка, прежние по этому объекту аннулируются.
   * Возвращает токен для ссылки: `<id>.<секрет>`.
   */
  async issueLink(
    tx: Tx,
    args: { phone: string; purpose: OtpPurpose; appointmentId?: string | null; ip: string; fresh?: boolean; ttlSeconds?: number },
  ): Promise<{ token: string; otpId: string; expiresAt: Date }> {
    const s = await this.settings.get();
    if (!(args.fresh && args.appointmentId)) {
      await tx.otpCode.updateMany({
        where: { phone: args.phone, purpose: args.purpose, appointmentId: args.appointmentId ?? null, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: new Date() },
      });
    }
    const id = randomUUID();
    const secret = randomToken(24);
    const expiresAt = new Date(Date.now() + (args.ttlSeconds ?? s.otpTtlSeconds) * 1000);
    await tx.otpCode.create({
      data: {
        id,
        phone: args.phone,
        purpose: args.purpose,
        appointmentId: args.appointmentId ?? null,
        codeHash: this.hash(id, secret),
        maxAttempts: s.otpMaxAttempts,
        expiresAt,
        ip: args.ip,
      },
    });
    return { token: `${id}.${secret}`, otpId: id, expiresAt };
  }

  /**
   * Проверка ссылки: ищется по id, секрет сравнивается за постоянное время, ссылка гасится атомарно
   * (повторный переход по той же ссылке не сработает). Возвращает телефон и объект, к которому выдана ссылка.
   */
  async verifyLink(token: string, purpose: OtpPurpose): Promise<{ phone: string; appointmentId: string | null; otpId: string }> {
    const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,80})$/.exec(token);
    if (!m) throw AppError.badRequest('OTP_INVALID', 'Ссылка недействительна');
    const [, id, secret] = m;
    const otp = await this.prisma.otpCode.findUnique({ where: { id } });
    if (!otp || otp.purpose !== purpose) throw AppError.badRequest('OTP_INVALID', 'Ссылка недействительна');
    if (otp.consumedAt) throw AppError.badRequest('OTP_USED', 'Ссылка уже использована');
    if (otp.invalidatedAt) throw AppError.badRequest('OTP_INVALID', 'Ссылка устарела: отправлена новая');
    if (otp.expiresAt.getTime() <= Date.now()) throw AppError.badRequest('OTP_EXPIRED', 'Срок действия ссылки истёк');
    const claimed = await this.prisma.$queryRaw<Array<{ attempts: number }>>`
      UPDATE otp_codes SET attempts = attempts + 1, updated_at = now()
      WHERE id = ${otp.id}::uuid AND attempts < max_attempts AND consumed_at IS NULL AND invalidated_at IS NULL
      RETURNING attempts`;
    if (claimed.length === 0) throw new AppError('OTP_ATTEMPTS_EXCEEDED', HttpStatus.TOO_MANY_REQUESTS, 'Ссылка заблокирована, запросите новую');
    if (!safeEqualHex(otp.codeHash, this.hash(otp.id, secret!))) throw AppError.badRequest('OTP_INVALID', 'Ссылка недействительна');
    const consumed = await this.prisma.otpCode.updateMany({ where: { id: otp.id, consumedAt: null, invalidatedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw AppError.badRequest('OTP_USED', 'Ссылка уже использована');
    return { phone: otp.phone, appointmentId: otp.appointmentId, otpId: otp.id };
  }

  /**
   * Проверка кода. Попытка списывается атомарно до сравнения (защита от параллельного перебора).
   * Успешный код становится недействительным (защита от повторного использования).
   */
  async verify(args: { phone: string; purpose: OtpPurpose; code: string; appointmentId?: string | null }): Promise<void> {
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        phone: args.phone,
        purpose: args.purpose,
        appointmentId: args.appointmentId ?? null,
        consumedAt: null,
        invalidatedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw AppError.badRequest('OTP_INVALID', 'Неверный или устаревший код');
    if (otp.expiresAt.getTime() <= Date.now()) throw AppError.badRequest('OTP_EXPIRED', 'Срок действия кода истёк, запросите новый');

    const claimed = await this.prisma.$queryRaw<Array<{ attempts: number }>>`
      UPDATE otp_codes SET attempts = attempts + 1, updated_at = now()
      WHERE id = ${otp.id}::uuid AND attempts < max_attempts AND consumed_at IS NULL AND invalidated_at IS NULL
      RETURNING attempts`;
    if (claimed.length === 0) {
      throw new AppError('OTP_ATTEMPTS_EXCEEDED', HttpStatus.TOO_MANY_REQUESTS, 'Превышено число попыток, запросите новый код');
    }
    const ok = safeEqualHex(otp.codeHash, this.hash(otp.id, args.code));
    if (!ok) {
      const left = otp.maxAttempts - claimed[0]!.attempts;
      if (left <= 0) {
        await this.prisma.otpCode.update({ where: { id: otp.id }, data: { invalidatedAt: new Date() } });
        throw new AppError('OTP_ATTEMPTS_EXCEEDED', HttpStatus.TOO_MANY_REQUESTS, 'Превышено число попыток, запросите новый код');
      }
      throw AppError.badRequest('OTP_INVALID', 'Неверный код', { attemptsLeft: left });
    }
    const consumed = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null, invalidatedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw AppError.badRequest('OTP_INVALID', 'Код уже использован');
  }

  async cleanup(): Promise<number> {
    const r = await this.prisma.otpCode.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 24 * 3600_000) } } });
    return r.count;
  }
}
