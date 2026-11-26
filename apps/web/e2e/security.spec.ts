import { expect, test, type Frame, type Page } from '@playwright/test';
import { OWNER_STATE } from './global-setup';
import { ownerOrgId } from './owner';

/**
 * Безопасность веб-части: DOM-XSS во временной карте /embed/map (название из query / branch.name выводится
 * только текстом), проверка сообщений postMessage «2gis-set», заголовки страниц с токенами в адресе,
 * параметры маршрута и пользовательский ввод не меняют маршрут запроса к API (apiPath, проверка UUID).
 */
test.use({ storageState: { cookies: [], origins: [] } });

const PAYLOAD = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';

test('карта: название из адреса выводится текстом, HTML не исполняется', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs += 1;
    void d.dismiss();
  });
  await page.goto(`/embed/map?${new URLSearchParams({ lat: '43.2389', lng: '76.8897', title: PAYLOAD })}`);
  const tip = page.locator('.leaflet-tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(PAYLOAD);
  // ни одного элемента из «названия» в DOM: только текстовый узел
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator('.leaflet-tooltip script')).toHaveCount(0);
  // внутри подсказки — единственный элемент-обёртка с текстом, без вложенных тегов
  await expect(tip.locator('*')).toHaveCount(1);
  expect(await tip.getByTestId('map-title').evaluate((el) => el.childElementCount)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toBe(0);
});

test('карта выбора точки: «2gis-set» принимает только конечные числа', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // родитель того же origin со встроенной картой выбора точки (как MapPicker в кабинете)
  await page.goto('/embed/map');
  await page.evaluate(() => {
    const f = document.createElement('iframe');
    f.id = 'picker';
    f.src = '/embed/map?pick=1&lat=43.2389&lng=76.8897';
    f.style.cssText = 'position:fixed;inset:0;width:600px;height:400px;z-index:10000';
    document.body.appendChild(f);
  });
  await expect.poll(() => page.frames().some((f) => f.url().includes('pick=1'))).toBe(true);
  const frame = page.frames().find((f) => f.url().includes('pick=1')) as Frame;
  const icon = frame.locator('.leaflet-marker-icon');
  await expect(icon).toBeVisible();
  const before = await icon.evaluate((el) => (el as HTMLElement).style.transform);

  const post = (data: unknown) =>
    page.evaluate((d) => (document.getElementById('picker') as HTMLIFrameElement).contentWindow!.postMessage(d, window.location.origin), data);
  // строки, NaN, Infinity, вне диапазона, без координат — игнорируются, карта не ломается.
  // Сдвиг небольшой (в пределах окна карты): при дальнем переносе Leaflet центрирует карту заново и метка остаётся в центре.
  const invalid: unknown[] = [
    { type: '2gis-set', lat: '43.2394', lng: '76.8902' },
    { type: '2gis-set', lat: Number.NaN, lng: 76.8902 },
    { type: '2gis-set', lat: 43.2394, lng: Number.POSITIVE_INFINITY },
    { type: '2gis-set', lat: 500, lng: 76.8902 },
    { type: '2gis-set' },
    null,
  ];
  for (const msg of invalid) {
    await post(msg);
    await page.waitForTimeout(200);
    expect(await icon.evaluate((el) => (el as HTMLElement).style.transform), JSON.stringify(msg)).toBe(before);
    expect(errors, JSON.stringify(msg)).toEqual([]);
  }

  // корректные координаты двигают метку
  await post({ type: '2gis-set', lat: 43.2394, lng: 76.8902 });
  await expect.poll(() => icon.evaluate((el) => (el as HTMLElement).style.transform)).not.toBe(before);
  expect(errors).toEqual([]);
});

