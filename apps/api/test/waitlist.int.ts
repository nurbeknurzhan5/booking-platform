import { API, bootstrapTestApp, createSuperadmin, Http, loginSuperadmin, loginStaff, resetDb, type TestContext } from './helpers';
import { bookAndConfirm, createBookableBranch, drainNotifications, futureDate, localTime, nextPhone, type BookableBranch } from './fixtures';
import { WaitlistService } from '../src/booking/waitlist.service';

describe('Лист ожидания (§9)', () => {
  let ctx: TestContext;
  let admin: Http;
  let b: BookableBranch;
  let wl: WaitlistService;
  const date = futureDate(4);

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    wl = ctx.app.get(WaitlistService);
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx);
    admin = await loginSuperadmin(ctx, await createSuperadmin(ctx));
    b = await createBookableBranch(ctx, admin);
  });

  const settingsUrl = () => `${API}/organizations/${b.orgId}/branches/${b.branchId}/booking-settings`;
  async function configure(extra: Record<string, unknown> = {}) {
    const cur = await b.owner.get(settingsUrl());
    const r = await b.owner.put(settingsUrl(), { ...cur.body, waitlistEnabled: true, ...extra });
    expect(r.status).toBe(200);
  }

  const haircutAnna = () => ({ items: [{ serviceId: b.services.haircut }], specialistId: b.specialists.anna });

  async function lastCode(phone: string, type = 'otp') {
    await drainNotifications(ctx);
    const msg = await ctx.prisma.devInboxMessage.findFirstOrThrow({ where: { recipient: phone, type }, orderBy: { createdAt: 'desc' } });
    return msg.text;
  }

  /** Постановка в лист ожидания с подтверждением OTP. */
  async function join(body: Record<string, unknown> = haircutAnna(), phone = nextPhone(), range = { dateFrom: date, dateTo: date }) {
    const http = new Http(ctx.app);
    // несколько заявок с одного номера подряд: снимаем паузу между отправками кода
    await ctx.prisma.otpCode.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 3600_000) } });
    const r = await http.post(`${API}/public/branches/${b.slug}/waitlist`, {
      ...body,
      ...range,
      client: { name: 'Ожидающий', phone },
      consents: { personalData: true },
    });
    if (r.status !== 201) return { r, phone, entryId: null as string | null, token: '' };
    const code = /(\d{6})/.exec(await lastCode(phone))![1]!;
    const c = await http.post(`${API}/public/waitlist/${r.body.entryId}/confirm`, { token: r.body.token, code });
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('waiting');
    return { r, phone, entryId: r.body.entryId as string, token: r.body.token as string };
  }

  async function offerToken(phone: string) {
    const text = await lastCode(phone, 'waitlist_offer');
    return /\/waitlist\/([A-Za-z0-9_-]{20,})/.exec(text)![1]!;
  }

  /** Подтверждённая запись 12:00 у Анны, затем её отмена клиентом — время освобождается. */
  async function bookAndCancel(hhmm = '12:00') {
    const booked = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, hhmm), items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }] });
    expect(booked.confirm?.status).toBe(200);
    const c = await new Http(ctx.app).post(`${API}/public/manage/${booked.confirm!.body.manageToken}/cancel`, {});
    expect(c.status).toBe(200);
    return booked;
  }

  const entry = (id: string) => ctx.prisma.waitlistEntry.findUniqueOrThrow({ where: { id } });

  describe('постановка в очередь', () => {
    it('выключено по умолчанию; при включении требуется OTP, заявка видна администратору', async () => {
      const off = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/waitlist`, {
        ...haircutAnna(),
        dateFrom: date,
        dateTo: date,
        client: { name: 'Клиент', phone: nextPhone() },
        consents: { personalData: true },
      });
      expect(off.status).toBe(403);
      expect(off.body.error.code).toBe('WAITLIST_DISABLED');

      await configure();
      const page = await new Http(ctx.app).get(`${API}/public/pages/${b.slug}`);
      expect(page.status).toBe(200);
      expect(page.body.availability.waitlistEnabled).toBe(true);

      const http = new Http(ctx.app);
      const phone = nextPhone();
      const r = await http.post(`${API}/public/branches/${b.slug}/waitlist`, { ...haircutAnna(), dateFrom: date, dateTo: date, client: { name: 'Клиент', phone }, consents: { personalData: true } });
      expect(r.status).toBe(201);
      expect((await entry(r.body.entryId)).status).toBe('pending_otp');
      // неподтверждённая заявка администратору не видна
      let list = await b.owner.get(`${API}/organizations/${b.orgId}/waitlist`);
      expect(list.body.total).toBe(0);

      const bad = await http.post(`${API}/public/waitlist/${r.body.entryId}/confirm`, { token: r.body.token, code: '000000' });
      expect(bad.status).toBe(400);
      const wrongToken = await http.post(`${API}/public/waitlist/${r.body.entryId}/confirm`, { token: 'x'.repeat(40), code: '000000' });
      expect(wrongToken.status).toBe(404);

      const code = /(\d{6})/.exec(await lastCode(phone))![1]!;
      const ok = await http.post(`${API}/public/waitlist/${r.body.entryId}/confirm`, { token: r.body.token, code });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('waiting');
      list = await b.owner.get(`${API}/organizations/${b.orgId}/waitlist`);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0].services[0].name).toBe('Стрижка');
      expect(list.body.items[0].specialist.name).toBe('Анна');
    });

    it('проверки: дубль заявки, лимит, специалист без услуги, прошедшая дата', async () => {
      await configure();
      const first = await join();
      const dup = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/waitlist`, {
        ...haircutAnna(),
        dateFrom: date,
        dateTo: date,
        client: { name: 'Ожидающий', phone: first.phone },
        consents: { personalData: true },
      });
      expect(dup.status).toBe(422);
      expect(dup.body.error.code).toBe('WAITLIST_LIMIT');

      const wrongSpecialist = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/waitlist`, {
        items: [{ serviceId: b.services.massage }],
        specialistId: b.specialists.anna,
        dateFrom: date,
        dateTo: date,
        client: { name: 'Клиент', phone: nextPhone() },
        consents: { personalData: true },
      });
      expect(wrongSpecialist.status).toBe(400);

      const past = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/waitlist`, {
        ...haircutAnna(),
        dateFrom: futureDate(-2),
        dateTo: date,
        client: { name: 'Клиент', phone: nextPhone() },
        consents: { personalData: true },
      });
      expect(past.status).toBe(400);

      // не больше 3 активных заявок на клиента
      const phone = nextPhone();
      await join({ items: [{ serviceId: b.services.haircut }] }, phone);
      await join({ items: [{ serviceId: b.services.color }] }, phone);
      await join({ items: [{ serviceId: b.services.massage }] }, phone);
      const fourth = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/waitlist`, {
        items: [{ serviceId: b.services.haircut }, { serviceId: b.services.color }],
        dateFrom: date,
        dateTo: date,
        client: { name: 'Клиент', phone },
        consents: { personalData: true },
      });
      expect(fourth.status).toBe(422);
      expect(fourth.body.error.code).toBe('WAITLIST_LIMIT');
    });
  });

  describe('предложения освободившегося времени', () => {
    it('отмена → предложение первым трём подходящим; первый подтвердивший получает слот, остальные аннулируются', async () => {
      await configure();
      const w1 = await join();
      const w2 = await join();
      const w3 = await join();
      const w4 = await join();
      const otherDay = await join(haircutAnna(), nextPhone(), { dateFrom: futureDate(10), dateTo: futureDate(12) });
      const massage = await join({ items: [{ serviceId: b.services.massage }] });

      const source = await bookAndCancel('12:00');
      const release = await ctx.prisma.waitlistRelease.findFirstOrThrow({ where: { sourceAppointmentId: source.hold.body.appointmentId } });
      expect(release.status).toBe('pending');

      const r = await wl.processReleases();
      expect(r.offers).toBe(3);
      expect((await entry(w1.entryId!)).status).toBe('offered');
      expect((await entry(w2.entryId!)).status).toBe('offered');
      expect((await entry(w3.entryId!)).status).toBe('offered');
      expect((await entry(w4.entryId!)).status).toBe('waiting');
      expect((await entry(otherDay.entryId!)).status).toBe('waiting');
      // массаж у другого специалиста не связан с освободившимся временем Анны
      expect((await entry(massage.entryId!)).status).toBe('waiting');

      const t1 = await offerToken(w1.phone);
      const t2 = await offerToken(w2.phone);
      const http = new Http(ctx.app);
      const view = await http.get(`${API}/public/waitlist-offers/${t2}`);
      expect(view.status).toBe(200);
      expect(view.body.status).toBe('pending');
      expect(view.body.startAt).toBe(new Date(localTime(date, '12:00')).toISOString());
      expect(view.body.totalPrice).toBe(5000);
      // ссылка из уведомления не хранится в outbox после отправки
      const outbox = await ctx.prisma.notificationOutbox.findFirstOrThrow({ where: { recipient: w2.phone, type: 'waitlist_offer' } });
      expect(outbox.payloadEncrypted).toBe(true);
      expect(outbox.payload).toEqual({});

      const won = await http.post(`${API}/public/waitlist-offers/${t2}/accept`, {});
      expect(won.status).toBe(200);
      expect(won.body.appointment.status).toBe('confirmed');
      expect(won.body.appointment.source).toBe('waitlist');
      expect(won.body.appointment.items[0].specialistName).toBe('Анна');
      expect(won.body.manageToken).toBeTruthy();

      const late = await http.post(`${API}/public/waitlist-offers/${t1}/accept`, {});
      expect(late.status).toBe(409);
      expect(late.body.error.code).toBe('WAITLIST_OFFER_CLOSED');
      const again = await http.post(`${API}/public/waitlist-offers/${t2}/accept`, {});
      expect(again.status).toBe(409);

      expect((await entry(w2.entryId!)).status).toBe('booked');
      expect((await entry(w1.entryId!)).status).toBe('waiting');
      expect((await entry(w3.entryId!)).status).toBe('waiting');
      const rel = await ctx.prisma.waitlistRelease.findUniqueOrThrow({ where: { id: release.id } });
      expect(rel.status).toBe('booked');
      const offers = await ctx.prisma.waitlistOffer.findMany({ where: { releaseId: release.id } });
      expect(offers.filter((o) => o.status === 'accepted')).toHaveLength(1);
      expect(offers.filter((o) => o.status === 'cancelled')).toHaveLength(2);

      await drainNotifications(ctx);
      const confirmMsg = await ctx.prisma.devInboxMessage.findFirst({ where: { recipient: w2.phone, type: 'appointment_confirmed' } });
      expect(confirmMsg).not.toBeNull();
    });

    it('параллельные подтверждения: слот получает ровно один клиент', async () => {
      await configure({ waitlistRecipients: 5 });
      const waiting = [];
      for (let i = 0; i < 5; i++) waiting.push(await join());
      await bookAndCancel('15:00');
      expect((await wl.processReleases()).offers).toBe(5);
      const tokens = [];
      for (const w of waiting) tokens.push(await offerToken(w.phone));
      const results = await Promise.all(tokens.map((t) => new Http(ctx.app).post(`${API}/public/waitlist-offers/${t}/accept`, {})));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      const active = await ctx.prisma.appointment.count({
        where: { branchId: b.branchId, status: 'confirmed', startAt: new Date(localTime(date, '15:00')), items: { some: { specialistId: b.specialists.anna } } },
      });
      expect(active).toBe(1);
    });

    it('истечение срока: предложение следующему в очереди, затем слот возвращается в общую запись', async () => {
      await configure({ waitlistRecipients: 1, waitlistAfterExpiry: 'offer_next', waitlistOfferMinutes: 10 });
      const w1 = await join();
      const w2 = await join();
      await bookAndCancel('13:00');
      await wl.processReleases();
      expect((await entry(w1.entryId!)).status).toBe('offered');
      expect((await entry(w2.entryId!)).status).toBe('waiting');
      const t1 = await offerToken(w1.phone);

      // срок раунда истёк
      const later = new Date(Date.now() + 11 * 60_000);
      await wl.processReleases(later);
      expect((await entry(w1.entryId!)).status).toBe('waiting');
      expect((await entry(w2.entryId!)).status).toBe('offered');
      const expired = await new Http(ctx.app).post(`${API}/public/waitlist-offers/${t1}/accept`, {});
      expect(expired.status).toBe(409);
      expect((await new Http(ctx.app).get(`${API}/public/waitlist-offers/${t1}`)).body.status).toBe('expired');

      await wl.processReleases(new Date(Date.now() + 22 * 60_000));
      const rel = await ctx.prisma.waitlistRelease.findFirstOrThrow({ where: { branchId: b.branchId } });
      expect(rel.status).toBe('closed');
      expect(rel.closedReason).toBe('queue_exhausted');
      expect(rel.round).toBe(2);
      expect((await entry(w2.entryId!)).status).toBe('waiting');
    });

    it('режим «release»: после истечения срока слот не предлагается дальше; просроченное предложение → 410', async () => {
      await configure({ waitlistRecipients: 1, waitlistAfterExpiry: 'release', waitlistOfferMinutes: 10 });
      const w1 = await join();
      await join();
      await bookAndCancel('13:00');
      await wl.processReleases();
      const t1 = await offerToken(w1.phone);
      await ctx.prisma.waitlistOffer.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      const gone = await new Http(ctx.app).post(`${API}/public/waitlist-offers/${t1}/accept`, {});
      expect(gone.status).toBe(410);
      expect(gone.body.error.code).toBe('WAITLIST_OFFER_EXPIRED');
      await wl.processReleases(new Date(Date.now() + 11 * 60_000));
      const rel = await ctx.prisma.waitlistRelease.findFirstOrThrow({ where: { branchId: b.branchId } });
      expect(rel.status).toBe('closed');
      expect(rel.closedReason).toBe('expired');
      expect(await ctx.prisma.waitlistOffer.count()).toBe(1);
    });

    it('приоритет администратора; отказ сразу передаёт предложение следующему; выход из очереди', async () => {
      await configure({ waitlistRecipients: 1, waitlistPriority: 'priority' });
      const regular = await join();
      const vipPhone = nextPhone();
      const vip = await b.owner.post(`${API}/organizations/${b.orgId}/waitlist`, {
        branchId: b.branchId,
        ...haircutAnna(),
        dateFrom: date,
        dateTo: date,
        client: { name: 'Постоянный клиент', phone: vipPhone },
        priority: 10,
      });
      expect(vip.status).toBe(201);
      expect(vip.body.status).toBe('waiting');

      await bookAndCancel('16:00');
      await wl.processReleases();
      expect((await entry(vip.body.id)).status).toBe('offered');
      expect((await entry(regular.entryId!)).status).toBe('waiting');

      const declined = await new Http(ctx.app).post(`${API}/public/waitlist-offers/${await offerToken(vipPhone)}/decline`, { leaveWaitlist: false });
      expect(declined.status).toBe(200);
      expect(declined.body.status).toBe('declined');
      expect((await entry(vip.body.id)).status).toBe('waiting');
      // раунд завершён досрочно — следующий проход воркера предлагает время следующему
      await wl.processReleases();
      expect((await entry(regular.entryId!)).status).toBe('offered');

      const leave = await new Http(ctx.app).post(`${API}/public/waitlist-offers/${await offerToken(regular.phone)}/decline`, { leaveWaitlist: true });
      expect(leave.status).toBe(200);
      expect((await entry(regular.entryId!)).status).toBe('cancelled');
    });

    it('время заняли через общую запись: предложение «потеряно», заявка остаётся в очереди', async () => {
      await configure({ waitlistRecipients: 1 });
      const w1 = await join();
      await bookAndCancel('17:00');
      await wl.processReleases();
      const t1 = await offerToken(w1.phone);
      const other = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '17:00'), items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }] });
      expect(other.confirm?.status).toBe(200);
      const r = await new Http(ctx.app).post(`${API}/public/waitlist-offers/${t1}/accept`, {});
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('SLOT_UNAVAILABLE');
      const offer = await ctx.prisma.waitlistOffer.findFirstOrThrow({ where: { entryId: w1.entryId! } });
      expect(offer.status).toBe('lost');
      expect((await entry(w1.entryId!)).status).toBe('waiting');
    });

    it('перенос записи тоже освобождает время; выключенный лист ожидания ничего не создаёт', async () => {
      await configure();
      const w1 = await join();
      const booked = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '11:00'), items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }] });
      const mv = await new Http(ctx.app).post(`${API}/public/manage/${booked.confirm!.body.manageToken}/reschedule`, { startAt: localTime(futureDate(5), '11:00') });
      expect(mv.status).toBe(200);
      expect((await wl.processReleases()).offers).toBe(1);
      const offer = await ctx.prisma.waitlistOffer.findFirstOrThrow({ where: { entryId: w1.entryId! } });
      expect(offer.startAt.toISOString()).toBe(new Date(localTime(date, '11:00')).toISOString());

      await configure({ waitlistEnabled: false });
      await bookAndCancel('18:00');
      expect(await ctx.prisma.waitlistRelease.count()).toBe(1);
    });
  });

  describe('доступ', () => {
    it('другая организация и администратор без прав не видят заявки; клиент видит и отменяет свои', async () => {
      await configure();
      const w = await join();
      const other = await createBookableBranch(ctx, admin, { name: 'Чужой' });
      const foreign = await other.owner.get(`${API}/organizations/${b.orgId}/waitlist`);
      expect([403, 404]).toContain(foreign.status);
      const foreignCancel = await other.owner.post(`${API}/organizations/${other.orgId}/waitlist/${w.entryId}/cancel`, {});
      expect(foreignCancel.status).toBe(404);
      const own = await other.owner.get(`${API}/organizations/${other.orgId}/waitlist`);
      expect(own.body.total).toBe(0);

      // администратор филиала без права appointments.manage не может удалять заявки
      const created = await b.owner.post(`${API}/organizations/${b.orgId}/users`, {
        email: 'limited@waitlist.kz',
        name: 'Админ',
        temporaryPassword: 'Password123!',
        role: 'BRANCH_ADMIN',
        branchAccess: [{ branchId: b.branchId, permissions: ['appointments.view'] }],
      });
      expect(created.status).toBe(201);
      const limited = await loginStaff(ctx, 'limited@waitlist.kz', 'Password123!');
      expect((await limited.get(`${API}/organizations/${b.orgId}/waitlist`)).body.total).toBe(1);
      expect((await limited.post(`${API}/organizations/${b.orgId}/waitlist/${w.entryId}/cancel`, {})).status).toBe(403);

      // выход по токену заявки
      const out = await new Http(ctx.app).post(`${API}/public/waitlist/${w.entryId}/cancel`, { token: w.token });
      expect(out.status).toBe(200);
      expect(out.body.status).toBe('cancelled');
      expect((await new Http(ctx.app).post(`${API}/public/waitlist/${w.entryId}/cancel`, { token: w.token })).status).toBe(422);
    });

    it('кабинет клиента: свои заявки видны и отменяются, чужие — нет', async () => {
      await configure();
      const mine = await join();
      const foreign = await join();
      const h = new Http(ctx.app);
      await ctx.prisma.otpCode.updateMany({ where: { phone: mine.phone }, data: { createdAt: new Date(Date.now() - 3600_000) } });
      expect((await h.post(`${API}/auth/client/otp/request`, { phone: mine.phone })).status).toBe(200);
      const code = /(\d{6})/.exec(await lastCode(mine.phone))![1]!;
      expect((await h.post(`${API}/auth/client/otp/verify`, { phone: mine.phone, code })).status).toBe(200);

      const list = await h.get(`${API}/me/waitlist`);
      expect(list.status).toBe(200);
      expect(list.body.map((e: { id: string }) => e.id)).toEqual([mine.entryId]);
      expect((await h.post(`${API}/me/waitlist/${foreign.entryId}/cancel`, {})).status).toBe(404);
      const c = await h.post(`${API}/me/waitlist/${mine.entryId}/cancel`, {});
      expect(c.status).toBe(200);
      expect((await h.get(`${API}/me/waitlist`)).body).toHaveLength(0);
    });
  });
});
