/**
 * Полный сброс ТЕСТОВОЙ базы: npm run db:reset:test -w @booking/api
 * Удаляет схему базы из TEST_DATABASE_URL целиком, заново применяет миграции и загружает справочники.
 * Нужен, если тестовая база повреждена (прерванная миграция, ручные правки). Обычный прогон тестов
 * сам применяет миграции и очищает данные — сброс для него не требуется.
 *
 * Защита от запуска не на той базе:
 *  - используется только TEST_DATABASE_URL (DATABASE_URL не читается);
 *  - имя базы должно содержать «test» и не совпадать с базой DATABASE_URL;
 *  - запрещено при APP_ENV=production.
 */
import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { createPgAdapter } from '../src/common/prisma.service';
import { seedReferenceData } from '../src/seed/reference-data';

const API_ROOT = path.join(__dirname, '..');
config({ path: path.join(API_ROOT, '.env'), quiet: true });

function dbName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Проверки до любых изменений. Возвращает адрес тестовой базы и схему. */
export function resolveTarget(env: NodeJS.ProcessEnv): { url: string; schema: string; database: string } {
  if (env.APP_ENV === 'production') throw new Error('Сброс запрещён при APP_ENV=production');
  const url = env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL не задан (apps/api/.env)');
  const database = dbName(url);
  if (!/test/i.test(database)) throw new Error(`База «${database}» не похожа на тестовую: имя должно содержать «test»`);
  if (env.DATABASE_URL && (env.DATABASE_URL === url || dbName(env.DATABASE_URL) === database)) {
    throw new Error('TEST_DATABASE_URL указывает на ту же базу, что и DATABASE_URL');
  }
  const schema = new URL(url).searchParams.get('schema') ?? 'public';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error(`Недопустимое имя схемы: ${schema}`);
  return { url, schema, database };
}

async function main() {
  const { url, schema, database } = resolveTarget(process.env);
  process.stdout.write(`==> Сброс тестовой базы «${database}» (схема ${schema})\n`);

  // pg не понимает параметр schema из адреса Prisma — убираем его для прямого подключения.
  const pgUrl = new URL(url);
  pgUrl.searchParams.delete('schema');
  const pg = new Client({ connectionString: pgUrl.toString() });
  await pg.connect();
  try {
    await pg.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pg.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await pg.end();
  }

  process.stdout.write('==> Миграции\n');
  // CLI prisma запускается тем же node напрямую (без shell и npx — одинаково в Windows и Linux).
  const prismaCli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  process.stdout.write('==> Справочники\n');
  const prisma = new PrismaClient({ adapter: createPgAdapter(url) });
  try {
    await seedReferenceData(prisma);
  } finally {
    await prisma.$disconnect();
  }
  process.stdout.write(`Готово: тестовая база «${database}» пересоздана\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
