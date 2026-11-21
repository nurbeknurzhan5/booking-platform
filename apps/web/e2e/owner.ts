import { expect, type Page } from '@playwright/test';

/** id демо-организации владельца (сессия из global-setup). */
export async function ownerOrgId(page: Page): Promise<string> {
  const r = await page.request.get('/api/v1/auth/me');
  expect(r.status(), 'сессия владельца из global-setup').toBe(200);
  const me = (await r.json()) as { memberships: Array<{ organizationId: string; role: string }> };
  return me.memberships.find((m) => m.role === 'OWNER')!.organizationId;
}

/** CSRF-токен текущей сессии для прямых изменяющих запросов. */
export async function csrfHeader(page: Page): Promise<Record<string, string>> {
  const c = (await page.context().cookies()).find((x) => x.name === 'bk_csrf');
  return c ? { 'X-CSRF-Token': c.value } : {};
}
