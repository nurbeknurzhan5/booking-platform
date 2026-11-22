import { expect, test, type Page } from '@playwright/test';
import { OWNER_STATE } from './global-setup';
import { csrfHeader, ownerOrgId } from './owner';
import { confirmViaTestPhone } from './link';

/**
 * Путь владельца целиком через интерфейс (ТЗ §3.3, §4–8, §13):
 * новый филиал → услуга → специалист → расписание → публикация страницы → первая онлайн-запись клиентом → уборка.
 * Только на ноутбуке и телефоне: каждый прогон временно занимает место в лимите филиалов демо-организации.
 */
test.use({ storageState: OWNER_STATE });
const API = '/api/v1';


/** Архивирует филиалы, оставшиеся от прерванных прогонов (slug начинается с e2e-onb-). */
async function cleanupLeftovers(page: Page, orgId: string) {
  const headers = await csrfHeader(page);
  const branches = (await (await page.request.get(`${API}/organizations/${orgId}/branches`)).json()) as Array<{ id: string; slug: string }>;
  for (const b of branches.filter((x) => x.slug.startsWith('e2e-onb-'))) {
    const appts = (await (await page.request.get(`${API}/organizations/${orgId}/appointments?branchId=${b.id}&status=confirmed,pending_otp&pageSize=100`)).json()) as { items: Array<{ id: string }> };
    for (const a of appts.items ?? []) await page.request.post(`${API}/organizations/${orgId}/appointments/${a.id}/status`, { headers, data: { status: 'cancelled_by_admin', reason: 'e2e cleanup' } });
    await page.request.delete(`${API}/organizations/${orgId}/branches/${b.id}`, { headers });
  }
  await archiveTestServices(page, orgId);
}

/** Тестовые услуги «E2E Стрижка …» архивируются, чтобы не копиться в демо-организации. */
async function archiveTestServices(page: Page, orgId: string) {
  const headers = await csrfHeader(page);
  const services = (await (await page.request.get(`${API}/organizations/${orgId}/services`)).json()) as Array<{ id: string; name: string }>;
  for (const s of services.filter((x) => x.name.startsWith('E2E Стрижка'))) await page.request.delete(`${API}/organizations/${orgId}/services/${s.id}`, { headers });
}

