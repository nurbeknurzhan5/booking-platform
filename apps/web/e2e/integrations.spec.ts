import { expect, test } from '@playwright/test';
import { OWNER_STATE } from './global-setup';
import { ownerOrgId } from './owner';

test.use({ storageState: OWNER_STATE });

/** Раздел «Интеграции» кабинета владельца (§18.3): состояние каналов, доставка, карта филиалов. */
test('владелец видит состояние интеграций организации', async ({ page }) => {
  const orgId = await ownerOrgId(page);
  await page.goto(`/dashboard/${orgId}/integrations`);
  await expect(page.getByRole('heading', { name: 'Интеграции' })).toBeVisible();
  await expect(page.getByText('WhatsApp Business Platform')).toBeVisible();
  // локальная среда работает через dev_inbox
  await expect(page.getByText(/Тестовая среда/)).toBeVisible();
  await expect(page.getByTestId('delivery').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Салон/ }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'горизонтальная прокрутка (§25)').toBeLessThanOrEqual(1);
});
