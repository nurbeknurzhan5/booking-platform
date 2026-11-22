import { API, bootstrapTestApp, createSuperadmin, Http, loginSuperadmin, resetDb, type TestContext } from './helpers';
import { bookAndConfirm, createBookableBranch, drainNotifications, futureDate, linkTokenFor, localTime, nextPhone, type BookableBranch } from './fixtures';
import { BookingService } from '../src/booking/booking.service';
import { NotificationService } from '../src/notifications/notification.service';

describe('Этап 4: онлайн-запись', () => {
  let ctx: TestContext;
  let admin: Http;
  let b: BookableBranch;
  const date = futureDate(3);

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx);
    admin = await loginSuperadmin(ctx, await createSuperadmin(ctx));
    b = await createBookableBranch(ctx, admin);
  });

  const holdBody = (startAt: string, items: Array<{ serviceId: string; specialistId?: string | null }>, phone = nextPhone(), extra: object = {}) => ({
    startAt,
    items,
    client: { name: 'Айгерим', phone },
    consents: { personalData: true },
    ...extra,
  });

  describe('доступные слоты', () => {
    it('учитывают расписание филиала, длительность и часовой пояс', async () => {
      const r = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/availability`, {
        date,
        items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }],
      });
      expect(r.status).toBe(200);
      expect(r.body.timezone).toBe('Asia/Almaty');
      expect(r.body.slots[0].startAt).toBe(new Date(localTime(date, '10:00')).toISOString());
      // последний слот 19:00 (60 мин до 20:00)
      expect(r.body.slots.at(-1).startAt).toBe(new Date(localTime(date, '19:00')).toISOString());
      expect(r.body.slots).toHaveLength(19);
    });

    it('исключение «закрыто» убирает все слоты; обязательный кабинет учитывается', async () => {
      await b.owner.post(`${API}/organizations/${b.orgId}/branches/${b.branchId}/schedule/exceptions`, {
        resourceId: null,
        dateFrom: date,
        dateTo: date,
        kind: 'closed',
        reason: 'Праздник',
      });
      const r = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/availability`, { date, items: [{ serviceId: b.services.haircut }] });
      expect(r.body.slots).toHaveLength(0);
    });

    it('занятый кабинет скрывает слот массажа даже при свободном специалисте (§7)', async () => {
      const first = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '12:00'), items: [{ serviceId: b.services.massage, specialistId: b.specialists.ivan }] });
      expect(first.confirm?.status).toBe(200);
      const r = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/availability`, {
        date,
        items: [{ serviceId: b.services.massage, specialistId: b.specialists.petr }],
      });
      const starts = r.body.slots.map((s: { startAt: string }) => s.startAt);
      // кабинет занят 12:00–13:15 (буфер 15 мин после)
      expect(starts).not.toContain(new Date(localTime(date, '12:00')).toISOString());
      expect(starts).not.toContain(new Date(localTime(date, '11:30')).toISOString());
      expect(starts).not.toContain(new Date(localTime(date, '13:00')).toISOString());
      expect(starts).toContain(new Date(localTime(date, '13:30')).toISOString());
    });
  });

  describe('групповая бронь мест (D-41)', () => {
    /** Ряд из 4 ПК и услуга «ПК · 1 час» без специалиста. */
    async function pcRow() {
      const org = b.orgId;
      const svc = await ctx.prisma.service.create({ data: { organizationId: org, name: 'ПК · 1 час', price: 1000, durationMinutes: 60, requiresSpecialist: false } });
      await ctx.prisma.branchService.create({ data: { organizationId: org, branchId: b.branchId, serviceId: svc.id } });
      await ctx.prisma.serviceResource.create({ data: { organizationId: org, serviceId: svc.id, resourceType: 'equipment', quantity: 1 } });
      for (let n = 1; n <= 4; n++) {
        const r = await ctx.prisma.resource.create({ data: { organizationId: org, branchId: b.branchId, type: 'equipment', name: `ПК ${n}`, sortOrder: n, isPublic: true } });
        await ctx.prisma.resourceService.create({ data: { organizationId: org, resourceId: r.id, serviceId: svc.id } });
      }
      return svc.id;
    }
    const av = (items: object[]) => new Http(ctx.app).post(`${API}/public/branches/${b.slug}/availability`, { date, items });
    const at10 = new Date(localTime(date, '10:00')).toISOString();

    it('три места рядом: одна запись, цена × 3, места подряд; остаток ряда учитывается', async () => {
      const pc = await pcRow();
      const quote = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/quote`, { items: [{ serviceId: pc, seats: 3, together: true }] });
      expect(quote.body.totalPrice).toBe(3000);
      const { confirm } = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '10:00'), items: [{ serviceId: pc, seats: 3, together: true }] });
      expect(confirm?.status).toBe(200);
      const item = confirm!.body.appointment.items[0];
      expect(item.seats).toBe(3);
      expect(item.places).toEqual(['ПК 1', 'ПК 2', 'ПК 3']);
      expect(confirm!.body.appointment.price.total).toBe(3000);

      // в 10:00 остался один ПК: двое рядом не сядут, один — сядет
      expect((await av([{ serviceId: pc, seats: 2, together: true }])).body.slots.map((s: { startAt: string }) => s.startAt)).not.toContain(at10);
      expect((await av([{ serviceId: pc, seats: 1 }])).body.slots.map((s: { startAt: string }) => s.startAt)).toContain(at10);
      // 5 мест в ряду из 4 не бывает
      expect((await av([{ serviceId: pc, seats: 5 }])).body.slots).toHaveLength(0);
    });

    it('несколько мест нельзя выбрать для услуги со специалистом', async () => {
      const r = await av([{ serviceId: b.services.haircut, seats: 2 }]);
      expect(r.status).toBe(400);
    });
  });

  describe('запись на одной странице: обзор доступности', () => {
    const overview = (items: Array<{ serviceId: string; specialistId?: string | null }>, d = date) =>
      new Http(ctx.app).post(`${API}/public/branches/${b.slug}/availability/overview`, { date: d, items });

    it('слоты на дату, окна по 14 дням и по каждому мастеру выбранной услуги', async () => {
      const r = await overview([{ serviceId: b.services.haircut }]);
      expect(r.status).toBe(200);
      expect(r.body.slots).toHaveLength(19);
      expect(r.body.days).toHaveLength(14);
      expect(r.body.days.find((x: { date: string }) => x.date === date).count).toBe(19);
      // стрижку делают Анна и Болат; массажисты в списке не появляются
      const ids = r.body.specialists.map((x: { id: string }) => x.id).sort();
      expect(ids).toEqual([b.specialists.anna, b.specialists.bolat].sort());
      expect(r.body.specialists.every((x: { count: number }) => x.count === 19)).toBe(true);
    });

    it('выходной мастера: у него 0 окон в этот день, у «любого» время остаётся; при выбранном мастере день пустой', async () => {
      const annaRes = (await ctx.prisma.specialist.findUniqueOrThrow({ where: { id: b.specialists.anna } })).resourceId;
      const ex = await b.owner.post(`${API}/organizations/${b.orgId}/branches/${b.branchId}/schedule/exceptions`, { resourceId: annaRes, dateFrom: date, dateTo: date, kind: 'closed', reason: 'Выходной' });
      expect(ex.status).toBe(201);
      const any = await overview([{ serviceId: b.services.haircut }]);
      expect(any.body.slots).toHaveLength(19);
      const count = (id: string) => any.body.specialists.find((x: { id: string }) => x.id === id).count;
      expect(count(b.specialists.anna)).toBe(0);
      expect(count(b.specialists.bolat)).toBe(19);
      const withAnna = await overview([{ serviceId: b.services.haircut, specialistId: b.specialists.anna }]);
      expect(withAnna.body.slots).toHaveLength(0);
      expect(withAnna.body.days.find((x: { date: string }) => x.date === date).count).toBe(0);
      // в другие дни Анна работает — клиенту есть куда перейти
      expect(withAnna.body.days.some((x: { count: number }) => x.count > 0)).toBe(true);
    });

    it('несколько услуг: мастер указан для своих услуг, по остальным подбирается свободный', async () => {
      const r = await overview([{ serviceId: b.services.haircut }, { serviceId: b.services.massage }]);
      expect(r.status).toBe(200);
      const bolat = r.body.specialists.find((x: { id: string }) => x.id === b.specialists.bolat);
      expect(bolat.serviceIds).toEqual([b.services.haircut]);
      expect(bolat.count).toBeGreaterThan(0);
      expect(r.body.specialists.map((x: { id: string }) => x.id)).toContain(b.specialists.ivan);
    });

    it('проверяет дату и мастера так же, как обычный поиск слотов', async () => {
      expect((await overview([{ serviceId: b.services.haircut }], '2020-01-01')).status).toBe(400);
      expect((await overview([{ serviceId: b.services.massage, specialistId: b.specialists.anna }])).status).toBe(400);
    });
  });

  describe('полный сценарий клиента (§8.1)', () => {
    it('резерв → OTP → подтверждение; snapshot цены; уведомление; ссылка управления', async () => {
      const { hold, confirm, phone } = await bookAndConfirm(ctx, b.slug, {
        startAt: localTime(date, '11:00'),
        items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }],
      });
      expect(hold.status).toBe(201);
      expect(hold.body.appointment.status).toBe('pending_otp');
      expect(new Date(hold.body.holdExpiresAt).getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
      expect(confirm!.status).toBe(200);
      expect(confirm!.body.appointment.status).toBe('confirmed');
      expect(confirm!.body.appointment.price.total).toBe(5000);
      expect(confirm!.body.manageToken).toBeTruthy();

      // Секрет ссылки хранится только в виде HMAC, payload outbox стёрт после отправки (D-42)
      const otp = await ctx.prisma.otpCode.findFirstOrThrow({ where: { phone } });
      expect(otp.codeHash).toHaveLength(64);
      expect(otp.consumedAt).not.toBeNull();
      const linkOutbox = await ctx.prisma.notificationOutbox.findFirstOrThrow({ where: { recipient: phone, type: 'booking_link' } });
      expect(linkOutbox.payload).toEqual({});
      const linkMsg = await ctx.prisma.devInboxMessage.findFirstOrThrow({ where: { recipient: phone, type: 'booking_link' } });
      expect(linkMsg.text).toMatch(/\/ru\/confirm\/[0-9a-f-]{36}\.[A-Za-z0-9_-]{32}/);
      expect(linkMsg.text).not.toMatch(/\b\d{6}\b/);

      await drainNotifications(ctx);
      const confirmMsg = await ctx.prisma.devInboxMessage.findFirstOrThrow({ where: { recipient: phone, type: 'appointment_confirmed' } });
      expect(confirmMsg.text).toContain('Стрижка');

      // изменение цены услуги не меняет созданную запись (§5, критерий 11)
      await b.owner.patch(`${API}/organizations/${b.orgId}/services/${b.services.haircut}`, { price: 9999, name: 'Стрижка VIP' });
      const view = await new Http(ctx.app).get(`${API}/public/manage/${confirm!.body.manageToken}`);
      expect(view.status).toBe(200);
      expect(view.body.price.total).toBe(5000);
      expect(view.body.items[0].serviceName).toBe('Стрижка');

      // регрессия: частичный PATCH не сбрасывает остальные поля (филиалы, активность, буферы)
      const svc = await ctx.prisma.service.findUniqueOrThrow({ where: { id: b.services.haircut }, include: { branchServices: true } });
      expect(svc).toMatchObject({ price: 9999, isActive: true, onlineBookingEnabled: true });
      expect(svc.branchServices.map((x) => x.branchId)).toEqual([b.branchId]);
      const slotsAfter = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/availability`, { date, items: [{ serviceId: b.services.haircut }] });
      expect(slotsAfter.status).toBe(200);
      expect(slotsAfter.body.slots.length).toBeGreaterThan(0);

      const history = await ctx.prisma.appointmentStatusHistory.findMany({ where: { appointmentId: hold.body.appointmentId }, orderBy: { createdAt: 'asc' } });
      expect(history.map((h) => h.toStatus)).toEqual(['pending_otp', 'confirmed']);
    });

    it('время хранится в UTC без сдвига (регрессия: часовой пояс сервера БД ≠ UTC)', async () => {
      const startAt = localTime(date, '14:00');
      const hold = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/bookings`, holdBody(startAt, [{ serviceId: b.services.haircut }]));
      const [row] = await ctx.prisma.$queryRaw<Array<{ epoch: number; hold_left: number }>>`
        SELECT extract(epoch FROM a.start_at)::float8 AS epoch, extract(epoch FROM (h.expires_at - now()))::float8 AS hold_left
        FROM appointments a JOIN booking_holds h ON h.appointment_id = a.id WHERE a.id = ${hold.body.appointmentId}::uuid`;
      expect(row!.epoch * 1000).toBe(new Date(startAt).getTime());
      expect(row!.hold_left).toBeGreaterThan(4 * 60);
      expect(row!.hold_left).toBeLessThanOrEqual(5 * 60);
    });

    it('ссылка подтверждения: одноразовая, уникальная при каждой отправке, подбор секрета ограничен (D-42)', async () => {
      const http = new Http(ctx.app);
      const phone = nextPhone();
      const hold = await http.post(`${API}/public/branches/${b.slug}/bookings`, holdBody(localTime(date, '12:00'), [{ serviceId: b.services.haircut }], phone));
      expect(hold.status).toBe(201);
      expect(hold.body.testInbox).toBe(true);
      await drainNotifications(ctx);
      const first = await linkTokenFor(ctx, phone);
      const [id] = first.split('.');
      const confirmUrl = `${API}/public/bookings/confirm-link`;

      // страница записи ждёт: резерв ещё не подтверждён
      const pending = await http.post(`${API}/public/bookings/${hold.body.appointmentId}/status`, { holdToken: hold.body.holdToken });
      expect(pending.body.status).toBe('pending_otp');

      // повторная отправка — новая ссылка, прежняя перестаёт действовать
      await ctx.prisma.otpCode.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 3600_000) } });
      const resend = await http.post(`${API}/public/bookings/${hold.body.appointmentId}/resend-link`, { holdToken: hold.body.holdToken });
      expect(resend.status).toBe(200);
      await drainNotifications(ctx);
      const second = await linkTokenFor(ctx, phone);
      expect(second).not.toBe(first);
      expect((await http.post(confirmUrl, { token: first })).body.error.code).toBe('OTP_INVALID');

      // подбор секрета к чужому id: попытки ограничены, после блокировки не помогает и верный секрет
      const [id2, secret2] = second.split('.');
      for (let i = 0; i < 4; i++) expect((await http.post(confirmUrl, { token: `${id2}.${'A'.repeat(32)}` })).body.error.code).toBe('OTP_INVALID');
      expect((await http.post(confirmUrl, { token: `${id2}.${'B'.repeat(32)}` })).body.error.code).toBe('OTP_INVALID');
      expect((await http.post(confirmUrl, { token: `${id2}.${secret2}` })).body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
      expect(id).not.toBe(id2);

      // новая ссылка → подтверждение; повторный переход по ней не срабатывает
      await ctx.prisma.otpCode.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 3600_000) } });
      await http.post(`${API}/public/bookings/${hold.body.appointmentId}/resend-link`, { holdToken: hold.body.holdToken });
      await drainNotifications(ctx);
      const third = await linkTokenFor(ctx, phone);
      const ok = await http.post(confirmUrl, { token: third });
      expect(ok.status).toBe(200);
      expect(ok.body.appointment.status).toBe('confirmed');
      expect(ok.body.manageToken).toBeTruthy();
      expect((await http.post(confirmUrl, { token: third })).body.error.code).toBe('OTP_USED');
      const done = await http.post(`${API}/public/bookings/${hold.body.appointmentId}/status`, { holdToken: hold.body.holdToken });
      expect(done.body.status).toBe('confirmed');
    });

    it('неверный holdToken не раскрывает резерв', async () => {
      const http = new Http(ctx.app);
      const hold = await http.post(`${API}/public/branches/${b.slug}/bookings`, holdBody(localTime(date, '12:00'), [{ serviceId: b.services.haircut }]));
      const r = await http.post(`${API}/public/bookings/${hold.body.appointmentId}/status`, { holdToken: 'x'.repeat(43) });
      expect(r.status).toBe(404);
      expect((await http.post(`${API}/public/bookings/confirm-link`, { token: `${hold.body.appointmentId}.${'x'.repeat(32)}` })).body.error.code).toBe('OTP_INVALID');
    });

    it('частота отправки OTP ограничена (повторный резерв на тот же номер сразу)', async () => {
      const phone = nextPhone();
      const h = new Http(ctx.app);
      const first = await h.post(`${API}/public/branches/${b.slug}/bookings`, holdBody(localTime(date, '12:00'), [{ serviceId: b.services.haircut }], phone));
      expect(first.status).toBe(201);
      const second = await h.post(`${API}/public/branches/${b.slug}/bookings`, holdBody(localTime(date, '15:00'), [{ serviceId: b.services.haircut }], phone));
      expect(second.status).toBe(429);
      expect(second.body.error.code).toBe('OTP_RATE_LIMITED');
      expect(second.headers['retry-after']).toBeDefined();
    });

    it('антибот: заполненный honeypot и слишком быстрая отправка отклоняются', async () => {
      const h = new Http(ctx.app);
      const r1 = await h.post(`${API}/public/branches/${b.slug}/bookings`, holdBody(localTime(date, '12:00'), [{ serviceId: b.services.haircut }], nextPhone(), { website: 'http://spam' }));
      expect(r1.status).toBe(400);
      const r2 = await h.post(`${API}/public/branches/${b.slug}/bookings`, holdBody(localTime(date, '12:00'), [{ serviceId: b.services.haircut }], nextPhone(), { formElapsedMs: 200 }));
      expect(r2.status).toBe(400);
    });
  });

  describe('конкурентная запись (§8.4, §26.4)', () => {
    it('10 клиентов одновременно на одного специалиста и время → ровно один резерв', async () => {
      const startAt = localTime(date, '14:00');
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          new Http(ctx.app).post(`${API}/public/branches/${b.slug}/bookings`, holdBody(startAt, [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }])),
        ),
      );
      const ok = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409);
      const other = results.filter((r) => r.status !== 201 && r.status !== 409);
      expect(other.map((r) => `${r.status}:${JSON.stringify(r.body)}`)).toEqual([]);
      expect(ok).toHaveLength(1);
      expect(conflicts).toHaveLength(9);
      expect(conflicts[0]!.body.error.code).toBe('SLOT_UNAVAILABLE');
      const active = await ctx.prisma.appointmentResource.count({ where: { isActive: true, resource: { specialist: { id: b.specialists.anna } } } });
      expect(active).toBe(1);
    });

    it('два клиента, разные массажисты, один кабинет → только один резерв (ресурс не бронируется дважды)', async () => {
      const startAt = localTime(date, '15:00');
      const [r1, r2] = await Promise.all([
        new Http(ctx.app).post(`${API}/public/branches/${b.slug}/bookings`, holdBody(startAt, [{ serviceId: b.services.massage, specialistId: b.specialists.ivan }])),
        new Http(ctx.app).post(`${API}/public/branches/${b.slug}/bookings`, holdBody(startAt, [{ serviceId: b.services.massage, specialistId: b.specialists.petr }])),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([201, 409]);
      expect(await ctx.prisma.appointmentResource.count({ where: { resourceId: b.cabinet, isActive: true } })).toBe(1);
    });

    it('автоподбор при параллельных запросах: занимаются разные мастера, лишний — отказ', async () => {
      const startAt = localTime(date, '16:00');
      const results = await Promise.all(
        Array.from({ length: 4 }, () => new Http(ctx.app).post(`${API}/public/branches/${b.slug}/bookings`, holdBody(startAt, [{ serviceId: b.services.haircut }]))),
      );
      expect(results.filter((r) => r.status !== 201 && r.status !== 409).map((r) => `${r.status}:${JSON.stringify(r.body)}`)).toEqual([]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(2); // Анна и Болат
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      const specialists = results.filter((r) => r.status === 201).map((r) => r.body.appointment.items[0].specialistId);
      expect(new Set(specialists).size).toBe(2);
    });

    it('повторный запрос создания с тем же Idempotency-Key не создаёт дубль', async () => {
      const h = new Http(ctx.app);
      const body = holdBody(localTime(date, '17:00'), [{ serviceId: b.services.haircut }]);
      const key = 'idem-key-hold-001';
      const r1 = await h.post(`${API}/public/branches/${b.slug}/bookings`, body, { 'Idempotency-Key': key });
      const r2 = await h.post(`${API}/public/branches/${b.slug}/bookings`, body, { 'Idempotency-Key': key });
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r2.body.appointmentId).toBe(r1.body.appointmentId);
      expect(await ctx.prisma.appointment.count()).toBe(1);
      const r3 = await h.post(`${API}/public/branches/${b.slug}/bookings`, { ...body, comment: 'другое' }, { 'Idempotency-Key': key });
      expect(r3.status).toBe(422);
      expect(r3.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('временный резерв (§8.3)', () => {
    it('истёкший резерв освобождается воркером: expired_otp, слот снова доступен, подтверждение невозможно', async () => {
      const http = new Http(ctx.app);
      const startAt = localTime(date, '13:00');
      const phone = nextPhone();
      const hold = await http.post(`${API}/public/branches/${b.slug}/bookings`, holdBody(startAt, [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }], phone));
      expect(hold.status).toBe(201);
      await ctx.prisma.bookingHold.update({ where: { appointmentId: hold.body.appointmentId }, data: { expiresAt: new Date(Date.now() - 1000) } });

      // Даже до работы воркера истёкший резерв не блокирует слот
      const av = await http.post(`${API}/public/branches/${b.slug}/availability`, { date, items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }] });
      expect(av.body.slots.map((s: { startAt: string }) => s.startAt)).toContain(new Date(startAt).toISOString());

      const released = await ctx.prisma.$transaction((tx) => ctx.app.get(BookingService).releaseExpiredHolds(tx));
      expect(released).toBe(1);
      const a = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: hold.body.appointmentId } });
      expect(a.status).toBe('expired_otp');
      // ссылка, открытая после истечения резерва, запись не подтверждает
      await drainNotifications(ctx);
      const confirm = await http.post(`${API}/public/bookings/confirm-link`, { token: await linkTokenFor(ctx, phone) });
      expect(['HOLD_EXPIRED', 'OTP_INVALID', 'OTP_EXPIRED']).toContain(confirm.body.error.code);

      // другой клиент занимает освободившийся слот
      const again = await bookAndConfirm(ctx, b.slug, { startAt, items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }] });
      expect(again.confirm?.status).toBe(200);
    });

    it('продление резерва — один раз', async () => {
      const http = new Http(ctx.app);
      const hold = await http.post(`${API}/public/branches/${b.slug}/bookings`, holdBody(localTime(date, '13:00'), [{ serviceId: b.services.haircut }]));
      const e1 = await http.post(`${API}/public/bookings/${hold.body.appointmentId}/extend`, { holdToken: hold.body.holdToken });
      expect(e1.status).toBe(200);
      const e2 = await http.post(`${API}/public/bookings/${hold.body.appointmentId}/extend`, { holdToken: hold.body.holdToken });
      expect(e2.body.error.code).toBe('HOLD_EXTENSION_NOT_ALLOWED');
    });

    it('отказ от резерва освобождает слот сразу', async () => {
      const http = new Http(ctx.app);
      const startAt = localTime(date, '13:00');
      const hold = await http.post(`${API}/public/branches/${b.slug}/bookings`, holdBody(startAt, [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }]));
      expect((await http.post(`${API}/public/bookings/${hold.body.appointmentId}/abandon`, { holdToken: hold.body.holdToken })).status).toBe(204);
      const again = await bookAndConfirm(ctx, b.slug, { startAt, items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }] });
      expect(again.hold.status).toBe(201);
    });
  });

  describe('перенос и отмена (§8.5, §8.6)', () => {
    it('перенос на свободное время: атомарно, история сохраняется, повторный OTP не нужен', async () => {
      const { confirm } = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '11:00'), items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }] });
      const token = confirm!.body.manageToken;
      const h = new Http(ctx.app);
      // сдвиг на 30 минут — пересекается со своим же старым интервалом, это допустимо
      const r = await h.post(`${API}/public/manage/${token}/reschedule`, { startAt: localTime(date, '11:30') });
      expect(r.status).toBe(200);
      expect(r.body.startAt).toBe(new Date(localTime(date, '11:30')).toISOString());
      expect(r.body.status).toBe('confirmed');
      const rs = await ctx.prisma.appointmentReschedule.findMany({ where: { appointmentId: r.body.id } });
      expect(rs).toHaveLength(1);
      expect(await ctx.prisma.appointmentResource.count({ where: { appointmentId: r.body.id, isActive: true } })).toBe(1);
    });

    it('перенос на занятое время: старая запись остаётся без изменений (критерий 10)', async () => {
      const a = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '11:00'), items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }] });
      await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '15:00'), items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }] });
      const token = a.confirm!.body.manageToken;
      const r = await new Http(ctx.app).post(`${API}/public/manage/${token}/reschedule`, { startAt: localTime(date, '15:00') });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('SLOT_UNAVAILABLE');
      const view = await new Http(ctx.app).get(`${API}/public/manage/${token}`);
      expect(view.body.startAt).toBe(new Date(localTime(date, '11:00')).toISOString());
      const active = await ctx.prisma.appointmentResource.findMany({ where: { appointmentId: a.hold.body.appointmentId, isActive: true } });
      expect(active).toHaveLength(1);
      expect(active[0]!.startAt.toISOString()).toBe(new Date(localTime(date, '11:00')).toISOString());
    });

    it('перенос к другому свободному специалисту', async () => {
      const a = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '11:00'), items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }] });
      const r = await new Http(ctx.app).post(`${API}/public/manage/${a.confirm!.body.manageToken}/reschedule`, {
        startAt: localTime(date, '12:00'),
        items: [{ serviceId: b.services.haircut, specialistId: b.specialists.bolat }],
      });
      expect(r.status).toBe(200);
      expect(r.body.items[0].specialistName).toBe('Болат');
    });

    it('отмена клиентом до дедлайна; после дедлайна — запрет', async () => {
      const a = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '11:00'), items: [{ serviceId: b.services.haircut }] });
      const r = await new Http(ctx.app).post(`${API}/public/manage/${a.confirm!.body.manageToken}/cancel`, { reason: 'Планы изменились' });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('cancelled_by_client');
      expect(await ctx.prisma.appointmentResource.count({ where: { appointmentId: r.body.id, isActive: true } })).toBe(0);

      // Дедлайн отмены — 120 минут: переносим начало визита на «через 30 минут» и пробуем отменить.
      const x = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '18:00'), items: [{ serviceId: b.services.haircut }] });
      await ctx.prisma.appointment.update({ where: { id: x.hold.body.appointmentId }, data: { startAt: new Date(Date.now() + 30 * 60_000) } });
      const c = await new Http(ctx.app).post(`${API}/public/manage/${x.confirm!.body.manageToken}/cancel`, {});
      expect(c.status).toBe(422);
      expect(c.body.error.code).toBe('CANCEL_DEADLINE_PASSED');
      const rs = await new Http(ctx.app).post(`${API}/public/manage/${x.confirm!.body.manageToken}/reschedule`, { startAt: localTime(date, '19:00') });
      expect(rs.body.error.code).toBe('RESCHEDULE_DEADLINE_PASSED');
    });
  });

  describe('несколько услуг, цены, промокоды, лимиты', () => {
    it('несколько услуг последовательно у одного мастера: общая длительность и стоимость', async () => {
      const { confirm } = await bookAndConfirm(ctx, b.slug, {
        startAt: localTime(date, '10:00'),
        items: [
          { serviceId: b.services.haircut, specialistId: b.specialists.anna },
          { serviceId: b.services.color, specialistId: b.specialists.anna },
        ],
      });
      const v = confirm!.body.appointment;
      expect(v.items.map((i: { startAt: string }) => i.startAt)).toEqual([
        new Date(localTime(date, '10:00')).toISOString(),
        new Date(localTime(date, '11:00')).toISOString(),
      ]);
      expect(v.endAt).toBe(new Date(localTime(date, '12:30')).toISOString());
      expect(v.price.total).toBe(20000);
    });

    it('промокод: процентная скидка, лимит применений проверяется на сервере', async () => {
      await ctx.prisma.promotion.create({
        data: { organizationId: b.orgId, kind: 'promo_code', name: 'Весна', code: 'SPRING10', discountType: 'percent', discountValue: 10, usageLimit: 1 },
      });
      const q = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/quote`, { items: [{ serviceId: b.services.haircut }], promoCode: 'spring10' });
      expect(q.body.totalPrice).toBe(4500);
      const first = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '10:00'), items: [{ serviceId: b.services.haircut }], promoCode: 'SPRING10' });
      expect(first.confirm!.body.appointment.price).toMatchObject({ total: 4500, promoDiscountTotal: 500, promoCode: 'SPRING10' });
      const second = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '12:00'), items: [{ serviceId: b.services.haircut }], promoCode: 'SPRING10' });
      expect(second.hold.status).toBe(400);
      expect(second.hold.body.error).toMatchObject({ code: 'PROMO_INVALID', details: { reason: 'PROMO_USAGE_LIMIT' } });
      const bad = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/quote`, { items: [{ serviceId: b.services.haircut }], promoCode: 'NOPE' });
      expect(bad.body.error.code).toBe('PROMO_INVALID');
    });

    it('лимит активных записей клиента', async () => {
      await ctx.prisma.bookingSettings.update({ where: { branchId: b.branchId }, data: { maxActiveAppointmentsPerClient: 1 } });
      const phone = nextPhone();
      const first = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '10:00'), items: [{ serviceId: b.services.haircut }], phone });
      expect(first.confirm!.status).toBe(200);
      await ctx.prisma.otpCode.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 3600_000) } }); // обходим cooldown
      const second = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/bookings`, holdBody(localTime(date, '15:00'), [{ serviceId: b.services.haircut }], phone));
      expect(second.status).toBe(422);
      expect(second.body.error.code).toBe('CLIENT_ACTIVE_LIMIT');
    });
  });

  describe('администратор филиала', () => {
    it('ручная запись, выполнение, неявка; изоляция записей между организациями', async () => {
      const manual = await b.owner.post(`${API}/organizations/${b.orgId}/appointments`, {
        branchId: b.branchId,
        startAt: localTime(date, '10:00'),
        items: [{ serviceId: b.services.haircut, specialistId: b.specialists.bolat }],
        client: { name: 'Ерлан', phone: '+77011112233' },
      });
      expect(manual.status).toBe(201);
      expect(manual.body.status).toBe('confirmed');
      const early = await b.owner.post(`${API}/organizations/${b.orgId}/appointments/${manual.body.id}/status`, { status: 'completed' });
      expect(early.body.error.code).toBe('INVALID_STATUS_TRANSITION');
      await ctx.prisma.appointment.update({ where: { id: manual.body.id }, data: { startAt: new Date(Date.now() - 3600_000) } });
      const done = await b.owner.post(`${API}/organizations/${b.orgId}/appointments/${manual.body.id}/status`, { status: 'completed' });
      expect(done.status).toBe(200);
      expect(done.body.status).toBe('completed');
      await drainNotifications(ctx);
      expect(await ctx.prisma.devInboxMessage.count({ where: { recipient: '+77011112233', type: 'review_request' } })).toBe(1);

      const cancelNoReason = await b.owner.post(`${API}/organizations/${b.orgId}/appointments`, {
        branchId: b.branchId,
        startAt: localTime(date, '12:00'),
        items: [{ serviceId: b.services.haircut }],
        client: { name: 'Ерлан', phone: '+77011112233' },
      });
      const c1 = await b.owner.post(`${API}/organizations/${b.orgId}/appointments/${cancelNoReason.body.id}/status`, { status: 'cancelled_by_admin' });
      expect(c1.status).toBe(400);
      const c2 = await b.owner.post(`${API}/organizations/${b.orgId}/appointments/${cancelNoReason.body.id}/status`, { status: 'cancelled_by_admin', reason: 'Мастер заболел' });
      expect(c2.body.status).toBe('cancelled_by_admin');

      const other = await createBookableBranch(ctx, admin, { name: 'Другая' });
      expect((await other.owner.get(`${API}/organizations/${other.orgId}/appointments/${manual.body.id}`)).status).toBe(404);
      expect((await other.owner.get(`${API}/organizations/${b.orgId}/appointments/${manual.body.id}`)).status).toBe(404);
      const list = await other.owner.get(`${API}/organizations/${other.orgId}/appointments`);
      expect(list.body.total).toBe(0);
      // попытка записать в чужой филиал через свою организацию
      const cross = await other.owner.post(`${API}/organizations/${other.orgId}/appointments`, {
        branchId: b.branchId,
        startAt: localTime(date, '14:00'),
        items: [{ serviceId: b.services.haircut }],
        client: { name: 'X', phone: '+77011112244' },
      });
      expect(cross.status).toBe(404);
    });
  });

  describe('доступность записи по статусам (§2.4)', () => {
    it('temporarily_closed и suspended отключают запись, expired скрывает страницу', async () => {
      const page = await ctx.prisma.publicPage.findUniqueOrThrow({ where: { branchId: b.branchId } });
      await ctx.prisma.publicPage.update({ where: { id: page.id }, data: { status: 'temporarily_closed' } });
      const r1 = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/bookings`, holdBody(localTime(date, '12:00'), [{ serviceId: b.services.haircut }]));
      expect(r1.status).toBe(403);
      expect(r1.body.error).toMatchObject({ code: 'BOOKING_DISABLED', details: { reason: 'page_temporarily_closed' } });
      await ctx.prisma.publicPage.update({ where: { id: page.id }, data: { status: 'active' } });
      await ctx.prisma.subscription.update({ where: { organizationId: b.orgId }, data: { suspended: true } });
      const r2 = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/availability`, { date, items: [{ serviceId: b.services.haircut }] });
      expect(r2.body.error.details.reason).toBe('subscription_suspended');
      await ctx.prisma.subscription.update({
        where: { organizationId: b.orgId },
        data: { suspended: false, startsAt: new Date(Date.now() - 60 * 86400_000), endsAt: new Date(Date.now() - 30 * 86400_000), graceDays: 0 },
      });
      const r3 = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/availability`, { date, items: [{ serviceId: b.services.haircut }] });
      expect(r3.status).toBe(404);
    });
  });

  describe('уведомления не дублируются (§15.2, критерий 17)', () => {
    it('повторная постановка события и повторная обработка очереди не создают дублей', async () => {
      const svc = ctx.app.get(NotificationService);
      const enqueue = () =>
        ctx.prisma.$transaction((tx) =>
          svc.enqueue(tx, { organizationId: b.orgId, type: 'appointment_reminder', eventKey: 'test:event:1', recipient: '+77015550000', locale: 'ru', params: { branchName: 'X', date: '1', time: '2', manageUrl: 'u', clientName: 'c' } }),
        );
      const first = await enqueue();
      const second = await enqueue();
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      await drainNotifications(ctx);
      await drainNotifications(ctx);
      expect(await ctx.prisma.devInboxMessage.count({ where: { recipient: '+77015550000' } })).toBe(1);
      const [n] = await Promise.all([ctx.prisma.notificationOutbox.count({ where: { recipient: '+77015550000' } })]);
      expect(n).toBe(1);
    });
  });
});