test('владелец настраивает новый филиал с нуля, клиент записывается на опубликованной странице', async ({ page }, info) => {
  test.skip(!['desktop', 'mobile'].includes(info.project.name), 'достаточно ноутбука и телефона');
  test.setTimeout(180_000);
  const orgId = await ownerOrgId(page);
  await cleanupLeftovers(page, orgId);
  const suffix = `${info.project.name}-${Date.now() % 1_000_000}`;
  const branchName = `E2E Филиал ${suffix}`;
  const slug = `e2e-onb-${suffix}`;
  const serviceName = `E2E Стрижка ${suffix}`;
  const masterName = `E2E Мастер ${suffix}`;
  page.on('dialog', (d) => void d.accept());

  // 1. Новый филиал
  await page.goto(`/dashboard/${orgId}/branches`);
  await page.getByTestId('add-branch').click();
  const branchDialog = page.getByRole('dialog');
  await branchDialog.getByLabel('Название', { exact: true }).fill(branchName);
  await branchDialog.getByLabel('Адрес', { exact: true }).fill('Алматы, ул. Тестовая, 1');
  await branchDialog.getByRole('textbox', { name: /^Постоянная ссылка/ }).fill(slug);
  await branchDialog.getByRole('button', { name: 'Создать' }).click();
  await expect(branchDialog).toBeHidden();
  await page.getByRole('link', { name: new RegExp(branchName) }).click();
  await expect(page.getByRole('heading', { level: 1, name: branchName })).toBeVisible();
  const branchId = /\/branches\/([0-9a-f-]{36})/.exec(page.url())![1]!;

  // 2. Услуга в этом филиале (выбранный филиал подставляется автоматически)
  await page.goto(`/dashboard/${orgId}/services`);
  await page.getByTestId('add-service').click();
  const svcDialog = page.getByRole('dialog');
  await page.getByTestId('service-name').fill(serviceName);
  await page.getByTestId('service-price').fill('4500');
  await expect(svcDialog.getByLabel(branchName)).toBeChecked();
  await page.getByTestId('save-service').click();
  await expect(svcDialog).toBeHidden();
  await expect(page.getByText(serviceName)).toBeVisible();

  // 3. Специалист с этой услугой
  await page.goto(`/dashboard/${orgId}/branches/${branchId}`);
  await page.getByRole('button', { name: 'Специалисты', exact: true }).click();
  await page.getByRole('button', { name: '+ Добавить' }).click();
  const spDialog = page.getByRole('dialog');
  await spDialog.getByLabel('Имя', { exact: true }).fill(masterName);
  await spDialog.getByLabel(serviceName).check();
  await spDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(spDialog).toBeHidden();
  await expect(page.getByText(masterName)).toBeVisible();

  // 4. Расписание филиала: понедельник 10:00–20:00 и копирование на все дни
  await page.getByRole('button', { name: 'Расписание', exact: true }).click();
  await page.getByTestId('add-interval-1').click();
  await page.getByTestId('copy-monday').click();
  await page.getByTestId('save-schedule').click();
  await expect(page.getByText('Сохранено')).toBeVisible();

  // 4а. Режим смен: без смен записи нет; заполнение по недельному графику (задача 21)
  await page.goto(`/dashboard/${orgId}/schedule`);
  await page.getByTestId('switch-schedule-mode').click();
  await expect(page.getByTestId('tomorrow-not-filled')).toBeVisible();
  await page.getByTestId('fill-weekly').click();
  await expect(page.getByTestId('tomorrow-not-filled')).toBeHidden();
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date(Date.now() + 86400_000));
  await expect(page.getByTestId(`shift-${masterName}-${tomorrow}`)).toContainText('10:00');

  // 5. Публикация страницы
  await page.goto(`/dashboard/${orgId}/branches/${branchId}/page-editor`);
  await page.getByTestId('page-title').fill(branchName);
  await page.getByTestId('publish').click();
  await expect(page.getByText('Опубликовано').first()).toBeVisible();

  // 6. Клиент записывается на опубликованной странице (новый контекст без сессии владельца)
  const client = await page.context().browser()!.newContext({ ...info.project.use, storageState: { cookies: [], origins: [] } });
  const cp = await client.newPage();
  const phone = `+7706${String(Date.now() % 10_000_000).padStart(7, '0')}`;
  await cp.goto(`/ru/b/${slug}`);
  await expect(cp.getByRole('heading', { level: 1 })).toContainText(branchName);
  await cp.getByTestId('book-button').first().click();
  await expect(cp).toHaveURL(new RegExp(`/ru/b/${slug}/book`));
  await expect(cp.getByTestId('pick-service-first')).toBeVisible();
  await cp.getByText(serviceName).click();
  await cp.getByRole('button', { name: new RegExp(masterName) }).click();
  await cp.locator('[data-testid^="date-"]').nth(1).click();
  await cp.getByTestId('slot').first().click();
  await cp.getByTestId('next').click();
  await cp.getByTestId('name').fill('Первый Клиент');
  await cp.getByTestId('phone').fill(phone);
  await cp.getByTestId('consent').check();
  await cp.waitForTimeout(1600);
  await cp.getByTestId('get-code').click();
  await confirmViaTestPhone(cp, phone);
  await expect(cp.getByTestId('booking-done')).toBeVisible();
  await expect(cp.getByTestId('booking-done')).toContainText(serviceName);
  await client.close();

  // 6а. Снять мастера со смены на день записи — предупреждение со списком записей, затем подтверждение
  await page.goto(`/dashboard/${orgId}/schedule`);
  await page.getByTestId(`shift-${masterName}-${tomorrow}`).click();
  await page.getByTestId('shift-remove').click();
  await expect(page.getByTestId('shift-conflicts')).toContainText('Первый Клиент');
  await page.getByTestId('shift-force').click();
  await expect(page.getByTestId(`shift-${masterName}-${tomorrow}`)).toHaveText('—');
  await expect(page.getByText('Есть записи вне смен').first()).toBeVisible();

  // 7. Запись видна владельцу; уборка: отмена записи и архивация филиала через интерфейс
  const appts = (await (await page.request.get(`${API}/organizations/${orgId}/appointments?branchId=${branchId}&status=confirmed&pageSize=10`)).json()) as { items: Array<{ id: string; client: { phone: string } }> };
  expect(appts.items.map((a) => a.client.phone)).toContain(phone);
  const headers = await csrfHeader(page);
  for (const a of appts.items) {
    expect((await page.request.post(`${API}/organizations/${orgId}/appointments/${a.id}/status`, { headers, data: { status: 'cancelled_by_admin', reason: 'e2e cleanup' } })).status()).toBe(200);
  }
  await page.goto(`/dashboard/${orgId}/branches/${branchId}`);
  await page.getByTestId('archive-branch').click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/${orgId}/branches$`));
  await expect(page.getByText(branchName)).toHaveCount(0);
  // страница архивированного филиала сразу недоступна
  expect((await page.request.get(`/ru/b/${slug}`)).status()).toBe(404);
  await archiveTestServices(page, orgId);
});
