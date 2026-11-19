import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { decrypt, encrypt } from '../common/crypto';
import { getConfig } from '../config/config';

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

@Injectable()
export class MfaService {
  constructor() {
    authenticator.options = { window: 1, step: 30, digits: 6 };
  }

  generateSecret(): { secret: string; secretEnc: string } {
    const secret = authenticator.generateSecret(20);
    return { secret, secretEnc: encrypt(getConfig().ENCRYPTION_KEY, secret) };
  }

  keyUri(account: string, secret: string): string {
    return authenticator.keyuri(account, 'BookingPlatform', secret);
  }

  verify(secretEnc: string | null, code: string | undefined): boolean {
    if (!secretEnc || !code || !/^\d{6}$/.test(code)) return false;
    try {
      const secret = decrypt(getConfig().ENCRYPTION_KEY, secretEnc);
      return authenticator.check(code, secret);
    } catch {
      return false;
    }
  }

  /** Для тестов: текущий код по зашифрованному секрету. */
  currentCode(secretEnc: string): string {
    return authenticator.generate(decrypt(getConfig().ENCRYPTION_KEY, secretEnc));
  }
}
