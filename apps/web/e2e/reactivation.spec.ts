import { expect, test } from '@playwright/test';
import { OWNER_STATE } from './global-setup';
import { csrfHeader, ownerOrgId } from './owner';

test.use({ storageState: OWNER_STATE });

/**
 * Реактивация (ТЗ §15.1, D-34): владелец включает напоминания о повторном визите в настройках организации.
 * Правила отбора и отправки проверяются integration-тестами (whatsapp-inbound.int.ts).
 */
const API = '/api/v1';

test('владелец включает реактивацию и задаёт срок; некорректный срок не сохраняется', async ({ page }) => {
  const orgId = await ownerOrgId(page);
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
    await page.request.put(settingsUrl, { headers: await csrfHeader(page), data: before });
  }
});
