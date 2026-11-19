/**
 * Создание (или сброс MFA) суперадминистратора.
 * Использование: npm run superadmin:create -w @booking/api -- --email admin@example.kz --name "Имя"
 * Пароль запрашивается из переменной SUPERADMIN_PASSWORD (не передавайте пароль аргументом — он попадёт в историю shell).
 * Выводит otpauth-URI для приложения-аутентификатора (Google Authenticator, Aegis и т.п.).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { PrismaClient } from '../src/generated/prisma/client';
import { encrypt } from '../src/common/crypto';
import { loadConfig } from '../src/config/config';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cfg = loadConfig();
  const email = arg('email')?.toLowerCase();
  const name = arg('name') ?? 'Суперадминистратор';
  const password = process.env.SUPERADMIN_PASSWORD;
  if (!email) throw new Error('Укажите --email');
  if (!password || password.length < 12) throw new Error('Задайте SUPERADMIN_PASSWORD (минимум 12 символов)');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: cfg.DATABASE_URL }) });
  try {
    const secret = authenticator.generateSecret(20);
    const data = {
      name,
      isSuperadmin: true,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      mfaSecretEnc: encrypt(cfg.ENCRYPTION_KEY, secret),
      mfaEnabled: true,
      mustChangePassword: false,
    };
    const user = await prisma.user.upsert({ where: { email }, create: { email, ...data }, update: data });
    await prisma.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await prisma.auditLog.create({
      data: { actorType: 'system', action: 'superadmin.provisioned', entityType: 'user', entityId: user.id },
    });
    // eslint-disable-next-line no-console
    console.log(`Суперадминистратор: ${email}\nДобавьте в приложение-аутентификатор:\n${authenticator.keyuri(email, 'BookingPlatform', secret)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