test('страницы с токеном в адресе: Referrer-Policy no-referrer; CSP запрещает inline-обработчики', async ({ request }) => {
  const token = 'A'.repeat(32);
  for (const path of [`/ru/manage/${token}`, `/ru/waitlist/${token}`, `/ru/confirm/00000000-0000-0000-0000-000000000000.${token}`]) {
    const r = await request.get(path);
    expect(r.headers()['referrer-policy'], path).toBe('no-referrer');
    expect(r.headers()['x-robots-tag'], path).toContain('noindex');
  }
  const home = await request.get('/');
  expect(home.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(home.headers()['content-security-policy']).toContain("script-src-attr 'none'");
});

test('лимит частоты через сайт (rewrite Next.js → API): поддельный X-Forwarded-For не даёт новый ключ', async ({ request }) => {
  // Маршрут отзыва по ссылке (10 запросов в час с IP) в E2E больше нигде не используется — остальные сценарии
  // не страдают. Next.js пропускает присланный X-Forwarded-For как есть: при TRUST_PROXY=1 без Caddy каждый
  // запрос получал бы свой «IP» и 429 не наступал бы никогда (D-54).
  const statuses: number[] = [];
  for (let i = 1; i <= 12; i++) {
    const r = await request.post(`/api/v1/public/manage/${'Z'.repeat(43)}/review`, {
      headers: { 'X-Forwarded-For': `203.0.113.${i}, 198.51.100.${i}` },
      data: { rating: 5 },
    });
    statuses.push(r.status());
  }
  expect(statuses).toContain(429);
  expect(statuses.filter((s) => s !== 429).length).toBeLessThanOrEqual(10);
});

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';
const TRAVERSAL = '..%2F..%2Fadmin%2Fsettings';

/** Пути API, на которые ушли запросы страницы (без query). */
function collectApiCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) calls.push(u.pathname);
  });
  return calls;
}

test('предпросмотр: не-UUID в адресе → 404 без запросов к API', async ({ page, request }) => {
  const paths = [`/preview/${TRAVERSAL}/${ZERO_UUID}`, `/preview/${ZERO_UUID}/${TRAVERSAL}`, '/preview/not-a-uuid/also-not'];
  for (const path of paths) expect((await request.get(path)).status(), path).toBe(404);
  const calls = collectApiCalls(page);
  for (const path of paths) expect((await page.goto(path))?.status(), path).toBe(404);
  await page.waitForTimeout(500);
  expect(calls).toEqual([]);
});

test.describe('кабинет владельца', () => {
  test.use({ storageState: OWNER_STATE });

  test('параметры маршрута с «../» → «Страница не найдена», запросов к другим маршрутам API нет', async ({ page }) => {
    // Кабинет за клиентской проверкой сессии (StaffGate) — 404 показывается после неё, HTTP-статус страницы 200.
    // Филиал проверяется в своей организации: в чужой кабинет показывает «Организация не найдена» раньше, чем дойдёт до филиала.
    const orgId = await ownerOrgId(page);
    const calls = collectApiCalls(page);
    for (const path of [
      `/dashboard/${TRAVERSAL}`,
      `/dashboard/${TRAVERSAL}/clients`,
      '/dashboard/not-a-uuid/settings',
      `/dashboard/${orgId}/branches/${TRAVERSAL}`,
      `/dashboard/${orgId}/branches/${TRAVERSAL}/page-editor`,
    ]) {
      await page.goto(path);
      await expect(page.getByText('Страница не найдена'), path).toBeVisible();
    }
    await page.goto(`/admin/organizations/${TRAVERSAL}`); // владелец не суперадмин → /login, без запроса карточки
    await page.waitForTimeout(500);
    expect(calls.filter((p) => p.includes('..') || p.includes('%2F') || p.startsWith('/api/v1/admin') || /\/organizations\/(?![0-9a-f-]{36}(\/|$))/.test(p))).toEqual([]);
  });

  test('поиск клиентов: спецсимволы уходят значением параметра, маршрут API не меняется', async ({ page }) => {
    const orgId = await ownerOrgId(page);
    await page.goto(`/dashboard/${orgId}/clients`);
    const needle = 'a&pageSize=1/../../admin#x?';
    const req = page.waitForRequest((r) => r.url().includes('/clients?') && r.url().includes('search='));
    await page.getByRole('textbox').first().fill(needle);
    await page.getByRole('button', { name: 'Поиск' }).click();
    const u = new URL((await req).url());
    expect(u.pathname).toBe(`/api/v1/organizations/${orgId}/clients`);
    expect(u.searchParams.get('search')).toBe(needle);
    expect(u.searchParams.getAll('pageSize')).toEqual(['50']);
    expect(u.hash).toBe('');
  });
});
