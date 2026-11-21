import { expect, test } from '@playwright/test';

/**
 * Магазин оформлений (задача 23): владелец видит каталог тем с живым предпросмотром своей страницы,
 * фильтр «Для вашего направления», применяет тему в черновик и возвращает исходную. Опубликованная страница не меняется.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('магазин оформлений: каталог, рекомендации, применение темы в черновик', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('email').fill('club@demo.kz');
  await page.getByTestId('password').fill('DemoOwner12345');
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/dashboard\/[0-9a-f-]{36}/);
  const orgId = /dashboard\/([0-9a-f-]{36})/.exec(page.url())![1]!;

  await page.goto(`/dashboard/${orgId}/themes`);
  const store = page.getByTestId('theme-store');
  await expect(store.locator('[data-testid^="theme-"]')).toHaveCount(8);
  await expect(page.getByTestId('theme-neon')).toContainText('Рекомендуем');
  // живой предпросмотр — страница филиала в выбранной теме
  await expect(page.getByTestId('theme-fresh').locator('iframe')).toHaveAttribute('src', /\/preview\/.+templateId=/);

  await page.getByRole('button', { name: 'Для вашего направления' }).click();
  await expect(store.locator('[data-testid^="theme-"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Все темы' }).click();

  // применить «Свежесть» без публикации → черновик
  page.once('dialog', (d) => d.dismiss());
  await page.getByTestId('apply-fresh').click();
  await expect(page.getByText('Свежесть: тема сохранена в черновик')).toBeVisible();
  await expect(page.getByTestId('theme-fresh')).toContainText('Сейчас на странице');

  // публичная страница по-прежнему в опубликованной теме
  const pub = await (await page.request.get('/api/v1/public/pages/demo-club?locale=ru')).json();
  expect(pub.template.key).toBe('neon');

  // вернуть черновик к «Неону»
  page.once('dialog', (d) => d.dismiss());
  await page.getByTestId('apply-neon').click();
  await expect(page.getByText('Неон: тема сохранена в черновик')).toBeVisible();
  await expect(page.getByTestId('theme-neon')).toContainText('Сейчас на странице');
});
