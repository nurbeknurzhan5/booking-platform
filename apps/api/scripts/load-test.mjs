/**
 * Нагрузочный тест (ТЗ §23). Запуск против работающего API с демо-данными (slug demo-salon):
 *   node scripts/load-test.mjs [baseUrl] [--requests 600] [--concurrency 25]
 * Сценарии:
 *  1. Получение доступных слотов (цель p95 ≤ 150 мс).
 *  2. Создание резервов на разные слоты (цель p95 ≤ 300 мс).
 *  3. Конкурентная запись: 40 попыток на один слот одновременно → ровно 1 успех.
 * Для имитации разных клиентов используется X-Forwarded-For (API доверяет 1 прокси).
 * ВНИМАНИЕ: создаёт записи в БД — запускать только на тестовом стенде.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) ?? 'http://localhost:4000').replace(/\/$/, '') + '/api/v1';
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const REQUESTS = opt('requests', 600);
const CONCURRENCY = opt('concurrency', 25);
const SLUG = 'demo-salon';

let ipSeq = 0;
const fakeIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
// Случайные номера: повторный прогон не упирается в лимит частоты OTP по номеру.
const runSalt = Math.floor(Math.random() * 9_000_000);
const phone = (i) => `+7707${String((runSalt + i * 7919) % 10_000_000).padStart(7, '0')}`;

async function timed(fn) {
  const t = performance.now();
  const r = await fn();
  return { ms: performance.now() - t, status: r.status };
}

async function pool(n, concurrency, task) {
  const results = [];
  let next = 0;
  const start = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < n) {
        const i = next++;
        results.push(await task(i));
      }
    }),
  );
  return { results, seconds: (performance.now() - start) / 1000 };
}

function stats(name, { results, seconds }) {
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const q = (p) => ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))].toFixed(1);
  const codes = results.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  console.log(`${name}: n=${ms.length} rps=${(ms.length / seconds).toFixed(1)} p50=${q(50)}ms p95=${q(95)}ms p99=${q(99)}ms codes=${JSON.stringify(codes)}`);
  return { p95: Number(q(95)), codes };
}

const post = (path, body, ip) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body) });

async function main() {
  const page = await (await fetch(`${base}/public/pages/${SLUG}`)).json();
  if (!page.services) throw new Error(`Демо-страница ${SLUG} недоступна: ${JSON.stringify(page)}`);
  const svc = page.services.find((s) => s.name.includes('Мужская')) ?? page.services[0];
  const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

  // 1. Слоты
  const av = stats(
    'availability',
    await pool(REQUESTS, CONCURRENCY, (i) => timed(() => post(`/public/branches/${SLUG}/availability`, { date: day(1 + (i % 20)), items: [{ serviceId: svc.id }] }, fakeIp()))),
  );

  // 2. Резервы на разные слоты (разные даты и время)
  const slotsByDay = [];
  for (let d = 21; d < 41; d++) {
    const r = await (await post(`/public/branches/${SLUG}/availability`, { date: day(d), items: [{ serviceId: svc.id }] }, fakeIp())).json();
    for (const s of r.slots ?? []) slotsByDay.push(s.startAt);
  }
  const holdsN = Math.min(150, slotsByDay.length);
  const holds = stats(
    'create-hold',
    await pool(holdsN, Math.min(CONCURRENCY, 20), (i) =>
      timed(() =>
        post(`/public/branches/${SLUG}/bookings`, { startAt: slotsByDay[i], items: [{ serviceId: svc.id }], client: { name: 'Load', phone: phone(i) }, consents: { personalData: true } }, fakeIp()),
      ),
    ),
  );

  // 3. Конкурентная запись на один слот одним специалистом
  const target = (await (await post(`/public/branches/${SLUG}/availability`, { date: day(45), items: [{ serviceId: svc.id, specialistId: page.specialists.find((s) => s.serviceIds.includes(svc.id)).id }] }, fakeIp())).json()).slots[0];
  const spId = target.items[0].specialistId;
  const race = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      post(`/public/branches/${SLUG}/bookings`, { startAt: target.startAt, items: [{ serviceId: svc.id, specialistId: spId }], client: { name: 'Race', phone: phone(1000 + i) }, consents: { personalData: true } }, fakeIp()).then((r) => r.status),
    ),
  );
  const ok = race.filter((s) => s === 201).length;
  console.log(`race-same-slot: attempts=40 success=${ok} conflicts=${race.filter((s) => s === 409).length} other=${race.filter((s) => s !== 201 && s !== 409).join(',') || 0}`);

  const pass = av.p95 <= 150 && holds.p95 <= 300 && ok === 1;
  console.log(pass ? 'RESULT: targets met' : 'RESULT: targets NOT met (см. значения выше)');
  process.exit(ok === 1 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
