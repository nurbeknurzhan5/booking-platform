import { expect, test, type Page } from '@playwright/test';
import { confirmViaTestPhone } from './link';

/**
 * Полный сценарий клиента (ТЗ §26.3):
 * открыть страницу → услуга → специалист → дата и время → телефон → OTP (тестовая среда) →
 * подтверждённая запись → перенос → отмена. Демо-филиал: /ru/b/demo-salon.
 */
const SLUG = 'demo-salon';

function uniquePhone(): string {
  const n = String(Date.now() % 10_000_000).padStart(7, '0');
  return `+7705${n}`;
}


async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'горизонтальная прокрутка на мобильном (§25)').toBeLessThanOrEqual(1);
}

test('клиент записывается, переносит и отменяет запись', async ({ page }) => {
  const phone = uniquePhone();

  // 1. Публичная страница
  await page.goto(`/ru/b/${SLUG}?utm_source=e2e&utm_medium=test`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Салон');
  await expect(page.getByText('Мужская стрижка').first()).toBeVisible();
  await noHorizontalScroll(page);

  // 2. Кнопка записи → одна страница: услуга, мастер, дата и время
  await page.getByTestId('book-button').first().click();
  await expect(page).toHaveURL(new RegExp(`/ru/b/${SLUG}/book`));
  await expect(page.getByTestId('pick-service-first')).toBeVisible();
  await page.getByText('Мужская стрижка').click();

  // 3. Специалист — на той же странице; у карточки число свободных окон на выбранный день
  await expect(page.getByTestId('spcount-any')).toBeVisible();
  await page.getByRole('button', { name: /Болат/ }).click();
  await expect(page.getByRole('button', { name: /Болат/ })).toHaveAttribute('aria-pressed', 'true');

  // 4. Дата и время: завтра, первый свободный слот
  const dates = page.locator('[data-testid^="date-"]');
  await dates.nth(1).click();
  const slot = page.getByTestId('slot').first();
  await expect(slot).toBeVisible();
  const chosenTime = (await slot.textContent())!.trim();
  await slot.click();
  await noHorizontalScroll(page);
  await page.getByTestId('next').click();

  // 5. Данные клиента
  await page.getByTestId('name').fill('Тест Клиент');
  await page.getByTestId('phone').fill(phone);
  await page.getByTestId('consent').check();
  // согласие на рекламные сообщения — только по явной отметке (D-34)
  await expect(page.getByTestId('consent-marketing')).not.toBeChecked();
  await page.waitForTimeout(1600); // антибот: форма не может быть отправлена мгновенно
  await page.getByTestId('get-code').click();

  // 6–7. Ссылка подтверждения приходит в «Тестовый телефон» (WhatsApp не подключён); клиент открывает её
  const confirmPage = await confirmViaTestPhone(page, phone);
  await expect(confirmPage.getByTestId('confirm-ok')).toContainText(chosenTime);
  const manageHref = (await confirmPage.getByTestId('manage-link').getAttribute('href'))!;
  // повторный переход по той же ссылке запись не трогает
  await confirmPage.reload();
  await expect(confirmPage.getByTestId('confirm-error')).toBeVisible();

  // 8. Страница записи сама узнала о подтверждении
  await expect(page.getByTestId('booking-done')).toBeVisible();
  await expect(page.getByTestId('booking-done')).toContainText(chosenTime);
  await expect(page.getByTestId('manage-in-message')).toBeVisible();
  await confirmPage.goto(manageHref);
  await page.close();
  const managePage = confirmPage;
  await expect(managePage.getByTestId('appointment-status')).toHaveText('Подтверждена');

  // 9. Перенос: другая дата
  await managePage.getByTestId('reschedule').click();
  await managePage.locator('[data-testid^="date-"]').nth(2).click();
  const newSlot = managePage.getByTestId('slot').nth(2);
  await expect(newSlot).toBeVisible();
  const newTime = (await newSlot.textContent())!.trim();
  await newSlot.click();
  await expect(managePage.getByTestId('appointment-time')).toContainText(newTime);
  await expect(managePage.getByTestId('appointment-status')).toHaveText('Подтверждена');

  // 10. Отмена
  managePage.once('dialog', (d) => d.accept());
  await managePage.getByTestId('cancel').click();
  await expect(managePage.getByTestId('appointment-status')).toHaveText('Отменена вами');
});

test('запись на одной странице: мастер сужает услуги, услуга — мастеров, у дней и мастеров видно число окон', async ({ page }) => {
  await page.goto(`/ru/b/${SLUG}/book`);
  // сначала мастер: остаются только его услуги, остальные — по кнопке «Все услуги»
  await page.getByRole('button', { name: /Дина/ }).click();
  await expect(page.getByText('Классический массаж')).toBeVisible();
  await expect(page.getByText('Мужская стрижка')).toHaveCount(0);
  await page.getByRole('button', { name: /Все услуги/ }).click();
  await expect(page.getByText('Мужская стрижка')).toBeVisible();
  // услуга: мастера, которые её не делают, пропадают; у оставшихся — окна на выбранный день
  await page.getByRole('button', { name: /Любой свободный/ }).click();
  await page.getByText('Мужская стрижка').click();
  await expect(page.getByRole('button', { name: /Дина/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Болат/ })).toBeVisible();
  await expect(page.getByTestId('spcount-any')).toBeVisible();
  await expect(page.getByTestId('pick-service-first')).toHaveCount(0);
  // итог справа (или снизу на телефоне) и кнопка «Далее» до выбора времени неактивна
  await expect(page.getByTestId('booking-summary')).toBeVisible();
  await expect(page.getByTestId('next')).toBeDisabled();
  await noHorizontalScroll(page);
});

test('публичная страница доступна на трёх языках с постоянной ссылкой', async ({ page }) => {
  for (const [lang, button] of [
    ['ru', 'Записаться онлайн'],
    ['kk', 'Онлайн жазылу'],
    ['en', 'Book online'],
  ] as const) {
    await page.goto(`/${lang}/b/${SLUG}`);
    await expect(page.getByTestId('book-button').first()).toHaveText(new RegExp(`^${button}`));
  }
  const res = await page.goto('/ru/b/no-such-branch-xyz');
  expect(res?.status()).toBe(404);
});

test('вход сотрудника: владелец видит записи в кабинете', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('email').fill('owner@demo.kz');
  await page.getByTestId('password').fill('DemoOwner12345');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // На мобильном меню свёрнуто под кнопкой «☰».
  const menu = page.getByRole('button', { name: 'menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('link', { name: 'Записи', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Записи', exact: true })).toBeVisible();
});
