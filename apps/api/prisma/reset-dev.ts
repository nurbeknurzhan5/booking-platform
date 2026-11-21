/**
 * Сброс БД разработки к чистым демо-данным: npm run db:reset:dev -w @booking/api -- --yes
 * Удаляет ВСЕ данные (организации, записи, клиентов, журналы), загружает справочники и демо-организацию.
 * Учётные записи суперадминистраторов сохраняются вместе с паролем и MFA.
 * В production запрещено: проверяются APP_ENV и флаг --yes.
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { createPgAdapter } from '../src/common/prisma.service';
import { seedReferenceData } from '../src/seed/reference-data';
import { seedDemoData } from '../src/seed/demo-data';

async function main() {
  if (process.env.APP_ENV === 'production') throw new Error('Сброс запрещён в production (APP_ENV=production)');
  if (!process.argv.includes('--yes')) throw new Error('Все данные будут удалены. Запустите с флагом --yes');
  const prisma = new PrismaClient({ adapter: createPgAdapter(process.env.DATABASE_URL!) });
  try {
    const admins = await prisma.user.findMany({ where: { isSuperadmin: true } });
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    // TRUNCATE не вызывает построчные триггеры append-only
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    for (const a of admins) await prisma.user.create({ data: { ...a, failedLoginCount: 0, lockedUntil: null } });
    await seedReferenceData(prisma);
    await seedDemoData(prisma);
    // eslint-disable-next-line no-console
    console.log(`Готово: демо-данные загружены, суперадминистраторов сохранено: ${admins.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
