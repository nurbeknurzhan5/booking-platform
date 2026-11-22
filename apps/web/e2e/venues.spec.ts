import { expect, test } from '@playwright/test';
import { confirmViaTestPhone } from './link';

/**
 * Демо-площадки (задача 22): компьютерный клуб и банный комплекс. Места и залы видны на странице,
 * запись на место без мастера проходит целиком (шаг выбора специалиста пропускается).
 */

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
  const confirmPage = await confirmViaTestPhone(page, phone);
  await expect(page.getByTestId('booking-done')).toContainText('ПК VIP');
  await confirmPage.getByTestId('manage-link').click();
  confirmPage.once('dialog', (d) => d.accept());
  await confirmPage.getByTestId('cancel').click();
  await expect(confirmPage.getByTestId('appointment-status')).toHaveText('Отменена вами');
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

test('компьютерный клуб: компания бронирует три ПК рядом одной записью', async ({ page }, info) => {
  // публичные резервы с одного IP ограничены (15 за 10 мин) — сценарий проверяется на ноутбуке и телефоне
  test.skip(!['desktop', 'mobile'].includes(info.project.name), 'достаточно ноутбука и телефона');
  await page.goto('/ru/b/demo-club/book');
  await page.getByText('ПК Стандарт · 1 час', { exact: true }).click();
  // выбор количества мест виден только для услуг-мест без мастера
  await expect(page.getByTestId('seats-block')).toBeVisible();
  await page.getByTestId('seats-plus').click();
  await page.getByTestId('seats-plus').click();
  await expect(page.getByTestId('seats-value')).toHaveText('3');
  await expect(page.getByTestId('seats-together')).toBeChecked();
  await page.locator('[data-testid^="date-"]').nth(3).click();
  await page.getByTestId('slot').last().click();
  await page.getByTestId('next').click();
  const phone = `+7703${String(Date.now() % 10_000_000).padStart(7, '0')}`;
  await page.getByTestId('name').fill('Компания');
  await page.getByTestId('phone').fill(phone);
  await page.getByTestId('consent').check();
  await page.waitForTimeout(1600);
  await page.getByTestId('get-code').click();
  // цена × 3, места подряд
  await expect(page.getByTestId('link-sent')).toContainText('2 400');
  const confirmPage = await confirmViaTestPhone(page, phone);
  await expect(confirmPage.getByTestId('confirm-ok')).toContainText('× 3');
  await expect(confirmPage.getByTestId('confirm-ok')).toContainText(/ПК Стандарт (\d), ПК Стандарт (\d), ПК Стандарт (\d)/);
  await confirmPage.getByTestId('manage-link').click();
  confirmPage.once('dialog', (d) => d.accept());
  await confirmPage.getByTestId('cancel').click();
  await expect(confirmPage.getByTestId('appointment-status')).toHaveText('Отменена вами');
});
