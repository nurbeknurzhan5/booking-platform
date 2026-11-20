import { API, bootstrapTestApp, createOrgWithOwner, createSuperadmin, Http, loginStaff, loginSuperadmin, resetDb, type TestContext } from './helpers';
import { createBookableBranch, futureDate, localTime, nextPhone } from './fixtures';

/** Проверки безопасности (ТЗ §26.5, §22). */
describe('Безопасность', () => {
  let ctx: TestContext;
  let admin: Http;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx);
    admin = await loginSuperadmin(ctx, await createSuperadmin(ctx));
  });

  it('массовая отправка OTP с одного IP ограничена', async () => {
    const h = new Http(ctx.app, '10.9.9.9');
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await h.post(`${API}/auth/client/otp/request`, { phone: nextPhone() })).status);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(20);
    expect(statuses).toContain(429);
  });

  it('перебор пароля сотрудника блокирует вход', async () => {
    const { ownerEmail } = await createOrgWithOwner(ctx, admin);
    const statuses: number[] = [];
    for (let i = 0; i < 18; i++) statuses.push((await new Http(ctx.app).post(`${API}/auth/staff/login`, { email: ownerEmail, password: `wrong-${i}` })).status);
    expect(statuses).toContain(429);
  });

  it('все административные endpoint недоступны без суперадмина с MFA', async () => {
    const { owner } = await createOrgWithOwner(ctx, admin);
    const anon = new Http(ctx.app);
    for (const path of ['/admin/organizations', '/admin/stats', '/admin/notifications', '/admin/templates', '/admin/audit-logs', '/admin/settings', '/admin/users']) {
      expect((await anon.get(`${API}${path}`)).status).toBe(401);
      expect((await owner.get(`${API}${path}`)).status).toBe(404);
    }
  });

  it('повышение привилегий: администратор не может выдать себе права и стать владельцем', async () => {
    const { orgId, owner } = await createOrgWithOwner(ctx, admin);
    const b = (await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'B1' })).body;
    const created = await owner.post(`${API}/organizations/${orgId}/users`, {
      email: 'esc@test.kz',
      name: 'Esc',
      temporaryPassword: 'Password123!',
      role: 'BRANCH_ADMIN',
      branchAccess: [{ branchId: b.id, permissions: ['appointments.view'] }],
    });
    const adm = await loginStaff(ctx, 'esc@test.kz', 'Password123!');
    expect((await adm.put(`${API}/organizations/${orgId}/users/${created.body.id}/access`, { branchAccess: [{ branchId: b.id, permissions: ['users.manage'] }] })).status).toBe(403);
    expect((await adm.post(`${API}/organizations/${orgId}/users`, { email: 'x@x.kz', name: 'x', temporaryPassword: 'Password123!', role: 'OWNER' })).status).toBe(403);
    expect((await adm.put(`${API}/organizations/${orgId}/branches/${b.id}/booking-settings`, {})).status).toBe(403);
    expect((await adm.get(`${API}/organizations/${orgId}/audit-logs`)).status).toBe(403);
  });

  it('подмена ID: чужие записи, клиенты, услуги и файлы недоступны', async () => {
    const a = await createBookableBranch(ctx, admin, { name: 'A' });
    const bOrg = await createBookableBranch(ctx, admin, { name: 'B' });
    const appt = await a.owner.post(`${API}/organizations/${a.orgId}/appointments`, {
      branchId: a.branchId,
      startAt: localTime(futureDate(2), '11:00'),
      items: [{ serviceId: a.services.haircut }],
      client: { name: 'C', phone: nextPhone() },
    });
    expect(appt.status).toBe(201);
    const o = bOrg.owner;
    const B = `${API}/organizations/${bOrg.orgId}`;
    expect((await o.get(`${B}/appointments/${appt.body.id}`)).status).toBe(404);
    expect((await o.post(`${B}/appointments/${appt.body.id}/status`, { status: 'cancelled_by_admin', reason: 'x' })).status).toBe(404);
    expect((await o.get(`${B}/clients/${appt.body.client.id}`)).status).toBe(404);
    expect((await o.patch(`${B}/services/${a.services.haircut}`, { price: 1 })).status).toBe(404);
    expect((await o.get(`${B}/branches/${a.branchId}/specialists`)).status).toBe(404);
    expect((await o.post(`${B}/branches/${bOrg.branchId}/specialists`, { name: 'X', services: [{ serviceId: a.services.haircut }] })).status).toBe(400);
    // Нельзя подложить чужую услугу в свою запись
    const cross = await o.post(`${B}/appointments`, {
      branchId: bOrg.branchId,
      startAt: localTime(futureDate(2), '12:00'),
      items: [{ serviceId: a.services.haircut }],
      client: { name: 'C', phone: nextPhone() },
    });
    expect(cross.status).toBe(400);
    const unchanged = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: appt.body.id } });
    expect(unchanged.status).toBe('confirmed');
  });

  it('БД не позволяет связать данные разных организаций (составные внешние ключи)', async () => {
    const a = await createBookableBranch(ctx, admin, { name: 'A' });
    const b = await createBookableBranch(ctx, admin, { name: 'B' });
    await expect(
      ctx.prisma.branchService.create({ data: { organizationId: b.orgId, branchId: b.branchId, serviceId: a.services.haircut } }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.specialistService.create({ data: { organizationId: b.orgId, specialistId: b.specialists.anna, serviceId: a.services.haircut } }),
    ).rejects.toThrow();
  });

  it('SQL-инъекция в параметрах поиска не выполняется', async () => {
    const { orgId, owner } = await createOrgWithOwner(ctx, admin);
    const r = await owner.get(`${API}/organizations/${orgId}/clients?search=${encodeURIComponent("'; DROP TABLE clients; --")}`);
    expect(r.status).toBe(200);
    expect(await ctx.prisma.client.count()).toBeGreaterThanOrEqual(0);
    const r2 = await admin.get(`${API}/admin/organizations?search=${encodeURIComponent("' OR 1=1 --")}`);
    expect(r2.body).toEqual([]);
  });

  it('cookie сессии HttpOnly + SameSite; заголовки безопасности; секреты не попадают в ответы', async () => {
    const { ownerEmail } = await createOrgWithOwner(ctx, admin);
    const h = new Http(ctx.app);
    const r = await h.post(`${API}/auth/staff/login`, { email: ownerEmail, password: 'OwnerPass123!X1' });
    const cookies = (r.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookies).toMatch(/bk_sid=[^;]+;.*HttpOnly/i);
    expect(cookies).toMatch(/SameSite=Lax/i);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
    const users = await admin.get(`${API}/admin/users`);
    expect(JSON.stringify(users.body)).not.toMatch(/passwordHash|mfaSecret|argon2/);
    const session = await ctx.prisma.userSession.findFirstOrThrow();
    expect(cookies).not.toContain(session.tokenHash); // в БД только хэш токена
  });

  it('OpenAPI-документация генерируется', async () => {
    const r = await new Http(ctx.app).get(`${API}/docs-json`);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.paths).length).toBeGreaterThan(80);
    expect(r.body.paths['/api/v1/public/branches/{slug}/bookings']).toBeDefined();
  });

  it('запрос записи с ID чужого специалиста не проходит', async () => {
    const a = await createBookableBranch(ctx, admin, { name: 'A' });
    const b = await createBookableBranch(ctx, admin, { name: 'B' });
    const r = await new Http(ctx.app).post(`${API}/public/branches/${a.slug}/availability`, {
      date: futureDate(2),
      items: [{ serviceId: a.services.haircut, specialistId: b.specialists.anna }],
    });
    expect(r.status).toBe(400);
  });
});
