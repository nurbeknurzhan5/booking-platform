import { randomUUID } from 'node:crypto';
import { API, bootstrapTestApp, createOrgWithOwner, createSuperadmin, Http, loginStaff, loginSuperadmin, type TestContext } from './helpers';
import { createBookableBranch, drainNotifications, futureDate, localTime, type BookableBranch } from './fixtures';
import { seedReferenceData } from '../src/seed/reference-data';
import { SystemSettingsService } from '../src/common/system-settings.service';
import { IdempotencyService } from '../src/common/idempotency.service';
import { stableHash } from '../src/common/crypto';
import { NotificationService } from '../src/notifications/notification.service';
import { NotificationDispatcher } from '../src/notifications/dispatcher.service';
import { BookingService } from '../src/booking/booking.service';

/**
 * Аудит C: кабинет /me по непроверенному телефону, секреты в outbox, ссылка в сообщении о переносе,
 * области ключей идемпотентности, граничные случаи бронирования.
 * Тестовая БД общая: тест не очищает её, все данные уникальны (номера, email, IP 10.67.x.x).
 */
describe('Аудит C: бронирование, кабинет клиента, идемпотентность', () => {
  let ctx: TestContext;
  let admin: Http;
  let b: BookableBranch;
  const date = futureDate(5);

  let ipSeq = Math.floor(Math.random() * 200) * 250;
  const ip = () => {
    ipSeq += 1;
    return `10.67.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
  };
  const http = () => new Http(ctx.app, ip());
  const phone = () => `+7707${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    await seedReferenceData(ctx.prisma);
    ctx.app.get(SystemSettingsService).invalidate();
    admin = await loginSuperadmin(ctx, await createSuperadmin(ctx, `root-c-${randomUUID().slice(0, 8)}@platform.kz`));
    b = await createBookableBranch(ctx, admin, { name: `Аудит C ${randomUUID().slice(0, 6)}` });
  });
  afterAll(async () => ctx.close());

  const lastMessage = async (recipient: string, type: string) => {
    await drainNotifications(ctx);
    return ctx.prisma.devInboxMessage.findFirst({ where: { recipient, type }, orderBy: { createdAt: 'desc' } });
  };

  /** Гостевая запись: резерв → ссылка из сообщения → подтверждение. */
  async function book(startAt: string, p = phone(), items: Array<{ serviceId: string; specialistId?: string | null }> = [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }]) {
    const h = http();
    const hold = await h.post(`${API}/public/branches/${b.slug}/bookings`, { startAt, items, client: { name: 'Гость', phone: p }, consents: { personalData: true } });
    expect(hold.status).toBe(201);
    const msg = await lastMessage(p, 'booking_link');
    const token = /\/confirm\/([0-9a-f-]{36}\.[A-Za-z0-9_-]+)/.exec(msg!.text)![1]!;
    const confirm = await h.post(`${API}/public/bookings/confirm-link`, { token });
    expect(confirm.status).toBe(200);
    return { phone: p, appointmentId: hold.body.appointmentId as string, manageToken: confirm.body.manageToken as string };
  }

  async function clientLogin(p: string) {
    const h = http();
    await ctx.prisma.otpCode.updateMany({ where: { phone: p }, data: { createdAt: new Date(Date.now() - 3600_000) } });
    expect((await h.post(`${API}/auth/client/otp/request`, { phone: p })).status).toBe(200);
    const msg = await lastMessage(p, 'otp');
    const v = await h.post(`${API}/auth/client/otp/verify`, { phone: p, code: /(\d{6})/.exec(msg!.text)![1] });
    expect(v.status).toBe(200);
    return h;
  }

  async function enableWaitlist() {
    const url = `${API}/organizations/${b.orgId}/branches/${b.branchId}/booking-settings`;
    const cur = await b.owner.get(url);
    expect((await b.owner.put(url, { ...cur.body, waitlistEnabled: true })).status).toBe(200);
  }

  describe('[BLOCKER] непроверенный телефон сотрудника не открывает чужие записи', () => {
    it('сотрудник орг. A с номером гостя орг. B не видит и не меняет его записи и заявки; после входа по коду — видит', async () => {
      const P = phone();
      const { orgId: orgA, owner: ownerA } = await createOrgWithOwner(ctx, admin, { name: 'Аудит C — A' });
      const email = `staff-c-${randomUUID().slice(0, 8)}@test.kz`;
      const created = await ownerA.post(`${API}/organizations/${orgA}/users`, { email, name: 'Сотрудник', phone: P, temporaryPassword: 'Password123!', role: 'BRANCH_ADMIN' });
      expect(created.status).toBe(201);
      const staff = await loginStaff(ctx, email, 'Password123!');
      const staffUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(staffUser.phoneVerifiedAt).toBeNull();

      // гость бронирует в орг. B на номер P
      const g = await book(localTime(date, '10:00'), P);
      const client = await ctx.prisma.client.findFirstOrThrow({ where: { organizationId: b.orgId, phone: P } });
      expect(client.userId).toBeNull();

      const list = await staff.get(`${API}/me/appointments`);
      expect(list.status).toBe(200);
      expect(list.body).toEqual([]);
      expect((await staff.get(`${API}/me/appointments?scope=history`)).body).toEqual([]);
      expect((await staff.post(`${API}/me/appointments/${g.appointmentId}/cancel`, {})).status).toBe(404);
      expect((await staff.post(`${API}/me/appointments/${g.appointmentId}/reschedule`, { startAt: localTime(date, '15:00') })).status).toBe(404);
      expect((await staff.post(`${API}/me/appointments/${g.appointmentId}/availability`, { date, items: [{ serviceId: b.services.haircut }] })).status).toBe(404);
      expect((await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: g.appointmentId } })).status).toBe('confirmed');

      // лист ожидания: заявка гостя с номером P подтверждена кодом — к сотруднику не привязывается
      await enableWaitlist();
      const wh = http();
      const join = await wh.post(`${API}/public/branches/${b.slug}/waitlist`, {
        items: [{ serviceId: b.services.color }],
        dateFrom: date,
        dateTo: date,
        client: { name: 'Гость', phone: P },
        consents: { personalData: true },
      });
      expect(join.status).toBe(201);
      const code = /(\d{6})/.exec((await lastMessage(P, 'otp'))!.text)![1]!;
      expect((await wh.post(`${API}/public/waitlist/${join.body.entryId}/confirm`, { token: join.body.token, code })).status).toBe(200);
      expect((await ctx.prisma.client.findUniqueOrThrow({ where: { id: client.id } })).userId).toBeNull();
      expect((await staff.get(`${API}/me/waitlist`)).body).toEqual([]);
      expect((await staff.post(`${API}/me/waitlist/${join.body.entryId}/cancel`, {})).status).toBe(404);
      expect((await ctx.prisma.waitlistEntry.findUniqueOrThrow({ where: { id: join.body.entryId } })).status).toBe('waiting');

      // согласия платформы по номеру P сотрудник не меняет (иначе отключил бы уведомления владельцу номера)
      expect((await staff.patch(`${API}/me/profile`, { consents: { notifications: false } })).status).toBe(200);
      expect(await ctx.prisma.clientConsent.count({ where: { phone: P, organizationId: null } })).toBe(0);

      // регрессия: владелец номера подтверждает его кодом — записи и заявки видны
      const me = await clientLogin(P);
      const mine = await me.get(`${API}/me/appointments`);
      expect(mine.body.map((a: { id: string }) => a.id)).toContain(g.appointmentId);
      expect((await me.get(`${API}/me/waitlist`)).body.map((e: { id: string }) => e.id)).toContain(join.body.entryId);
    });

    it('подтверждение гостевой записи не привязывает карточку к профилю с непроверенным номером', async () => {
      const P = phone();
      const u = await ctx.prisma.user.create({ data: { email: `nv-${randomUUID().slice(0, 8)}@test.kz`, name: 'Без подтверждения', phone: P } });
      const g = await book(localTime(date, '11:00'), P);
      const appt = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: g.appointmentId }, include: { client: true } });
      expect(appt.client.userId).toBeNull();
      // после подтверждения номера карточка привязывается при следующем бронировании
      await ctx.prisma.user.update({ where: { id: u.id }, data: { phoneVerifiedAt: new Date() } });
      await ctx.prisma.otpCode.updateMany({ where: { phone: P }, data: { createdAt: new Date(Date.now() - 3600_000) } });
      await book(localTime(date, '13:00'), P);
      expect((await ctx.prisma.client.findUniqueOrThrow({ where: { id: appt.clientId } })).userId).toBe(u.id);
    });
  });

  describe('[MAJOR] ссылка управления не хранится в outbox открытым текстом', () => {
    it('appointment_confirmed (онлайн и вручную) зашифрован, доставка работает, payload стирается', async () => {
      const g = await book(localTime(date, '12:00'));
      const rows = await ctx.prisma.$queryRaw<Array<{ payload: string; payload_encrypted: boolean }>>`
        SELECT payload::text AS payload, payload_encrypted FROM notification_outbox WHERE type = 'appointment_confirmed' AND appointment_id = ${g.appointmentId}::uuid`;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.payload).not.toContain(g.manageToken);
      expect(rows[0]!.payload).not.toContain('/manage/');
      expect(rows[0]!.payload_encrypted).toBe(true);
      const msg = await lastMessage(g.phone, 'appointment_confirmed');
      expect(msg!.text).toContain(`/manage/${g.manageToken}`);
      const after = await ctx.prisma.notificationOutbox.findFirstOrThrow({ where: { type: 'appointment_confirmed', appointmentId: g.appointmentId } });
      expect(after.status).toBe('sent');
      expect(after.payload).toEqual({});

      const P = phone();
      const manual = await b.owner.post(`${API}/organizations/${b.orgId}/appointments`, {
        branchId: b.branchId,
        startAt: localTime(date, '16:00'),
        items: [{ serviceId: b.services.haircut, specialistId: b.specialists.bolat }],
        client: { name: 'Ручной', phone: P },
        notifyClient: true,
      });
      expect(manual.status).toBe(201);
      const mrow = await ctx.prisma.notificationOutbox.findFirstOrThrow({ where: { type: 'appointment_confirmed', appointmentId: manual.body.id } });
      expect(mrow.payloadEncrypted).toBe(true);
      expect(JSON.stringify(mrow.payload)).not.toContain('/manage/');
      expect((await lastMessage(P, 'appointment_confirmed'))!.text).toMatch(/\/manage\/[A-Za-z0-9_-]{20,}/);
    });

    it('DLQ: зашифрованное подтверждение можно повторить, одноразовый код — нет', async () => {
      const P = phone();
      const notifications = ctx.app.get(NotificationService);
      const dispatcher = ctx.app.get(NotificationDispatcher);
      const params = { clientName: 'A', branchName: 'B', date: 'd', time: 't', services: 's', total: '1', manageUrl: `https://x/ru/manage/secret-${randomUUID()}` };
      const id = await ctx.prisma.$transaction((tx) =>
        notifications.enqueue(tx, { organizationId: b.orgId, type: 'appointment_confirmed', eventKey: `audit-c:${randomUUID()}`, recipient: P, locale: 'ru', params, sensitive: true }),
      );
      const otpId = await ctx.prisma.$transaction((tx) =>
        notifications.enqueue(tx, { organizationId: b.orgId, type: 'otp', eventKey: `audit-c:otp:${randomUUID()}`, recipient: P, locale: 'ru', params: { code: '123456', minutes: '5' }, sensitive: true }),
      );
      // канал без адаптера — постоянная ошибка, сообщение сразу уходит в DLQ
      await ctx.prisma.notificationOutbox.updateMany({ where: { id: { in: [id!, otpId!] } }, data: { channel: 'email' } });
      await dispatcher.drain();
      const dead = await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: id! } });
      expect(dead.status).toBe('dead');
      expect(JSON.stringify(dead.payload)).not.toContain('secret-');
      expect((await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: otpId! } })).payload).toEqual({});

      expect(await dispatcher.retryDead(otpId!)).toBe(false);
      expect(await dispatcher.retryDead(id!)).toBe(true);
      await ctx.prisma.notificationOutbox.update({ where: { id: id! }, data: { channel: 'dev_inbox' } });
      await dispatcher.drain();
      const sent = await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: id! } });
      expect(sent.status).toBe('sent');
      expect(sent.payload).toEqual({});
      expect((await ctx.prisma.devInboxMessage.findFirstOrThrow({ where: { recipient: P, type: 'appointment_confirmed' } })).text).toContain(params.manageUrl);
      // повторно отправленное больше не повторяется
      expect(await dispatcher.retryDead(id!)).toBe(false);
    });
  });

  describe('[MINOR] сообщение о переносе ведёт гостя на страницу управления', () => {
    it('перенос по ссылке → ссылка управления (зашифрована в outbox); перенос администратором → кабинет', async () => {
      const g = await book(localTime(date, '14:00'));
      const r = await http().post(`${API}/public/manage/${g.manageToken}/reschedule`, { startAt: localTime(date, '14:30') });
      expect(r.status).toBe(200);
      const row = await ctx.prisma.notificationOutbox.findFirstOrThrow({ where: { type: 'appointment_rescheduled', appointmentId: g.appointmentId } });
      expect(row.payloadEncrypted).toBe(true);
      expect(JSON.stringify(row.payload)).not.toContain(g.manageToken);
      const msg = await lastMessage(g.phone, 'appointment_rescheduled');
      expect(msg!.text).toContain(`/ru/manage/${g.manageToken}`);
      expect(msg!.text).not.toContain('/cabinet');

      const s = await b.owner.post(`${API}/organizations/${b.orgId}/appointments/${g.appointmentId}/reschedule`, { startAt: localTime(date, '15:30') });
      expect(s.status).toBe(200);
      const rows = await ctx.prisma.notificationOutbox.findMany({ where: { type: 'appointment_rescheduled', appointmentId: g.appointmentId }, orderBy: { createdAt: 'asc' } });
      expect(rows).toHaveLength(2);
      expect(rows[1]!.payloadEncrypted).toBe(false);
      expect(JSON.stringify(rows[1]!.payload)).toContain('/ru/cabinet');
      // прежняя ссылка управления продолжает действовать
      expect((await http().get(`${API}/public/manage/${g.manageToken}`)).status).toBe(200);
    });
  });

  describe('[MINOR] идемпотентность: области ключей разделены по действующему лицу', () => {
    it('один Idempotency-Key у сотрудника и гостя не пересекается', async () => {
      const g = await book(localTime(date, '17:00'));
      const key = `audit-c-${randomUUID()}`;
      const s = await b.owner.post(`${API}/organizations/${b.orgId}/appointments/${g.appointmentId}/reschedule`, { startAt: localTime(date, '17:30') }, { 'Idempotency-Key': key });
      expect(s.status).toBe(200);
      const guest = await http().post(`${API}/public/manage/${g.manageToken}/reschedule`, { startAt: localTime(date, '18:00') }, { 'Idempotency-Key': key });
      expect(guest.status).toBe(200);
      expect(guest.body.startAt).toBe(new Date(localTime(date, '18:00')).toISOString());
      const scopes = (await ctx.prisma.idempotencyKey.findMany({ where: { key } })).map((r) => r.scope).sort();
      const ownerId = (await ctx.prisma.userOrganizationRole.findFirstOrThrow({ where: { organizationId: b.orgId, roleCode: 'OWNER' } })).userId;
      expect(scopes).toHaveLength(2);
      expect(scopes.some((sc) => sc.startsWith('reschedule:guest:') && sc.endsWith(g.appointmentId) && !sc.includes(g.manageToken))).toBe(true);
      expect(scopes).toContain(`reschedule:staff:${ownerId}:${g.appointmentId}`);
      // повтор гостя тем же ключом и телом — сохранённый ответ, без повторного переноса
      const again = await http().post(`${API}/public/manage/${g.manageToken}/reschedule`, { startAt: localTime(date, '18:00') }, { 'Idempotency-Key': key });
      expect(again.status).toBe(200);
      expect((await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: g.appointmentId } })).rescheduleCount).toBe(2);
      // клиент кабинета и сотрудник при отмене тоже в разных областях
      const me = await clientLogin(g.phone);
      const c = await me.post(`${API}/me/appointments/${g.appointmentId}/cancel`, {}, { 'Idempotency-Key': key });
      expect(c.status).toBe(200);
      expect((await ctx.prisma.idempotencyKey.findMany({ where: { key, scope: { startsWith: 'cancel:client:' } } })).length).toBe(1);
    });

    it('брошенный ключ «в работе» и просроченный ключ не блокируют повтор; сбой записи ответа не превращает успех в ошибку', async () => {
      const idem = ctx.app.get(IdempotencyService);
      const scope = `audit-c:${randomUUID()}`;
      const body = { a: 1 };
      // свежий незавершённый — 409
      const k1 = `k1-${randomUUID()}`;
      await ctx.prisma.idempotencyKey.create({ data: { scope, key: k1, requestHash: stableHash(body) } });
      await expect(idem.run(scope, k1, body, async () => ({ body: 'x' }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
      // брошенный (старше 10 минут) с тем же телом — выполняется заново
      const k2 = `k2-${randomUUID()}`;
      await ctx.prisma.idempotencyKey.create({ data: { scope, key: k2, requestHash: stableHash(body), createdAt: new Date(Date.now() - 11 * 60_000) } });
      const r2 = await idem.run(scope, k2, body, async () => ({ body: 'fresh' }));
      expect(r2).toMatchObject({ body: 'fresh', replayed: false });
      expect((await idem.run(scope, k2, body, async () => ({ body: 'second' }))).body).toBe('fresh');
      // брошенный с другим телом — 422
      const k3 = `k3-${randomUUID()}`;
      await ctx.prisma.idempotencyKey.create({ data: { scope, key: k3, requestHash: stableHash({ other: true }), createdAt: new Date(Date.now() - 11 * 60_000) } });
      await expect(idem.run(scope, k3, body, async () => ({ body: 'x' }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      // просроченный (старше 48 ч, ещё не удалён очисткой) — ключ свободен
      const k4 = `k4-${randomUUID()}`;
      await ctx.prisma.idempotencyKey.create({
        data: { scope, key: k4, requestHash: stableHash({ old: true }), completedAt: new Date(), responseStatus: 200, responseBody: 'old', createdAt: new Date(Date.now() - 49 * 3600_000) },
      });
      expect(await idem.run(scope, k4, body, async () => ({ body: 'new' }))).toMatchObject({ body: 'new', replayed: false });
      // ответ не записался (здесь — не сериализуется в JSON): операция выполнена, результат возвращается,
      // ключ не освобождается — повтор не выполнит операцию второй раз
      let calls = 0;
      const k5 = `k5-${randomUUID()}`;
      const circular = (): Record<string, unknown> => {
        calls++;
        const o: Record<string, unknown> = { n: calls };
        o.self = o;
        return o;
      };
      const r5 = await idem.run(scope, k5, body, async () => ({ body: circular() }));
      expect(r5).toMatchObject({ replayed: false, body: { n: 1 } });
      await expect(idem.run(scope, k5, body, async () => ({ body: circular() }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
      expect(calls).toBe(1);
    });
  });

  describe('граничные случаи', () => {
    it('startAt вне сетки слотов → 409 SLOT_UNAVAILABLE, не 500', async () => {
      for (const hhmm of ['10:07', '10:00:30', '09:30', '20:00']) {
        const r = await http().post(`${API}/public/branches/${b.slug}/bookings`, {
          startAt: localTime(date, hhmm),
          items: [{ serviceId: b.services.haircut }],
          client: { name: 'Гость', phone: phone() },
          consents: { personalData: true },
        });
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe('SLOT_UNAVAILABLE');
      }
    });

    it('перенос гостем за горизонт записи → 400 BOOKING_TOO_FAR; сотрудником — можно', async () => {
      const g = await book(localTime(date, '19:00'));
      const far = localTime(futureDate(70), '12:00');
      const r = await http().post(`${API}/public/manage/${g.manageToken}/reschedule`, { startAt: far });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('BOOKING_TOO_FAR');
      const me = await clientLogin(g.phone);
      const r2 = await me.post(`${API}/me/appointments/${g.appointmentId}/reschedule`, { startAt: far });
      expect(r2.status).toBe(400);
      expect(r2.body.error.code).toBe('BOOKING_TOO_FAR');
      const s = await b.owner.post(`${API}/organizations/${b.orgId}/appointments/${g.appointmentId}/reschedule`, { startAt: far });
      expect(s.status).toBe(200);
    });

    it('длительность в расчёте стоимости совпадает со слотом: учитывается буфер «до» следующей услуги', async () => {
      const svc = await b.owner.post(`${API}/organizations/${b.orgId}/services`, {
        name: `С подготовкой ${randomUUID().slice(0, 4)}`,
        price: 1000,
        durationMinutes: 30,
        bufferBeforeMinutes: 15,
        requiresSpecialist: false,
        branches: [{ branchId: b.branchId }],
      });
      expect(svc.status).toBe(201);
      const items = [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }, { serviceId: svc.body.id }];
      const q = await http().post(`${API}/public/branches/${b.slug}/quote`, { items });
      expect(q.status).toBe(200);
      const av = await http().post(`${API}/public/branches/${b.slug}/availability`, { date: futureDate(6), items });
      expect(av.status).toBe(200);
      const slot = av.body.slots[0];
      const slotMinutes = (new Date(slot.endAt).getTime() - new Date(slot.startAt).getTime()) / 60_000;
      expect(slotMinutes).toBe(60 + 15 + 30);
      expect(q.body.durationMinutes).toBe(slotMinutes);
    });

    it('параллельные первые запросы к филиалу без настроек записи не дают 500', async () => {
      const br = await b.owner.post(`${API}/organizations/${b.orgId}/branches`, { name: `Без настроек ${randomUUID().slice(0, 6)}` });
      expect(br.status).toBe(201);
      await ctx.prisma.bookingSettings.deleteMany({ where: { branchId: br.body.id } });
      const statuses = await Promise.all(
        Array.from({ length: 8 }, () =>
          b.owner.post(`${API}/organizations/${b.orgId}/waitlist`, {
            branchId: br.body.id,
            items: [{ serviceId: b.services.haircut }],
            dateFrom: date,
            dateTo: date,
            client: { name: 'Клиент', phone: phone() },
          }).then((r) => r.status),
        ),
      );
      expect(statuses.filter((s) => s >= 500)).toEqual([]);
      expect(new Set(statuses)).toEqual(new Set([403]));
      expect(await ctx.prisma.bookingSettings.count({ where: { branchId: br.body.id } })).toBe(1);
    });

    it('параллельные переносы: «старое» время в истории соответствует предыдущему переносу', async () => {
      const g = await book(localTime(date, '10:30'), phone(), [{ serviceId: b.services.haircut, specialistId: b.specialists.bolat }]);
      const booking = ctx.app.get(BookingService);
      const actor = { userId: null, actorType: 'user' as const, ip: null, userAgent: null };
      const results = await Promise.allSettled([
        booking.reschedule(g.appointmentId, { startAt: localTime(date, '11:30') }, actor, 'admin'),
        booking.reschedule(g.appointmentId, { startAt: localTime(date, '12:30') }, actor, 'admin'),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      const rs = await ctx.prisma.appointmentReschedule.findMany({ where: { appointmentId: g.appointmentId }, orderBy: { createdAt: 'asc' } });
      expect(rs).toHaveLength(2);
      expect(rs[0]!.oldStartAt.toISOString()).toBe(new Date(localTime(date, '10:30')).toISOString());
      expect(rs[1]!.oldStartAt.toISOString()).toBe(rs[0]!.newStartAt.toISOString());
      const appt = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: g.appointmentId } });
      expect(appt.startAt.toISOString()).toBe(rs[1]!.newStartAt.toISOString());
    });
  });
});
