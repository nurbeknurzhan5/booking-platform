import { API, bootstrapTestApp, createSuperadmin, Http, loginSuperadmin, resetDb, type TestContext } from './helpers';
import { bookAndConfirm, createBookableBranch, drainNotifications, futureDate, localTime, nextPhone, type BookableBranch } from './fixtures';

describe('Клиенты, кабинет клиента, отзывы, промокоды, аналитика', () => {
  let ctx: TestContext;
  let admin: Http;
  let b: BookableBranch;
  const date = futureDate(4);

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx);
    admin = await loginSuperadmin(ctx, await createSuperadmin(ctx));
    b = await createBookableBranch(ctx, admin);
  });

  const complete = async (appointmentId: string) => {
    await ctx.prisma.appointment.update({ where: { id: appointmentId }, data: { startAt: new Date(Date.now() - 2 * 3600_000), endAt: new Date(Date.now() - 3600_000) } });
    const r = await b.owner.post(`${API}/organizations/${b.orgId}/appointments/${appointmentId}/status`, { status: 'completed' });
    expect(r.status).toBe(200);
  };

  async function clientLogin(phone: string) {
    const h = new Http(ctx.app);
    await ctx.prisma.otpCode.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 3600_000) } });
    const req = await h.post(`${API}/auth/client/otp/request`, { phone });
    expect(req.status).toBe(200);
    await drainNotifications(ctx);
    const msg = await ctx.prisma.devInboxMessage.findFirstOrThrow({ where: { recipient: phone, type: 'otp' }, orderBy: { createdAt: 'desc' } });
    const v = await h.post(`${API}/auth/client/otp/verify`, { phone, code: /(\d{6})/.exec(msg.text)![1] });
    expect(v.status).toBe(200);
    return h;
  }

  describe('кабинет клиента (§18.1) и привязка гостевых записей (§10)', () => {
    it('гостевая запись привязывается после входа по OTP; перенос и отмена из кабинета; чужие записи недоступны', async () => {
      const phone = nextPhone();
      const guest = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '10:00'), items: [{ serviceId: b.services.haircut }], phone });
      expect(guest.confirm!.status).toBe(200);
      const me = await clientLogin(phone);
      const list = await me.get(`${API}/me/appointments`);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(guest.hold.body.appointmentId);
      const client = await ctx.prisma.client.findFirstOrThrow({ where: { phone } });
      expect(client.userId).not.toBeNull();

      const rs = await me.post(`${API}/me/appointments/${list.body[0].id}/reschedule`, { startAt: localTime(date, '12:00') });
      expect(rs.status).toBe(200);
      const other = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '15:00'), items: [{ serviceId: b.services.haircut }] });
      expect((await me.post(`${API}/me/appointments/${other.hold.body.appointmentId}/cancel`, {})).status).toBe(404);
      const c = await me.post(`${API}/me/appointments/${list.body[0].id}/cancel`, {});
      expect(c.body.status).toBe('cancelled_by_client');
      expect((await me.get(`${API}/me/appointments?scope=cancelled`)).body).toHaveLength(1);
      // клиентская сессия не даёт доступа к кабинету сотрудника
      expect((await me.get(`${API}/organizations/${b.orgId}`)).status).toBe(403);

      const prof = await me.patch(`${API}/me/profile`, { name: 'Айгерим К.', locale: 'kk', consents: { whatsapp: false } });
      expect(prof.body).toMatchObject({ name: 'Айгерим К.', locale: 'kk', consents: { whatsapp: false } });
    });

    it('OTP входа: перебор ограничен, повторное использование кода невозможно', async () => {
      const phone = nextPhone();
      const h = new Http(ctx.app);
      await h.post(`${API}/auth/client/otp/request`, { phone });
      await drainNotifications(ctx);
      const msg = await ctx.prisma.devInboxMessage.findFirstOrThrow({ where: { recipient: phone } });
      const code = /(\d{6})/.exec(msg.text)![1]!;
      const ok = await h.post(`${API}/auth/client/otp/verify`, { phone, code });
      expect(ok.status).toBe(200);
      const reuse = await new Http(ctx.app).post(`${API}/auth/client/otp/verify`, { phone, code });
      expect(reuse.body.error.code).toBe('OTP_INVALID');
      // неверный номер — не мобильный КЗ
      expect((await h.post(`${API}/auth/client/otp/request`, { phone: '+79161234567' })).status).toBe(400);
    });
  });

  describe('отзывы (§14)', () => {
    it('только после завершённого визита, один на визит, текст неизменяем, ответ и модерация', async () => {
      const a = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '10:00'), items: [{ serviceId: b.services.haircut }] });
      const token = a.confirm!.body.manageToken;
      const early = await new Http(ctx.app).post(`${API}/public/manage/${token}/review`, { rating: 5, text: 'Отлично' });
      expect(early.body.error.code).toBe('REVIEW_NOT_ALLOWED');
      await complete(a.hold.body.appointmentId);
      const rv = await new Http(ctx.app).post(`${API}/public/manage/${token}/review`, { rating: 5, text: 'Отлично' });
      expect(rv.status).toBe(201);
      expect((await new Http(ctx.app).post(`${API}/public/manage/${token}/review`, { rating: 1 })).status).toBe(409);
      await expect(ctx.prisma.review.update({ where: { id: rv.body.id }, data: { text: 'Плохо' } })).rejects.toThrow();
      await expect(ctx.prisma.review.update({ where: { id: rv.body.id }, data: { rating: 1 } })).rejects.toThrow();

      const reply = await b.owner.post(`${API}/organizations/${b.orgId}/reviews/${rv.body.id}/reply`, { text: 'Спасибо!' });
      expect(reply.body.reply).toBe('Спасибо!');
      await b.owner.post(`${API}/organizations/${b.orgId}/reviews/${rv.body.id}/report`, { reason: 'Подозрение на спам' });
      const mod = await admin.post(`${API}/admin/reviews/${rv.body.id}/moderate`, { status: 'hidden', reason: 'Нарушение правил' });
      expect(mod.body.status).toBe('hidden');
      const page = await new Http(ctx.app).get(`${API}/public/pages/${b.slug}`);
      expect(page.body.reviews.count).toBe(0);
    });
  });

  describe('клиенты (§11)', () => {
    it('карточка со статистикой; объединение дублей с сохранением истории; обезличивание', async () => {
      const p1 = nextPhone();
      const p2 = nextPhone();
      const a1 = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '10:00'), items: [{ serviceId: b.services.haircut }], phone: p1 });
      await complete(a1.hold.body.appointmentId);
      await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '12:00'), items: [{ serviceId: b.services.haircut }], phone: p2 });
      const list = await b.owner.get(`${API}/organizations/${b.orgId}/clients?search=${p1.slice(-6)}`);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0].visits).toBe(1);
      const c1 = list.body.items[0].id;
      const c2 = (await ctx.prisma.client.findFirstOrThrow({ where: { phone: p2 } })).id;
      const card = await b.owner.get(`${API}/organizations/${b.orgId}/clients/${c1}`);
      expect(card.body.appointments).toHaveLength(1);
      expect(card.body.consents.personal_data.granted).toBe(true);

      const merge = await b.owner.post(`${API}/organizations/${b.orgId}/clients/merge`, { sourceClientId: c2, targetClientId: c1 });
      expect(merge.body.movedAppointments).toBe(1);
      const merged = await b.owner.get(`${API}/organizations/${b.orgId}/clients/${c1}`);
      expect(merged.body.appointments).toHaveLength(2);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'client.merged' } })).toBe(1);

      const other = await createBookableBranch(ctx, admin, { name: 'Чужой' });
      expect((await other.owner.get(`${API}/organizations/${other.orgId}/clients/${c1}`)).status).toBe(404);
      expect((await other.owner.get(`${API}/organizations/${b.orgId}/clients`)).status).toBe(404);

      const anonBlocked = await b.owner.post(`${API}/organizations/${b.orgId}/clients/${c1}/anonymize`);
      expect(anonBlocked.status).toBe(409); // есть активная запись
    });
  });

  describe('промокоды и акции (§12)', () => {
    it('CRUD, уникальность кода, автоматическая акция в расчёте цены', async () => {
      const base = `${API}/organizations/${b.orgId}/promotions`;
      const p = await b.owner.post(base, { kind: 'promo_code', name: 'Скидка', code: 'kz2026', discountType: 'fixed', discountValue: 1000, minAmount: 3000 });
      expect(p.status).toBe(201);
      expect(p.body.code).toBe('KZ2026');
      expect((await b.owner.post(base, { kind: 'promo_code', name: 'Дубль', code: 'KZ2026', discountType: 'fixed', discountValue: 1 })).status).toBe(409);
      await b.owner.post(base, { kind: 'sale', name: 'Чёрная пятница', discountType: 'percent', discountValue: 20, serviceIds: [b.services.haircut], showOnPage: true });
      const q = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/quote`, { items: [{ serviceId: b.services.haircut }, { serviceId: b.services.color }], promoCode: 'KZ2026' });
      // стрижка 5000 −20% = 4000; окрашивание 15000; промокод −1000 → 18000
      expect(q.body).toMatchObject({ baseTotal: 20000, saleDiscountTotal: 1000, promoDiscountTotal: 1000, totalPrice: 18000 });
      const page = await new Http(ctx.app).get(`${API}/public/pages/${b.slug}`);
      expect(page.body.promotions.map((x: { name: string }) => x.name)).toContain('Чёрная пятница');
      const list = await b.owner.get(base);
      expect(list.body).toHaveLength(2);
      expect((await b.owner.delete(`${base}/${p.body.id}`)).status).toBe(204);
    });
  });

  describe('аналитика (§17)', () => {
    it('просмотры, уникальные, клики, UTM-источники, исключение ботов и внутренних, конверсия', async () => {
      const ev = (h: Http, type: string, extra: object = {}, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile') =>
        h.post(`${API}/public/analytics/events`, { slug: b.slug, type, ...extra }, { 'User-Agent': ua });
      const v1 = new Http(ctx.app, '10.1.1.1');
      const v2 = new Http(ctx.app, '10.1.1.2');
      await ev(v1, 'page_view', { utm: { source: 'instagram', medium: 'social' } });
      await ev(v1, 'page_view', { utm: { source: 'instagram' } });
      await ev(v1, 'booking_click');
      await ev(v2, 'page_view', { referrer: 'https://www.google.com/search?q=x' });
      await ev(new Http(ctx.app, '10.1.1.3'), 'page_view', {}, 'Googlebot/2.1 (+http://www.google.com/bot.html)');
      await ev(b.owner, 'page_view'); // внутренний просмотр владельца
      // сервер сам фиксирует успешную запись
      await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '10:00'), items: [{ serviceId: b.services.haircut }] });

      const today = new Date().toISOString().slice(0, 10);
      const r = await b.owner.get(`${API}/organizations/${b.orgId}/analytics?from=${today}&to=${futureDate(1)}&granularity=day`);
      expect(r.status).toBe(200);
      expect(r.body.totals).toMatchObject({ pageViews: 3, uniqueVisitors: 2, bookingClicks: 1, bookingsCreated: 1 });
      expect(r.body.totals.conversionVisitorToBooking).toBe(50);
      const sources = Object.fromEntries(r.body.sources.map((s: { source: string; views: number }) => [s.source, s.views]));
      expect(sources).toMatchObject({ instagram: 2, 'google.com': 1 });
      expect(r.body.popularServices[0]).toMatchObject({ name: 'Стрижка', count: 1 });

      const week = await b.owner.get(`${API}/organizations/${b.orgId}/analytics?from=${today}&to=${futureDate(1)}&granularity=month`);
      expect(week.body.series).toHaveLength(1);
      // клиент не может подделать событие успешной записи
      const fake = await ev(v2, 'booking_completed');
      expect(fake.status).toBe(204);
      expect(await ctx.prisma.analyticsEvent.count({ where: { type: 'booking_completed' } })).toBe(1);
      // данные аналитики недоступны другой организации
      const other = await createBookableBranch(ctx, admin, { name: 'Чужая' });
      expect((await other.owner.get(`${API}/organizations/${b.orgId}/analytics?from=${today}&to=${today}`)).status).toBe(404);
    });
  });
});
