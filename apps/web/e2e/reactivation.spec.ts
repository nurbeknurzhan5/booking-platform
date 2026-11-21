import { expect, test } from '@playwright/test';

/**
 * Реактивация (ТЗ §15.1, D-34): владелец включает напоминания о повторном визите в настройках организации.
 * Правила отбора и отправки проверяются integration-тестами (whatsapp-inbound.int.ts).
 */
const API = '/api/v1';

test('владелец включает реактивацию и задаёт срок; некорректный срок не сохраняется', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('email').fill('owner@demo.kz');
  await page.getByTestId('password').fill('DemoOwner12345');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard\/[0-9a-f-]{36}/);
  const orgId = /\/dashboard\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const settingsUrl = `${API}/organizations/${orgId}/notification-settings`;
  const before = await (await page.request.get(settingsUrl)).json();

  try {
    await page.goto(`/dashboard/${orgId}/settings`);
    await page.getByRole('button', { name: 'Уведомления', exact: true }).click();
    await expect(page.getByTestId('reactivation-days')).toBeDisabled();
    await page.getByTestId('reactivation-enabled').check();

    // меньше 30 дней — ошибка проверки на сервере
    await page.getByTestId('reactivation-days').fill('10');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByTestId('notification-settings-error')).toBeVisible();
    expect((await (await page.request.get(settingsUrl)).json()).reactivationEnabled).toBe(before.reactivationEnabled);

    await page.getByTestId('reactivation-days').fill('45');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Сохранено')).toBeVisible();
    const after = await (await page.request.get(settingsUrl)).json();
    expect(after).toMatchObject({ reactivationEnabled: true, reactivationDays: 45 });
  } finally {
    // вернуть демо-организации прежние настройки
    const csrf = (await page.context().cookies()).find((c) => c.name === 'bk_csrf')!.value;
    await page.request.put(settingsUrl, { headers: { 'X-CSRF-Token': csrf }, data: before });
  }
});
