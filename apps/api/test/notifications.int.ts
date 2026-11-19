import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { API, bootstrapTestApp, createOrgWithOwner, createSuperadmin, Http, loginSuperadmin, resetDb, type TestContext } from './helpers';
import { resetConfigCache } from '../src/config/config';
import { NotificationService } from '../src/notifications/notification.service';
import { NotificationDispatcher } from '../src/notifications/dispatcher.service';
import { WhatsAppChannel } from '../src/notifications/channels';

interface MockReq {
  path: string;
  body: unknown;
  auth: string | undefined;
}

/** Mock официального WhatsApp Cloud API и SMS-провайдера. */
function startMock() {
  const requests: MockReq[] = [];
  const queue: Array<{ status: number; body: unknown }> = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        /* form-urlencoded */
      }
      requests.push({ path: req.url ?? '', body, auth: req.headers.authorization });
      const next = queue.shift() ?? { status: 200, body: req.url?.includes('sendsmsmessage') ? { code: 0, data: { messageId: 777 } } : { messages: [{ id: `wamid.${requests.length}` }] } };
      res.writeHead(next.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(next.body));
    });
  });
  return new Promise<{ url: string; requests: MockReq[]; queue: typeof queue; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, requests, queue, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

describe('Этап 7: WhatsApp Business Platform, outbox, очереди, статусы доставки', () => {
  let ctx: TestContext;
  let mock: Awaited<ReturnType<typeof startMock>>;
  let admin: Http;
  let orgId: string;
  const saved = { ...process.env };

  beforeAll(async () => {
    mock = await startMock();
    ctx = await bootstrapTestApp();
  });
  afterAll(async () => {
    await ctx.close();
    await mock.close();
    process.env = saved;
    resetConfigCache();
  });
  beforeEach(async () => {
    Object.assign(process.env, {
      NOTIFICATION_CHANNELS: 'whatsapp,sms',
      OTP_CHANNELS: 'whatsapp,sms',
      WHATSAPP_API_BASE_URL: mock.url,
      WHATSAPP_API_VERSION: 'v23.0',
      WHATSAPP_PHONE_NUMBER_ID: '1234567890',
      WHATSAPP_ACCESS_TOKEN: 'test-token',
      WHATSAPP_APP_SECRET: 'app-secret',
      WHATSAPP_VERIFY_TOKEN: 'verify-me',
      SMS_API_BASE_URL: mock.url,
      SMS_API_KEY: 'sms-key',
    });
    resetConfigCache();
    mock.requests.length = 0;
    mock.queue.length = 0;
    await resetDb(ctx);
    admin = await loginSuperadmin(ctx, await createSuperadmin(ctx));
    ({ orgId } = await createOrgWithOwner(ctx, admin));
    await ctx.prisma.organization.update({ where: { id: orgId }, data: { notificationSettings: { whatsappEnabled: true, smsEnabled: true, reminderEnabled: true, reviewRequestEnabled: true } } });
  });

  const enqueue = (type: 'otp' | 'appointment_confirmed', key: string, params: Record<string, string>, recipient = '+77017778899') =>
    ctx.prisma.$transaction((tx) =>
      ctx.app.get(NotificationService).enqueue(tx, { organizationId: orgId, type, eventKey: key, recipient, locale: 'ru', params, sensitive: type === 'otp' }),
    );
  const dispatcher = () => ctx.app.get(NotificationDispatcher);
  const forceDue = () => ctx.prisma.notificationOutbox.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } });

  it('сообщение отправляется одобренным шаблоном через официальный Cloud API', async () => {
    const id = await enqueue('appointment_confirmed', 'evt:1', { clientName: 'Айгерим', branchName: 'Салон', date: '1 декабря', time: '10:00', manageUrl: 'https://x/y' });
    await dispatcher().drain();
    const req = mock.requests[0]!;
    expect(req.path).toBe('/v23.0/1234567890/messages');
    expect(req.auth).toBe('Bearer test-token');
    expect(req.body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '77017778899',
      type: 'template',
      template: {
        name: 'appointment_confirmed',
        language: { code: 'ru' },
        components: [{ type: 'body', parameters: [{ text: 'Айгерим' }, { text: 'Салон' }, { text: '1 декабря' }, { text: '10:00' }, { text: 'https://x/y' }] }],
      },
    });
    const row = await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: id! } });
    expect(row).toMatchObject({ status: 'sent', providerMessageId: 'wamid.1', attempts: 1 });
  });

  it('OTP: шаблон AUTHENTICATION с кнопкой копирования; код хранится зашифрованным и стирается после отправки', async () => {
    const id = await enqueue('otp', 'otp:1', { code: '482913', minutes: '5' });
    const before = await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: id! } });
    expect(JSON.stringify(before.payload)).not.toContain('482913');
    await dispatcher().drain();
    const comps = (mock.requests[0]!.body as { template: { components: Array<{ type: string; parameters: Array<{ text: string }> }> } }).template.components;
    expect(comps.find((c) => c.type === 'button')!.parameters[0]!.text).toBe('482913');
    const after = await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: id! } });
    expect(after.payload).toEqual({});
  });

  it('временная ошибка → повтор с задержкой; успешная доставка с журналом попыток', async () => {
    mock.queue.push({ status: 503, body: { error: { code: 131000, message: 'Something went wrong' } } }, { status: 429, body: { error: { code: 130429, message: 'Rate limit' } } });
    const id = await enqueue('appointment_confirmed', 'evt:retry', { clientName: 'A', branchName: 'B', date: 'd', time: 't', manageUrl: 'u' });
    await dispatcher().drain();
    let row = await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: id! } });
    expect(row.status).toBe('failed');
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(await dispatcher().drain()).toBe(0); // ещё не время
    await forceDue();
    await dispatcher().drain();
    await forceDue();
    await dispatcher().drain();
    row = await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: id! } });
    expect(row).toMatchObject({ status: 'sent', attempts: 3 });
    const attempts = await ctx.prisma.notificationAttempt.findMany({ where: { outboxId: id! }, orderBy: { attemptNo: 'asc' } });
    expect(attempts.map((a) => a.success)).toEqual([false, false, true]);
    expect(attempts[0]!.errorCode).toBe('WA_131000');
  });

  it('постоянная ошибка → dead (DLQ) сразу; суперадмин видит и повторяет', async () => {
    mock.queue.push({ status: 400, body: { error: { code: 131026, message: 'Message undeliverable' } } });
    const id = await enqueue('appointment_confirmed', 'evt:dead', { clientName: 'A', branchName: 'B', date: 'd', time: 't', manageUrl: 'u' });
    await dispatcher().drain();
    const row = await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: id! } });
    expect(row.status).toBe('dead');
    const dlq = await admin.get(`${API}/admin/notifications?status=dead`);
    expect(dlq.body.map((r: { id: string }) => r.id)).toContain(id);
    const retry = await admin.post(`${API}/admin/notifications/${id}/retry`);
    expect(retry.status).toBe(200);
    await dispatcher().drain();
    expect((await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: id! } })).status).toBe('sent');
  });

  it('OTP: если WhatsApp недоступен окончательно — резервная отправка по SMS', async () => {
    mock.queue.push({ status: 400, body: { error: { code: 131026, message: 'not a WhatsApp user' } } });
    await enqueue('otp', 'otp:fb', { code: '111222', minutes: '5' });
    await dispatcher().drain();
    await dispatcher().drain();
    const sms = mock.requests.find((r) => r.path.includes('sendsmsmessage'));
    expect(sms).toBeDefined();
    expect(String(sms!.body)).toContain('111222');
    const rows = await ctx.prisma.notificationOutbox.findMany({ where: { type: 'otp' }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => `${r.channel}:${r.status}`)).toEqual(['whatsapp:dead', 'sms:sent']);
  });

  it('повторная обработка события не создаёт дубликат (идемпотентность outbox)', async () => {
    await enqueue('appointment_confirmed', 'evt:dup', { clientName: 'A', branchName: 'B', date: 'd', time: 't', manageUrl: 'u' });
    await enqueue('appointment_confirmed', 'evt:dup', { clientName: 'A', branchName: 'B', date: 'd', time: 't', manageUrl: 'u' });
    await Promise.all([dispatcher().drain(), dispatcher().drain()]);
    expect(mock.requests.filter((r) => r.path.includes('/messages'))).toHaveLength(1);
  });

  it('согласие клиента: при отказе от WhatsApp сообщение уходит по SMS, при отказе от уведомлений — не отправляется', async () => {
    await ctx.prisma.clientConsent.create({ data: { organizationId: orgId, phone: '+77010000001', consentType: 'whatsapp', granted: false, textVersion: 'v', source: 'test' } });
    await enqueue('appointment_confirmed', 'evt:c1', { clientName: 'A', branchName: 'B', date: 'd', time: 't', manageUrl: 'u' }, '+77010000001');
    const r1 = await ctx.prisma.notificationOutbox.findFirstOrThrow({ where: { recipient: '+77010000001' } });
    expect(r1.channel).toBe('sms');
    await ctx.prisma.clientConsent.create({ data: { organizationId: orgId, phone: '+77010000002', consentType: 'notifications', granted: false, textVersion: 'v', source: 'test' } });
    expect(await enqueue('appointment_confirmed', 'evt:c2', { clientName: 'A', branchName: 'B', date: 'd', time: 't', manageUrl: 'u' }, '+77010000002')).toBeNull();
  });

  describe('webhook статусов доставки', () => {
    const sign = (body: string) => 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
    const payload = (id: string, status: string) =>
      JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });

    it('подтверждение подписки по verify token', async () => {
      const ok = await new Http(ctx.app).get(`${API}/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
      expect(ok.status).toBe(200);
      expect(ok.text).toBe('12345');
      expect((await new Http(ctx.app).get(`${API}/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1`)).status).toBe(403);
    });

    it('подпись проверяется; статусы delivered/read применяются идемпотентно', async () => {
      const id = await enqueue('appointment_confirmed', 'evt:wh', { clientName: 'A', branchName: 'B', date: 'd', time: 't', manageUrl: 'u' });
      await dispatcher().drain();
      const wamid = (await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: id! } })).providerMessageId!;
      const agent = new Http(ctx.app).raw();
      const bad = await agent.post(`${API}/integrations/whatsapp/webhook`).set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=00').send(payload(wamid, 'delivered'));
      expect(bad.status).toBe(403);
      for (const st of ['delivered', 'delivered', 'read']) {
        const body = payload(wamid, st);
        const r = await agent.post(`${API}/integrations/whatsapp/webhook`).set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(body)).send(body);
        expect(r.status).toBe(200);
      }
      const row = await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: id! } });
      expect(row.status).toBe('read');
      expect(row.deliveredAt).not.toBeNull();
      expect(await ctx.prisma.whatsappMessageStatus.count({ where: { providerMessageId: wamid } })).toBe(2);
    });
  });

  it('конфигурация: dev_inbox запрещён в production', () => {
    const { loadConfig } = jest.requireActual('../src/config/config') as typeof import('../src/config/config');
    expect(() => loadConfig({ ...process.env, APP_ENV: 'production', NOTIFICATION_CHANNELS: 'dev_inbox', COOKIE_SECURE: 'true' })).toThrow(/dev_inbox/);
    expect(new WhatsAppChannel().isConfigured()).toBe(true);
  });
});
