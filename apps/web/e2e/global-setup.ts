import { request, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Файл сессии владельца демо-организации (в .gitignore). */
export const OWNER_STATE = 'e2e/.auth/owner.json';

/**
 * Владелец входит один раз на весь прогон. Вход сотрудника ограничен 30 попытками за 15 минут с IP,
 * а 4 профиля устройств × несколько сценариев упираются в этот лимит. Ослаблять лимит ради тестов нельзя.
 * Сам вход через форму проверяет отдельный сценарий client-booking.spec.ts.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const ctx = await request.newContext({ baseURL });
  // Сценарии подтверждают запись через «Тестовый телефон»: он есть только при явном флаге (сборка сайта и API).
  const phone = await ctx.get('/dev/phone');
  if (phone.status() !== 200) {
    throw new Error(`«Тестовый телефон» недоступен (/dev/phone → ${phone.status()}): соберите сайт с NEXT_PUBLIC_DEV_INBOX_ENABLED=true и запустите API с DEV_INBOX_ENABLED=true`);
  }
  const csrf = (await (await ctx.get('/api/v1/auth/csrf')).json()) as { csrfToken: string };
  const r = await ctx.post('/api/v1/auth/staff/login', {
    headers: { 'X-CSRF-Token': csrf.csrfToken },
    data: { email: 'owner@demo.kz', password: 'DemoOwner12345' },
  });
  if (!r.ok()) throw new Error(`Вход владельца демо-организации не удался: ${r.status()} ${await r.text()}`);
  mkdirSync(dirname(OWNER_STATE), { recursive: true });
  await ctx.storageState({ path: OWNER_STATE });
  await ctx.dispose();
}
