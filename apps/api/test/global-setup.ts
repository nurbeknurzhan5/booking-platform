import { execSync } from 'node:child_process';
import path from 'node:path';
import { config } from 'dotenv';

/** Применяет миграции к тестовой БД перед запуском тестов. */
export default async function globalSetup(): Promise<void> {
  const root = path.join(__dirname, '..');
  config({ path: path.join(root, '.env'), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL не задан');
  execSync('npx prisma migrate deploy', {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
