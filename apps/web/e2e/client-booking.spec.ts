import { expect, test, type Page } from '@playwright/test';

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

async function otpFor(page: Page, phone: string): Promise<string> {
  // OTP доставляется воркером в канал dev_inbox (только dev/test, запрещён в production).
  for (let i = 0; i < 40; i++) {
    const r = await page.request.get(`/api/v1/dev/inbox?phone=${encodeURIComponent(phone)}`);
    const list = (await r.json()) as Array<{ type: string; text: string }>;
    const otp = list.find((m) => m.type === 'otp');
    if (otp) return /(\d{6})/.exec(otp.text)![1]!;
    await page.waitForTimeout(500);
  }
  throw new Error('OTP not delivered');
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

  // 2. Кнопка записи → выбор услуги
  await page.getByTestId('book-button').first().click();
  await expect(page).toHaveURL(new RegExp(`/ru/b/${SLUG}/book`));
  await page.getByText('Мужская стрижка').click();
  await page.getByTestId('next').click();

  // 3. Специалист
  await page.getByRole('button', { name: /Болат/ }).click();
  await page.getByTestId('next').click();

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

  // 6–7. OTP из тестовой среды и подтверждение
  await expect(page.getByTestId('otp')).toBeVisible();
  const code = await otpFor(page, phone);
  await page.getByTestId('otp').fill(code);
  await page.getByTestId('confirm').click();

  // 8. Подтверждённая запись
  await expect(page.getByTestId('booking-done')).toBeVisible();
  await expect(page.getByTestId('booking-done')).toContainText(chosenTime);
  await page.getByTestId('manage-link').click();
  await expect(page.getByTestId('appointment-status')).toHaveText('Подтверждена');

  // 9. Перенос: другая дата
  await page.getByTestId('reschedule').click();
  await page.locator('[data-testid^="date-"]').nth(2).click();
  const newSlot = page.getByTestId('slot').nth(2);
  await expect(newSlot).toBeVisible();
  const newTime = (await newSlot.textContent())!.trim();
  await newSlot.click();
  await expect(page.getByTestId('appointment-time')).toContainText(newTime);
  await expect(page.getByTestId('appointment-status')).toHaveText('Подтверждена');

  // 10. Отмена
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('cancel').click();
  await expect(page.getByTestId('appointment-status')).toHaveText('Отменена вами');
});

test('публичная страница доступна на трёх языках с постоянной ссылкой', async ({ page }) => {
  for (const [lang, button] of [
    ['ru', 'Записаться онлайн'],
    ['kk', 'Онлайн жазылу'],
    ['en', 'Book online'],
  ] as const) {
    await page.goto(`/${lang}/b/${SLUG}`);
    await expect(page.getByTestId('book-button').first()).toHaveText(button);
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
  await page.getByRole('link', { name: 'Записи', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Записи' })).toBeVisible();
});
