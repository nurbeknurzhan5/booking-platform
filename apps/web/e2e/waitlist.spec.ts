import { expect, test, type APIRequestContext } from '@playwright/test';
import { OWNER_STATE } from './global-setup';
import { csrfHeader, ownerOrgId } from './owner';

/**
 * Лист ожидания (ТЗ §9): владелец включает функцию → клиент встаёт в очередь из формы записи →
 * другой клиент отменяет запись → воркер присылает предложение → клиент записывается по ссылке.
 */
const SLUG = 'demo-salon';
const API = '/api/v1';

function uniquePhone(prefix: string): string {
  return `${prefix}${String((Date.now() + Math.floor(Math.random() * 1000)) % 10_000_000).padStart(7, '0')}`;
}

async function inbox(request: APIRequestContext, phone: string, type: string, timeoutMs = 60_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await request.get(`${API}/dev/inbox?phone=${encodeURIComponent(phone)}`);
    const list = (await r.json()) as Array<{ type: string; text: string }>;
    const m = list.find((x) => x.type === type);
    if (m) return m.text;
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`${type} not delivered to ${phone}`);
}

test.use({ storageState: OWNER_STATE });

function isoDate(daysAhead: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date(Date.now() + daysAhead * 86400_000));
}

test('лист ожидания: очередь → освобождение времени → предложение → запись', async ({ page, playwright, baseURL }) => {
  // Действия клиентов — в отдельном контексте без сессии владельца (иначе изменяющие запросы требуют CSRF).
  const request = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  test.setTimeout(180_000);
  const day = isoDate(2);

  // 1. Владелец включает лист ожидания в правилах записи филиала; прежние заявки демо-филиала снимаются.
  const orgId = await ownerOrgId(page);
  const branches = (await (await page.request.get(`${API}/organizations/${orgId}/branches`)).json()) as Array<{ id: string; slug: string }>;
  const branchId = branches.find((b) => b.slug === SLUG)!.id;
  const headers = await csrfHeader(page);
  const active = (await (await page.request.get(`${API}/organizations/${orgId}/waitlist?branchId=${branchId}&status=active&pageSize=100`)).json()) as { items: Array<{ id: string }> };
  for (const e of active.items) {
    await page.request.post(`${API}/organizations/${orgId}/waitlist/${e.id}/cancel`, { headers, data: {} });
  }
  await page.goto(`/dashboard/${orgId}/branches/${branchId}`);
  await page.getByRole('button', { name: 'Правила бронирования' }).click();
  await page.getByLabel('Вести лист ожидания').check();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();
  await page.context().clearCookies();

  // 2. Клиент встаёт в лист ожидания из формы записи (стрижка у Болата на выбранный день).
  const waiter = uniquePhone('+7707');
  await page.goto(`/ru/b/${SLUG}/book`);
  await page.getByText('Мужская стрижка').click();
  await page.getByTestId('next').click();
  await page.getByRole('button', { name: /Болат/ }).click();
  await page.getByTestId('next').click();
  await page.getByTestId('waitlist-open').click();
  await page.getByTestId('wl-from').fill(day);
  await page.getByTestId('wl-to').fill(day);
  await page.getByTestId('wl-name').fill('Ожидающий Клиент');
  await page.getByTestId('wl-phone').fill(waiter);
  await page.getByTestId('wl-consent').check();
  await page.waitForTimeout(1600);
  await page.getByTestId('wl-get-code').click();
  await expect(page.getByTestId('wl-otp')).toBeVisible();
  await page.getByTestId('wl-otp').fill(/(\d{6})/.exec(await inbox(request, waiter, 'otp'))![1]!);
  await page.getByTestId('wl-confirm').click();
  await expect(page.getByTestId('waitlist-done')).toBeVisible();

  // 3. Другой клиент записывается к Болату на этот день и отменяет запись — время освобождается.
  const pub = (await (await request.get(`${API}/public/pages/${SLUG}`)).json()) as {
    services: Array<{ id: string; name: string }>;
    specialists: Array<{ id: string; name: string }>;
  };
  const serviceId = pub.services.find((s) => s.name === 'Мужская стрижка')!.id;
  const specialistId = pub.specialists.find((s) => s.name.includes('Болат'))!.id;
  const items = [{ serviceId, specialistId }];
  const avRes = await request.post(`${API}/public/branches/${SLUG}/availability`, { data: { date: day, items } });
  expect(avRes.status(), await avRes.text()).toBe(200);
  const slots = (await avRes.json()) as { slots: Array<{ startAt: string }> };
  const startAt = slots.slots[Math.floor(slots.slots.length / 2)]!.startAt;
  const other = uniquePhone('+7708');
  const hold = await request.post(`${API}/public/branches/${SLUG}/bookings`, { data: { startAt, items, client: { name: 'Отменяющий', phone: other }, consents: { personalData: true } } });
  expect(hold.status()).toBe(201);
  const h = (await hold.json()) as { appointmentId: string; holdToken: string };
  const code = /(\d{6})/.exec(await inbox(request, other, 'otp'))![1]!;
  const confirmed = (await (await request.post(`${API}/public/bookings/${h.appointmentId}/confirm`, { data: { holdToken: h.holdToken, code } })).json()) as { manageToken: string };
  expect((await request.post(`${API}/public/manage/${confirmed.manageToken}/cancel`, { data: {} })).status()).toBe(200);

  // 4. Воркер присылает предложение; клиент открывает ссылку и записывается.
  const offerText = await inbox(request, waiter, 'waitlist_offer', 90_000);
  const token = /\/waitlist\/([A-Za-z0-9_-]{20,})/.exec(offerText)![1]!;
  await page.goto(`/ru/waitlist/${token}`);
  await expect(page.getByTestId('offer-card')).toContainText('Мужская стрижка');
  await page.getByTestId('offer-accept').click();
  await expect(page).toHaveURL(/\/ru\/manage\//);
  await expect(page.getByTestId('appointment-status')).toHaveText('Подтверждена');
  const manageToken = /\/manage\/([A-Za-z0-9_-]+)/.exec(page.url())![1]!;

  // Повторное открытие ссылки: предложение уже использовано.
  await page.goto(`/ru/waitlist/${token}`);
  await expect(page.getByTestId('offer-status')).toHaveText('Вы уже записаны по этому предложению.');

  // Уборка: запись отменяется, чтобы повторные прогоны не занимали время Болата в демо-филиале.
  expect((await request.post(`${API}/public/manage/${manageToken}/cancel`, { data: {} })).status()).toBe(200);
  await request.dispose();
});
