import { expect, type Page } from '@playwright/test';

/**
 * Подтверждение записи по ссылке (D-42) через «Тестовый телефон» (/dev/phone): клиент открывает сообщение,
 * переходит по ссылке, запись подтверждается. Возвращает страницу подтверждения (на ней ссылка управления).
 */
export async function confirmViaTestPhone(page: Page, phone: string): Promise<Page> {
  // форма записи показывает ожидание и ссылку на «Тестовый телефон»
  await expect(page.getByTestId('link-sent')).toBeVisible();
  await expect(page.getByTestId('test-mode')).toBeVisible();
  const phonePage = await page.context().newPage();
  await phonePage.goto(`/dev/phone?phone=${encodeURIComponent(phone)}`);
  const link = phonePage.getByTestId('phone-messages').getByTestId('phone-link').last();
  await expect(link).toBeVisible({ timeout: 60_000 });
  const href = new URL((await link.getAttribute('href'))!);
  await phonePage.close();
  const confirmPage = await page.context().newPage();
  await confirmPage.goto(href.pathname);
  await expect(confirmPage.getByTestId('confirm-ok')).toBeVisible();
  return confirmPage;
}
