import { DateTime } from 'luxon';
import { API, bootstrapTestApp, createSuperadmin, Http, loginStaff, loginSuperadmin, resetDb, type TestContext } from './helpers';
import { bookAndConfirm, createBookableBranch, futureDate, localTime, TZ, type BookableBranch } from './fixtures';

describe('График смен (задача 21)', () => {
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

  const url = (p = '') => `${API}/organizations/${b.orgId}/branches/${b.branchId}/shifts${p}`;
  const resourceOf = async (specialistId: string) => (await ctx.prisma.specialist.findUniqueOrThrow({ where: { id: specialistId } })).resourceId;
  async function setMode(mode: 'weekly' | 'shifts') {
    const s = `${API}/organizations/${b.orgId}/branches/${b.branchId}/booking-settings`;
    const cur = await b.owner.get(s);
    expect((await b.owner.put(s, { ...cur.body, scheduleMode: mode })).status).toBe(200);
  }
  async function annaSlots(d = date) {
    const r = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/availability`, { date: d, items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }] });
    expect(r.status).toBe(200);
    return (r.body.slots as Array<{ startAt: string }>).map((s) => DateTime.fromISO(s.startAt).setZone(TZ).toFormat('HH:mm'));
  }

  it('в режиме смен специалист доступен только в назначенную смену с учётом перерыва', async () => {
    expect((await annaSlots()).length).toBeGreaterThan(0); // недельный график 10–20
    await setMode('shifts');
    expect(await annaSlots()).toEqual([]); // смены нет — не работает

    const anna = await resourceOf(b.specialists.anna);
    const put = await b.owner.put(url(), { resourceId: anna, date, startMinute: 12 * 60, endMinute: 16 * 60, breakStart: 13 * 60, breakEnd: 14 * 60 });
    expect(put.status).toBe(200);
    // стрижка 60 мин, шаг 30 мин: 12:00 и 14:00, 14:30, 15:00 (перерыв 13–14 исключён)
    expect(await annaSlots()).toEqual(['12:00', '14:00', '14:30', '15:00']);
    // у других специалистов смен нет
    const bolat = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/availability`, { date, items: [{ serviceId: b.services.haircut, specialistId: b.specialists.bolat }] });
    expect(bolat.body.slots).toEqual([]);
  });

  it('сокращение или снятие смены при записях: предупреждение со списком, изменение только с подтверждением', async () => {
    await setMode('shifts');
    const anna = await resourceOf(b.specialists.anna);
    expect((await b.owner.put(url(), { resourceId: anna, date, startMinute: 600, endMinute: 1200 })).status).toBe(200);
    const booked = await bookAndConfirm(ctx, b.slug, { startAt: localTime(date, '11:00'), items: [{ serviceId: b.services.haircut, specialistId: b.specialists.anna }] });
    expect(booked.confirm?.status).toBe(200);

    // сокращение смены: запись 11:00 окажется вне 14:00–20:00
    const shorter = await b.owner.put(url(), { resourceId: anna, date, startMinute: 840, endMinute: 1200 });
    expect(shorter.status).toBe(409);
    expect(shorter.body.error.code).toBe('SHIFT_CONFLICT');
    expect(shorter.body.error.details.appointments).toEqual([expect.objectContaining({ clientPhone: booked.phone, services: ['Стрижка'] })]);
    // смена не изменилась
    expect((await ctx.prisma.staffShift.findFirstOrThrow({ where: { resourceId: anna } })).startMinute).toBe(600);
    // изменение, не задевающее запись, проходит без подтверждения
    expect((await b.owner.put(url(), { resourceId: anna, date, startMinute: 600, endMinute: 900 })).status).toBe(200);

    // снятие со смены
    const rm = await b.owner.post(url('/remove'), { resourceId: anna, date });
    expect(rm.status).toBe(409);
    expect(rm.body.error.details.appointments).toHaveLength(1);
    const forced = await b.owner.post(url('/remove'), { resourceId: anna, date, force: true });
    expect(forced.status).toBe(200);
    expect(forced.body).toMatchObject({ removed: 1, conflicts: [expect.objectContaining({ clientPhone: booked.phone })] });
    // запись не отменена и видна как конфликт в статусе графика
    const appt = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: booked.hold.body.appointmentId } });
    expect(appt.status).toBe('confirmed');
    const status = await b.owner.get(url('/status'));
    expect(status.body.mode).toBe('shifts');
    expect(status.body.conflicts).toEqual([expect.objectContaining({ appointmentId: appt.id })]);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'shift.removed' } })).toBe(1);
  });

  it('заполнение по недельному графику, копирование дня, статус «завтра не заполнено»', async () => {
    await setMode('shifts');
    const tomorrow = DateTime.now().setZone(TZ).plus({ days: 1 }).toISODate()!;
    let status = await b.owner.get(url('/status'));
    expect(status.body.tomorrow).toMatchObject({ date: tomorrow, filled: false, specialists: 4 });

    const to = DateTime.fromISO(date).plus({ days: 2 }).toISODate()!;
    const fill = await b.owner.post(url('/fill'), { from: date, to });
    expect(fill.status).toBe(200);
    expect(fill.body.created).toBe(12); // 4 специалиста × 3 дня, недельный график филиала 10–20
    const shift = await ctx.prisma.staffShift.findFirstOrThrow({ where: { resourceId: await resourceOf(b.specialists.anna), date: new Date(`${date}T00:00:00Z`) } });
    expect(shift).toMatchObject({ startMinute: 600, endMinute: 1200, breakStart: null });
    expect((await b.owner.post(url('/fill'), { from: date, to })).body).toMatchObject({ created: 0, skipped: 12 });

    const copy = await b.owner.post(url('/copy'), { fromDate: date, toDates: [tomorrow] });
    expect(copy.body.created).toBe(4);
    status = await b.owner.get(url('/status'));
    expect(status.body.tomorrow).toMatchObject({ filled: true, withShift: 4 });

    const list = await b.owner.get(url(`?from=${tomorrow}&to=${to}`));
    expect(list.body.shifts.length).toBe(16);
    expect(list.body.specialists.map((s: { name: string }) => s.name).sort()).toEqual(['Анна', 'Болат', 'Иван', 'Пётр']);
  });

  it('назначение специалистов на услугу из её карточки (задача 20)', async () => {
    const u = `${API}/organizations/${b.orgId}/branches/${b.branchId}/specialists/by-service/${b.services.color}`;
    // окрашивание сейчас делает только Анна; назначаем Болата вместо неё
    const r = await b.owner.put(u, { specialistIds: [b.specialists.bolat] });
    expect(r.status).toBe(200);
    const links = await ctx.prisma.specialistService.findMany({ where: { serviceId: b.services.color } });
    expect(links.map((l) => l.specialistId)).toEqual([b.specialists.bolat]);
    const slots = await new Http(ctx.app).post(`${API}/public/branches/${b.slug}/availability`, { date, items: [{ serviceId: b.services.color, specialistId: b.specialists.anna }] });
    expect(slots.status).toBe(400); // Анна больше не оказывает услугу
    // услуга не подключена к чужому филиалу, специалист чужого филиала, дубли
    const other = await createBookableBranch(ctx, admin, { name: 'Другой' });
    expect((await b.owner.put(u, { specialistIds: [other.specialists.anna] })).status).toBe(400);
    expect((await b.owner.put(u, { specialistIds: [b.specialists.bolat, b.specialists.bolat] })).status).toBe(400);
    expect((await other.owner.put(u, { specialistIds: [] })).status).toBe(404);
  });

  it('проверки: перерыв вне смены, ресурс не специалист, чужая организация, права администратора', async () => {
    const anna = await resourceOf(b.specialists.anna);
    expect((await b.owner.put(url(), { resourceId: anna, date, startMinute: 600, endMinute: 900, breakStart: 960, breakEnd: 1000 })).status).toBe(400);
    expect((await b.owner.put(url(), { resourceId: anna, date, startMinute: 900, endMinute: 600 })).status).toBe(400);
    expect((await b.owner.put(url(), { resourceId: b.cabinet, date, startMinute: 600, endMinute: 900 })).status).toBe(400);

    const other = await createBookableBranch(ctx, admin, { name: 'Чужой' });
    expect([403, 404]).toContain((await other.owner.put(url(), { resourceId: anna, date, startMinute: 600, endMinute: 900 })).status);
    expect([403, 404]).toContain((await other.owner.get(url(`?from=${date}&to=${date}`))).status);

    const created = await b.owner.post(`${API}/organizations/${b.orgId}/users`, {
      email: 'shift-admin@test.kz',
      name: 'Админ',
      temporaryPassword: 'Password123!',
      role: 'BRANCH_ADMIN',
      branchAccess: [{ branchId: b.branchId, permissions: ['appointments.view'] }],
    });
    expect(created.status).toBe(201);
    const adm = await loginStaff(ctx, 'shift-admin@test.kz', 'Password123!');
    expect((await adm.get(url(`?from=${date}&to=${date}`))).status).toBe(200);
    expect((await adm.put(url(), { resourceId: anna, date, startMinute: 600, endMinute: 900 })).status).toBe(403);
  });
});
