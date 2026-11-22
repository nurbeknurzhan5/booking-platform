import { expect, test, type Page } from '@playwright/test';

/**
 * Демо-площадки (задача 22): компьютерный клуб и банный комплекс. Места и залы видны на странице,
 * запись на место без мастера проходит целиком (шаг выбора специалиста пропускается).
 */
async function otpFor(page: Page, phone: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const list = (await (await page.request.get(`/api/v1/dev/inbox?phone=${encodeURIComponent(phone)}`)).json()) as Array<{ type: string; text: string }>;
    const otp = list.find((m) => m.type === 'otp');
    if (otp) return /(\d{6})/.exec(otp.text)![1]!;
    await page.waitForTimeout(500);
  }
  throw new Error('OTP not delivered');
}

test('компьютерный клуб: места и тарифы на странице, запись на VIP-ПК и отмена', async ({ page }) => {
  await page.goto('/ru/b/demo-club');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Пиксель');
  const resources = page.getByTestId('public-resources');
  await expect(resources).toContainText('ПК Стандарт');
  await expect(resources).toContainText('6 мест');
  await expect(resources).toContainText('RTX 4080');
  await expect(resources).toContainText('Зал PlayStation 5');

  await page.getByTestId('book-button').first().click();
  await expect(page).toHaveURL(/\/ru\/b\/demo-club\/book/);
  await page.getByText('ПК VIP · 1 час', { exact: true }).click();
  // мастеров у клуба нет — блока выбора специалиста на странице нет, сразу дата и время
  await expect(page.getByTestId('specialists-row')).toHaveCount(0);
  await page.locator('[data-testid^="date-"]').nth(1).click();
  await page.getByTestId('slot').first().click();
  await page.getByTestId('next').click();
  const phone = `+7702${String(Date.now() % 10_000_000).padStart(7, '0')}`;
  await page.getByTestId('name').fill('Игрок');
  await page.getByTestId('phone').fill(phone);
  await page.getByTestId('consent').check();
  await page.waitForTimeout(1600);
  await page.getByTestId('get-code').click();
  await page.getByTestId('otp').fill(await otpFor(page, phone));
  await page.getByTestId('confirm').click();
  await expect(page.getByTestId('booking-done')).toContainText('ПК VIP');
  await page.getByTestId('manage-link').click();
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('cancel').click();
  await expect(page.getByTestId('appointment-status')).toHaveText('Отменена вами');
});

test('банный комплекс: залы с фото и ценами, без горизонтальной прокрутки', async ({ page }) => {
  await page.goto('/ru/b/demo-sauna');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Тёплый берег');
  const resources = page.getByTestId('public-resources');
  for (const name of ['Финская сауна', 'Русская баня на дровах', 'Хаммам']) await expect(resources).toContainText(name);
  await expect(resources.locator('img')).toHaveCount(3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
