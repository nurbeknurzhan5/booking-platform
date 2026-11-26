import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { API, bootstrapTestApp, createSuperadmin, Http, loginStaff, loginSuperadmin, type TestContext } from './helpers';
import { createBookableBranch, drainNotifications, futureDate, linkTokenFor, localTime, TZ, type BookableBranch } from './fixtures';
import { seedReferenceData } from '../src/seed/reference-data';
import { SystemSettingsService } from '../src/common/system-settings.service';
import { devInboxEnabled, loadConfig, resetConfigCache } from '../src/config/config';
import { DevInboxChannel } from '../src/notifications/channels';

/**
 * Аудит E: «тестовый телефон» только по явному флагу (fail-closed конфигурация), полнота обезличивания
 * клиента, изоляция карточки клиента по филиалам администратора.
 * Тестовая БД общая: тест не очищает её, все данные уникальны (номера, email, IP 10.69.x.x).
 */
describe('Аудит E: dev inbox, обезличивание, карточка клиента', () => {
  let ctx: TestContext;
  let admin: Http;
  let b: BookableBranch;

  let ipSeq = Math.floor(Math.random() * 200) * 250;
  const ip = () => {
    ipSeq += 1;
    return `10.69.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
  };
  const http = () => new Http(ctx.app, ip());
  const phone = () => `+7705${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  let day = 3;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    await seedReferenceData(ctx.prisma);
    ctx.app.get(SystemSettingsService).invalidate();
    admin = await loginSuperadmin(ctx, await createSuperadmin(ctx, `root-e-${randomUUID().slice(0, 8)}@platform.kz`));
    b = await createBookableBranch(ctx, admin, { name: `Аудит E ${randomUUID().slice(0, 6)}` });
  });
  afterAll(async () => ctx.close());

  /** Публичная запись с подтверждением по ссылке и отправкой подтверждения в dev_inbox. */
  async function book(p: string, name = 'Клиент', comment?: string): Promise<string> {
    const h = http();
    const hold = await h.post(`${API}/public/branches/${b.slug}/bookings`, {
      startAt: localTime(futureDate(day++), '11:00'),
      items: [{ serviceId: b.services.haircut }],
      client: { name, phone: p },
      consents: { personalData: true },
      ...(comment ? { comment } : {}),
    });
    expect(hold.status).toBe(201);
    await drainNotifications(ctx);
    const confirm = await h.post(`${API}/public/bookings/confirm-link`, { token: await linkTokenFor(ctx, p) });
    expect(confirm.status).toBe(200);
    await drainNotifications(ctx);
    return hold.body.appointmentId as string;
  }

  /** Перенос записи в прошлое как завершённой (чтобы клиента можно было обезличить). */
  async function completeInPast(appointmentId: string, daysAgo = 10) {
    const end = DateTime.now().minus({ days: daysAgo }).toJSDate();
    await ctx.prisma.appointmentResource.updateMany({ where: { appointmentId }, data: { isActive: false } });
    await ctx.prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'completed', startAt: new Date(end.getTime() - 3600_000), endAt: end } });
  }

  describe('«Тестовый телефон» — только явным флагом (решение заказчика)', () => {
    it('fail-closed: NODE_ENV=production без APP_ENV, dev inbox в production, dev_inbox без флага — ошибка запуска', () => {
      const base = { ...process.env, NOTIFICATION_CHANNELS: 'whatsapp', DEV_INBOX_ENABLED: undefined };
      expect(() => loadConfig({ ...base, NODE_ENV: 'production', APP_ENV: undefined })).toThrow(/APP_ENV/);
      expect(() => loadConfig({ ...base, NODE_ENV: 'production', APP_ENV: '' })).toThrow(/APP_ENV/);
      expect(() => loadConfig({ ...base, NODE_ENV: 'production', APP_ENV: 'production', COOKIE_SECURE: 'true', DEV_INBOX_ENABLED: 'true' })).toThrow(/DEV_INBOX_ENABLED/);
      expect(() => loadConfig({ ...base, APP_ENV: 'development', NOTIFICATION_CHANNELS: 'dev_inbox' })).toThrow(/DEV_INBOX_ENABLED/);
      // по умолчанию выключен
      const def = loadConfig({ ...base, APP_ENV: 'development' });
      expect(def.DEV_INBOX_ENABLED).toBe(false);
      expect(devInboxEnabled(def)).toBe(false);
      // явно включён вне production; production-конфигурация без флага стартует
      expect(devInboxEnabled(loadConfig({ ...base, APP_ENV: 'development', DEV_INBOX_ENABLED: 'true', NOTIFICATION_CHANNELS: 'dev_inbox' }))).toBe(true);
      expect(() => loadConfig({ ...base, NODE_ENV: 'production', APP_ENV: 'production', COOKIE_SECURE: 'true' })).not.toThrow();
    });

    it('GET /dev/inbox и канал dev_inbox при DEV_INBOX_ENABLED=false → 404 / выключен; при true — работает', async () => {
      const p = phone();
      const saved = { flag: process.env.DEV_INBOX_ENABLED, channels: process.env.NOTIFICATION_CHANNELS };
      try {
        process.env.DEV_INBOX_ENABLED = 'false';
        process.env.NOTIFICATION_CHANNELS = '';
        resetConfigCache();
        const anon = http();
        const all = await anon.get(`${API}/dev/inbox`);
        expect(all.status).toBe(404);
        expect(all.body.error.code).toBe('NOT_FOUND');
        expect((await anon.get(`${API}/dev/inbox?phone=${encodeURIComponent(p)}`)).status).toBe(404);
        expect(ctx.app.get(DevInboxChannel).isConfigured()).toBe(false);
        await expect(
          ctx.app.get(DevInboxChannel).send({ recipient: p, type: 'otp', locale: 'ru', params: {}, text: 'x', providerTemplateName: null, templateVariables: [], category: 'AUTHENTICATION' }),
        ).rejects.toThrow(/dev_inbox/);
        expect(await ctx.prisma.devInboxMessage.count({ where: { recipient: p } })).toBe(0);
      } finally {
        process.env.DEV_INBOX_ENABLED = saved.flag;
        process.env.NOTIFICATION_CHANNELS = saved.channels;
        resetConfigCache();
      }
      expect((await http().get(`${API}/dev/inbox?phone=${encodeURIComponent(p)}`)).status).toBe(200);
    });
  });

  describe('обезличивание клиента (§22)', () => {
    it('по старым номерам и имени в данных организации не остаётся ПД; дубли обезличиваются вместе; чужие данные не затронуты', async () => {
      const p1 = phone();
      const p2 = phone();
      const other = phone();
      const secretName = `Секретов ${randomUUID().slice(0, 6)}`;
      const a1 = await book(p1, 'Клиент', `Перезвоните на ${p1}`);
      const a2 = await book(p2, secretName);
      await book(other, 'Сосед');
      const c1 = (await ctx.prisma.client.findFirstOrThrow({ where: { organizationId: b.orgId, phone: p1 } })).id;
      const c2 = (await ctx.prisma.client.findFirstOrThrow({ where: { organizationId: b.orgId, phone: p2 } })).id;
      // Общее согласие платформы («СТОП», organization_id = NULL) — не данные организации, сохраняется.
      await ctx.prisma.clientConsent.create({ data: { organizationId: null, phone: p1, consentType: 'marketing', granted: false, textVersion: 'v', source: 'whatsapp_stop' } });

      const orgBase = `${API}/organizations/${b.orgId}/clients`;
      expect((await b.owner.patch(`${orgBase}/${c1}`, { name: secretName, notes: `заметка ${p1}` })).status).toBe(200);
      expect((await b.owner.post(`${orgBase}/merge`, { sourceClientId: c2, targetClientId: c1 })).status).toBe(200);
      await completeInPast(a1);
      await completeInPast(a2, 12);
      // Сообщение в DLQ с зашифрованными параметрами (хранятся до повтора) — тоже ПД клиента.
      const dead = await ctx.prisma.notificationOutbox.findFirstOrThrow({ where: { organizationId: b.orgId, clientId: c1, type: 'appointment_confirmed' } });
      await ctx.prisma.notificationOutbox.update({ where: { id: dead.id }, data: { status: 'dead', payloadEncrypted: true, payload: { enc: 'secret-params' } } });
      expect((await b.owner.post(`${orgBase}/${c1}/anonymize`)).status).toBe(204);
      const deadAfter = await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: dead.id } });
      expect(deadAfter).toMatchObject({ status: 'cancelled', payloadEncrypted: false, payload: {} });
      expect(deadAfter.recipient).toMatch(/^anon-/);
      expect(await ctx.prisma.notificationOutbox.count({ where: { organizationId: b.orgId, clientId: { in: [c1, c2] }, OR: [{ payloadEncrypted: true }, { status: 'dead' }] } })).toBe(0);

      const phones = [p1, p2];
      const appts = [a1, a2];
      const like = (v: string) => `%${v}%`;
      const needles = [...phones, ...phones.map((x) => x.slice(1)), secretName].map(like);
      const org = b.orgId;

      const clients = await ctx.prisma.client.findMany({ where: { id: { in: [c1, c2] } } });
      for (const c of clients) {
        expect(c.name).toBe('Удалённый клиент');
        expect(c.phone).toMatch(/^anon-/);
        expect(c.notes).toBeNull();
        expect(c.anonymizedAt).not.toBeNull();
      }
      expect(await ctx.prisma.client.count({ where: { organizationId: org, OR: [{ phone: { in: phones } }, { name: secretName }] } })).toBe(0);
      expect(await ctx.prisma.clientConsent.count({ where: { organizationId: org, phone: { in: phones } } })).toBe(0);
      expect(await ctx.prisma.clientConsent.count({ where: { organizationId: org, clientId: { in: [c1, c2] }, ip: { not: null } } })).toBe(0);
      expect(await ctx.prisma.clientConsent.count({ where: { organizationId: org, clientId: { in: [c1, c2] } } })).toBeGreaterThan(0); // факт согласия сохранён
      expect(await ctx.prisma.clientConsent.count({ where: { organizationId: null, phone: p1 } })).toBe(1);
      expect(await ctx.prisma.bookingHold.count({ where: { organizationId: org, OR: [{ phone: { in: phones } }, { appointmentId: { in: appts }, ip: { not: null } }] } })).toBe(0);
      expect(await ctx.prisma.otpCode.count({ where: { OR: [{ phone: { in: phones } }, { appointmentId: { in: appts } }] } })).toBe(0);
      expect(await ctx.prisma.devInboxMessage.count({ where: { OR: [{ recipient: { in: phones } }, { text: { contains: p1 } }] } })).toBe(0);
      expect(await ctx.prisma.appointment.count({ where: { id: { in: appts }, comment: { not: null } } })).toBe(0);
      expect(await ctx.prisma.review.count({ where: { organizationId: org, authorName: secretName } })).toBe(0);
      const outbox = await ctx.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM notification_outbox
        WHERE organization_id = ${org}::uuid
          AND (recipient = ANY(${phones}::text[]) OR payload::text LIKE ANY(${needles}::text[]) OR dedupe_key LIKE ANY(${needles}::text[]))`;
      expect(outbox[0]!.n).toBe(0);
      expect(await ctx.prisma.notificationOutbox.count({ where: { organizationId: org, clientId: { in: [c1, c2] } } })).toBeGreaterThan(0);
      const audit = await ctx.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM audit_logs
        WHERE organization_id = ${org}::uuid AND (before::text LIKE ANY(${needles}::text[]) OR after::text LIKE ANY(${needles}::text[]))`;
      expect(audit[0]!.n).toBe(0);
      // события сохранены (обезличены), а не удалены; журнал аудита по-прежнему append-only
      expect(await ctx.prisma.auditLog.count({ where: { organizationId: org, action: { in: ['client.updated', 'client.merged', 'client.anonymized'] } } })).toBe(3);
      const row = await ctx.prisma.auditLog.findFirstOrThrow({ where: { organizationId: org, action: 'client.updated' } });
      await expect(ctx.prisma.auditLog.update({ where: { id: row.id }, data: { action: 'x' } })).rejects.toThrow(/append-only/);
      await expect(ctx.prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);

      // Соседний клиент той же организации не затронут.
      expect(await ctx.prisma.client.count({ where: { organizationId: org, phone: other, anonymizedAt: null } })).toBe(1);
      expect(await ctx.prisma.clientConsent.count({ where: { organizationId: org, phone: other } })).toBeGreaterThan(0);
      expect(await ctx.prisma.notificationOutbox.count({ where: { organizationId: org, recipient: other } })).toBeGreaterThan(0);
      expect(await ctx.prisma.devInboxMessage.count({ where: { recipient: other } })).toBeGreaterThan(0);

      // Карточка: обезличена; повторное обезличивание — 404; изменение обезличенной — 404.
      const card = await b.owner.get(`${orgBase}/${c1}`);
      expect(card.body).toMatchObject({ name: 'Удалённый клиент', anonymized: true, notes: null });
      expect((await b.owner.post(`${orgBase}/${c1}/anonymize`)).status).toBe(404);
      expect((await b.owner.patch(`${orgBase}/${c1}`, { name: 'Снова' })).status).toBe(404);
    });
  });

  describe('карточка клиента и администратор филиала', () => {
    it('BRANCH_ADMIN видит записи и отзывы клиента только своих филиалов', async () => {
      const p = phone();
      const a1 = await book(p);
      await completeInPast(a1);
      const clientId = (await ctx.prisma.client.findFirstOrThrow({ where: { organizationId: b.orgId, phone: p } })).id;
      const other = await b.owner.post(`${API}/organizations/${b.orgId}/branches`, { name: `Второй ${randomUUID().slice(0, 6)}`, timezone: TZ });
      expect(other.status).toBe(201);
      const branchB = other.body.id as string;
      const end = DateTime.now().minus({ days: 5 }).toJSDate();
      const a2 = await ctx.prisma.appointment.create({
        data: {
          organizationId: b.orgId,
          branchId: branchB,
          clientId,
          status: 'completed',
          startAt: new Date(end.getTime() - 3600_000),
          endAt: end,
          timezone: TZ,
          source: 'admin',
          baseTotal: 5000,
          totalPrice: 5000,
        },
      });
      await ctx.prisma.review.create({ data: { organizationId: b.orgId, branchId: b.branchId, appointmentId: a1, clientId, rating: 5, text: 'Отлично', authorName: 'Клиент' } });
      await ctx.prisma.review.create({ data: { organizationId: b.orgId, branchId: branchB, appointmentId: a2.id, clientId, rating: 2, text: 'Чужой филиал', authorName: 'Клиент' } });

      const email = `branch-e-${randomUUID().slice(0, 8)}@test.kz`;
      const created = await b.owner.post(`${API}/organizations/${b.orgId}/users`, {
        email,
        name: 'Админ филиала',
        temporaryPassword: 'Password123!',
        role: 'BRANCH_ADMIN',
        branchAccess: [{ branchId: b.branchId, permissions: ['clients.view'] }],
      });
      expect(created.status).toBe(201);
      const branchAdmin = await loginStaff(ctx, email, 'Password123!');

      const url = `${API}/organizations/${b.orgId}/clients/${clientId}`;
      const own = await b.owner.get(url);
      expect(own.body.reviews).toHaveLength(2);
      expect(own.body.appointments).toHaveLength(2);

      const card = await branchAdmin.get(url);
      expect(card.status).toBe(200);
      expect(card.body.appointments.map((x: { branchId: string }) => x.branchId)).toEqual([b.branchId]);
      expect(card.body.reviews.map((x: { branchId: string }) => x.branchId)).toEqual([b.branchId]);
      expect(card.body.stats.visits).toBe(1);
      // Изменение карточки требует appointments.manage в филиале клиента.
      expect((await branchAdmin.patch(url, { notes: 'x' })).status).toBe(403);
      expect((await branchAdmin.post(`${url}/anonymize`)).status).toBe(403);
    });
  });
});
