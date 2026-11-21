import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { DateTime } from 'luxon';
import { API, bootstrapTestApp, createSuperadmin, Http, loginSuperadmin, resetDb, type TestContext } from './helpers';
import { bookAndConfirm, createBookableBranch, drainNotifications, futureDate, localTime, nextPhone, TZ, type BookableBranch } from './fixtures';
import { resetConfigCache } from '../src/config/config';
import { ReactivationService } from '../src/notifications/reactivation.service';

/** Mock WhatsApp Cloud API: запоминает тела запросов. */
function startMock() {
  const bodies: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      bodies.push(JSON.parse(raw || '{}'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: [{ id: `wamid.out.${bodies.length}` }] }));
    });
  });
  return new Promise<{ url: string; bodies: typeof bodies; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, bodies, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

describe('WhatsApp: автоответ на входящие (D-32) и реактивация (D-34)', () => {
  let ctx: TestContext;
  let admin: Http;
  let b: BookableBranch;
  let mock: Awaited<ReturnType<typeof startMock>>;
  const saved = { ...process.env };
  let msgSeq = 0;

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
    process.env = { ...saved, WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_ACCESS_TOKEN: 'test-token', WHATSAPP_API_BASE_URL: mock.url };
    resetConfigCache();
    mock.bodies.length = 0;
    await resetDb(ctx);
    admin = await loginSuperadmin(ctx, await createSuperadmin(ctx));
    b = await createBookableBranch(ctx, admin);
  });

  /** Несколько записей одного номера подряд: снимаем паузу между отправками OTP. */
  const skipOtpCooldown = (phone: string) => ctx.prisma.otpCode.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 3600_000) } });

  const sign = (body: string) => 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');

  /** Входящее сообщение через подписанный webhook. */
  async function inbound(phone: string, text: string, opts: { id?: string; type?: string; ageSec?: number; phoneNumberId?: string } = {}) {
    const id = opts.id ?? `wamid.in.${++msgSeq}`;
    const ts = String(Math.floor(Date.now() / 1000) - (opts.ageSec ?? 0));
    const type = opts.type ?? 'text';
    const message = { from: phone.replace('+', ''), id, timestamp: ts, type, ...(type === 'text' ? { text: { body: text } } : {}) };
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: opts.phoneNumberId ?? '1234567890' }, messages: [message] } }] }],
    });
    const r = await new Http(ctx.app).raw().post(`${API}/integrations/whatsapp/webhook`).set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(body)).send(body);
    expect(r.status).toBe(200);
    return { id, r };
  }

  async function replies(phone: string, type = 'whatsapp_auto_reply') {
    await drainNotifications(ctx);
    return ctx.prisma.devInboxMessage.findMany({ where: { recipient: phone, type }, orderBy: { createdAt: 'asc' } });
  }

  describe('автоответ', () => {
    it('клиент получает свои ближайшие записи и ссылку на кабинет; чужие записи не раскрываются', async () => {
      const phone = nextPhone();
      const d1 = futureDate(3);
      const d2 = futureDate(5);
      expect((await bookAndConfirm(ctx, b.slug, { phone, startAt: localTime(d2, '15:00'), items: [{ serviceId: b.services.color, specialistId: b.specialists.anna }] })).confirm?.status).toBe(200);
      await skipOtpCooldown(phone);
      expect((await bookAndConfirm(ctx, b.slug, { phone, startAt: localTime(d1, '11:00'), items: [{ serviceId: b.services.haircut, specialistId: b.specialists.bolat }] })).confirm?.status).toBe(200);
      // запись другого номера
      expect((await bookAndConfirm(ctx, b.slug, { startAt: localTime(d1, '17:00'), items: [{ serviceId: b.services.massage }] })).confirm?.status).toBe(200);

      const { r } = await inbound(phone, 'Здравствуйте, во сколько я записан?');
      expect(r.body).toMatchObject({ messages: 1 });
      const [reply] = await replies(phone);
      expect(reply).toBeDefined();
      const text = reply!.text;
      expect(text).toContain('Ваши ближайшие записи:');
      // по возрастанию времени: сначала стрижка, потом окрашивание
      expect(text.indexOf('Стрижка')).toBeGreaterThan(0);
      expect(text.indexOf('Стрижка')).toBeLessThan(text.indexOf('Окрашивание'));
      expect(text).toContain('11:00');
      expect(text).not.toContain('Массаж');
      expect(text).toContain('/ru/cabinet');
      // сведения о записях в outbox зашифрованы и стёрты после отправки
      const row = await ctx.prisma.notificationOutbox.findFirstOrThrow({ where: { recipient: phone, type: 'whatsapp_auto_reply' } });
      expect(row.payloadEncrypted).toBe(true);
      expect(row.payload).toEqual({});
      expect(await ctx.prisma.whatsappInboundMessage.count({ where: { phone } })).toBe(1);
    });

    it('без записей — сообщение об этом; повторная доставка webhook и частые сообщения не дают лишних ответов', async () => {
      const phone = nextPhone();
      const first = await inbound(phone, 'привет');
      await inbound(phone, 'привет', { id: first.id }); // повторная доставка того же сообщения
      await inbound(phone, 'ещё вопрос'); // через секунды — ограничение частоты
      const list = await replies(phone);
      expect(list).toHaveLength(1);
      expect(list[0]!.text).toContain('нет предстоящих записей');
      const actions = (await ctx.prisma.whatsappInboundMessage.findMany({ where: { phone }, orderBy: { createdAt: 'asc' } })).map((m) => m.action);
      expect(actions).toEqual(['auto_reply', 'throttled']);
      // текст входящих не хранится
      const cols = await ctx.prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'whatsapp_inbound_messages'`;
      expect(cols.map((c) => c.column_name)).not.toContain('text');

      // через 5 минут — снова отвечаем
      await ctx.prisma.whatsappInboundMessage.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 6 * 60_000) } });
      await inbound(phone, 'и снова');
      expect(await replies(phone)).toHaveLength(2);
    });

    it('служебные типы, сообщения старше 24 ч, чужой номер Meta и неверная подпись игнорируются', async () => {
      const phone = nextPhone();
      await inbound(phone, '', { type: 'reaction' });
      await inbound(phone, 'старое', { ageSec: 25 * 3600 });
      const foreign = await inbound(phone, 'другой номер', { phoneNumberId: '999' });
      expect(foreign.r.body.messages).toBe(0);
      const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '77010000000', id: 'x', type: 'text', text: { body: 'a' } }] } }] }] });
      const bad = await new Http(ctx.app).raw().post(`${API}/integrations/whatsapp/webhook`).set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=00').send(body);
      expect(bad.status).toBe(403);
      expect(await replies(phone)).toHaveLength(0);
      const actions = (await ctx.prisma.whatsappInboundMessage.findMany({ where: { phone } })).map((m) => m.action).sort();
      expect(actions).toEqual(['ignored', 'ignored']);
    });

    it('через Cloud API ответ уходит обычным текстом (24-часовое окно), язык — по карточке клиента', async () => {
      process.env.NOTIFICATION_CHANNELS = 'whatsapp';
      process.env.OTP_CHANNELS = 'whatsapp';
      resetConfigCache();
      const phone = nextPhone();
      const org = await ctx.prisma.organization.findUniqueOrThrow({ where: { id: b.orgId } });
      await ctx.prisma.client.create({ data: { organizationId: org.id, phone, name: 'Айгерим', locale: 'kk' } });
      await inbound(phone, 'сәлем');
      await drainNotifications(ctx);
      const sent = mock.bodies.find((x) => x.to === phone.slice(1));
      expect(sent).toMatchObject({ messaging_product: 'whatsapp', type: 'text' });
      expect((sent!.text as { body: string }).body).toContain('Бұл нөмірге алдағы жазбалар жоқ');
      expect((sent!.text as { body: string }).body).toContain('/kk/cabinet');
    });
  });

  describe('реактивация', () => {
    const settingsUrl = () => `${API}/organizations/${b.orgId}/notification-settings`;
    async function enable(days = 60) {
      const cur = await b.owner.get(settingsUrl());
      const r = await b.owner.put(settingsUrl(), { ...cur.body, reactivationEnabled: true, reactivationDays: days });
      expect(r.status).toBe(200);
    }
    /** 12:00 по времени филиала сегодня — внутри окна отправки. */
    const noon = () => DateTime.now().setZone(TZ).set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const run = (now = noon()) => ctx.app.get(ReactivationService).enqueueDue(now);

    /** Завершённый визит N дней назад. */
    async function pastVisit(phone: string, daysAgo: number, marketing: boolean | null = true) {
      await skipOtpCooldown(phone);
      const date = futureDate(2 + (msgSeq++ % 20));
      const booked = await bookAndConfirm(ctx, b.slug, { phone, startAt: localTime(date, '10:00'), items: [{ serviceId: b.services.haircut }] });
      expect(booked.confirm?.status).toBe(200);
      const id = booked.hold.body.appointmentId as string;
      const end = DateTime.now().minus({ days: daysAgo }).toJSDate();
      await ctx.prisma.appointmentResource.updateMany({ where: { appointmentId: id }, data: { isActive: false } });
      await ctx.prisma.appointment.update({ where: { id }, data: { status: 'completed', startAt: new Date(end.getTime() - 3600_000), endAt: end } });
      if (marketing !== null) {
        await ctx.prisma.clientConsent.create({ data: { organizationId: b.orgId, phone, consentType: 'marketing', granted: marketing, textVersion: 'v', source: 'test' } });
      }
      return id;
    }

    it('по умолчанию выключена; после включения — одно сообщение по визиту, с UTM-ссылкой на страницу филиала', async () => {
      const phone = nextPhone();
      await pastVisit(phone, 61);
      expect(await run()).toBe(0);
      await enable(60);
      expect(await run()).toBe(1);
      expect(await run()).toBe(0); // повторный запуск — без дублей
      const [msg] = await replies(phone, 'reactivation');
      expect(msg!.text).toContain('давно не виделись');
      expect(msg!.text).toContain(`/ru/b/${b.slug}?utm_source=whatsapp&utm_medium=message&utm_campaign=reactivation`);
      expect(msg!.text).toContain('СТОП');
    });

    it('правила отбора: согласие на рекламу, будущие записи, срок после визита, обезличивание, время суток, период 30 дней', async () => {
      await enable(60);
      const noConsent = nextPhone();
      await pastVisit(noConsent, 61, null);
      const declined = nextPhone();
      await pastVisit(declined, 61, false);
      const recent = nextPhone();
      await pastVisit(recent, 40);
      const hasFuture = nextPhone();
      await pastVisit(hasFuture, 61);
      await skipOtpCooldown(hasFuture);
      expect((await bookAndConfirm(ctx, b.slug, { phone: hasFuture, startAt: localTime(futureDate(7), '13:00'), items: [{ serviceId: b.services.haircut }] })).confirm?.status).toBe(200);
      const anonymized = nextPhone();
      await pastVisit(anonymized, 61);
      const anonClient = await ctx.prisma.client.findFirstOrThrow({ where: { phone: anonymized } });
      expect((await b.owner.post(`${API}/organizations/${b.orgId}/clients/${anonClient.id}/anonymize`, {})).status).toBe(204);
      const ok = nextPhone();
      await pastVisit(ok, 61);

      // ночью по времени филиала не отправляем
      const night = DateTime.now().setZone(TZ).set({ hour: 22, minute: 0 }).toJSDate();
      expect(await run(night)).toBe(0);
      expect(await run()).toBe(1);
      const sent = await ctx.prisma.notificationOutbox.findMany({ where: { type: 'reactivation' } });
      expect(sent.map((s) => s.recipient)).toEqual([ok]);

      // новый визит и снова N дней без визитов, но прошло меньше 30 дней с прошлой реактивации — не отправляем
      await pastVisit(ok, 61);
      expect(await run()).toBe(0);
      await ctx.prisma.notificationOutbox.updateMany({ where: { recipient: ok }, data: { createdAt: new Date(Date.now() - 31 * 86400_000) } });
      expect(await run()).toBe(1);
    });

    it('СТОП отзывает согласие во всех организациях и отменяет неотправленную реактивацию', async () => {
      await enable(60);
      const phone = nextPhone();
      await pastVisit(phone, 61);
      expect(await run()).toBe(1);
      await inbound(phone, 'СТОП!');
      const outbox = await ctx.prisma.notificationOutbox.findFirstOrThrow({ where: { recipient: phone, type: 'reactivation' } });
      expect(outbox.status).toBe('cancelled');
      const [confirm] = await replies(phone, 'marketing_unsubscribed');
      expect(confirm!.text).toContain('отписались');
      const consent = await ctx.prisma.clientConsent.findFirstOrThrow({ where: { phone, consentType: 'marketing' }, orderBy: { createdAt: 'desc' } });
      expect(consent).toMatchObject({ granted: false, organizationId: null, source: 'whatsapp_stop' });
      // следующий визит — реактивация не придёт, пока клиент снова не даст согласие
      await ctx.prisma.notificationOutbox.updateMany({ where: { recipient: phone }, data: { createdAt: new Date(Date.now() - 31 * 86400_000) } });
      const visit = await pastVisit(phone, 61, null);
      expect(visit).toBeTruthy();
      expect(await run()).toBe(0);
    });

    it('форма записи: отметка «реклама» создаёт согласие, без отметки прежнее решение не меняется', async () => {
      const phone = nextPhone();
      const http = new Http(ctx.app);
      const hold = await http.post(`${API}/public/branches/${b.slug}/bookings`, {
        startAt: localTime(futureDate(3), '12:00'),
        items: [{ serviceId: b.services.haircut }],
        client: { name: 'Клиент', phone },
        consents: { personalData: true, marketing: true },
      });
      expect(hold.status).toBe(201);
      await skipOtpCooldown(phone);
      const hold2 = await http.post(`${API}/public/branches/${b.slug}/bookings`, {
        startAt: localTime(futureDate(4), '12:00'),
        items: [{ serviceId: b.services.haircut }],
        client: { name: 'Клиент', phone },
        consents: { personalData: true },
      });
      expect(hold2.status).toBe(201);
      const rows = await ctx.prisma.clientConsent.findMany({ where: { phone, consentType: 'marketing' } });
      expect(rows.map((r) => r.granted)).toEqual([true]);
    });
  });
});
