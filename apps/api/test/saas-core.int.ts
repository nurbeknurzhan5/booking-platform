import { API, bootstrapTestApp, createOrgWithOwner, createSuperadmin, Http, loginStaff, loginSuperadmin, resetDb, type TestContext } from './helpers';

describe('Этап 2: SaaS-основа — авторизация, организации, филиалы, изоляция', () => {
  let ctx: TestContext;
  let sa: Awaited<ReturnType<typeof createSuperadmin>>;
  let admin: Http;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx);
    sa = await createSuperadmin(ctx);
    admin = await loginSuperadmin(ctx, sa);
  });

  describe('аутентификация сотрудников', () => {
    it('суперадмин: без TOTP — mfaRequired, с неверным — 401, с верным — сессия', async () => {
      const h = new Http(ctx.app);
      const r1 = await h.post(`${API}/auth/staff/login`, { email: sa.email, password: sa.password });
      expect(r1.status).toBe(200);
      expect(r1.body).toEqual({ mfaRequired: true });
      const r2 = await h.post(`${API}/auth/staff/login`, { email: sa.email, password: sa.password, totpCode: '000000' });
      expect(r2.status).toBe(401);
      expect(r2.body.error.code).toBe('MFA_INVALID');
      const me = await admin.get(`${API}/auth/me`);
      expect(me.status).toBe(200);
      expect(me.body.isSuperadmin).toBe(true);
      expect(me.body.mfaVerified).toBe(true);
    });

    it('неверный пароль → INVALID_CREDENTIALS без раскрытия существования email', async () => {
      const h = new Http(ctx.app);
      const a = await h.post(`${API}/auth/staff/login`, { email: sa.email, password: 'wrong-password' });
      const b = await h.post(`${API}/auth/staff/login`, { email: 'nobody@x.kz', password: 'wrong-password' });
      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
      expect(a.body.error.code).toBe(b.body.error.code);
    });

    it('без сессии staff-маршруты → 401, admin-маршруты для не-суперадмина → 404', async () => {
      const anon = new Http(ctx.app);
      expect((await anon.get(`${API}/admin/organizations`)).status).toBe(401);
      const { owner } = await createOrgWithOwner(ctx, admin);
      expect((await owner.get(`${API}/admin/organizations`)).status).toBe(404);
    });

    it('временный пароль: до смены доступ к организации запрещён', async () => {
      const plan = await ctx.prisma.plan.findUniqueOrThrow({ where: { code: 'start' } });
      const res = await admin.post(`${API}/admin/organizations`, {
        name: 'Org',
        businessCategory: 'barbershop',
        owner: { email: 'tmp@test.kz', name: 'Tmp', temporaryPassword: 'TempPass123!' },
        subscription: { planId: plan.id, startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 86400_000).toISOString() },
      });
      expect(res.status).toBe(201);
      const h = new Http(ctx.app);
      const login = await h.post(`${API}/auth/staff/login`, { email: 'tmp@test.kz', password: 'TempPass123!' });
      expect(login.body.user.mustChangePassword).toBe(true);
      const blocked = await h.get(`${API}/organizations/${res.body.id}`);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      const ch = await h.post(`${API}/auth/staff/change-password`, { currentPassword: 'TempPass123!', newPassword: 'NewPass12345!' });
      expect(ch.status).toBe(204);
      expect((await h.get(`${API}/organizations/${res.body.id}`)).status).toBe(200);
    });

    it('CSRF: изменяющий запрос с сессией без X-CSRF-Token отклоняется', async () => {
      const { orgId, owner } = await createOrgWithOwner(ctx, admin);
      const saved = owner.csrf;
      owner.csrf = '';
      const r = await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'Филиал' });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('CSRF_INVALID');
      owner.csrf = saved;
    });
  });

  describe('организации и филиалы', () => {
    it('суперадмин создаёт организацию; аудит фиксирует действие', async () => {
      const { orgId } = await createOrgWithOwner(ctx, admin, { name: 'Барбер' });
      const list = await admin.get(`${API}/admin/organizations`);
      expect(list.body.find((o: { id: string }) => o.id === orgId).subscription.status).toBe('active');
      const audit = await ctx.prisma.auditLog.findMany({ where: { organizationId: orgId } });
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['organization.created', 'owner.created', 'subscription.created']));
    });

    it('владелец создаёт филиал; slug постоянный и уникальный; лимит тарифа соблюдается', async () => {
      const { orgId, owner } = await createOrgWithOwner(ctx, admin, { maxBranches: 2 });
      const b1 = await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'Салон Әсем', address: 'Алматы' });
      expect(b1.status).toBe(201);
      expect(b1.body.slug).toBe('salon-asem');
      const b2 = await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'Салон Әсем' });
      expect(b2.status).toBe(201);
      expect(b2.body.slug).toBe('salon-asem-2');
      const b3 = await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'Третий' });
      expect(b3.status).toBe(403);
      expect(b3.body.error.code).toBe('BRANCH_LIMIT_REACHED');
    });

    it('параллельное создание филиалов не превышает лимит', async () => {
      const { orgId, owner } = await createOrgWithOwner(ctx, admin, { maxBranches: 2 });
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => owner.post(`${API}/organizations/${orgId}/branches`, { name: `Филиал ${i}` })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(await ctx.prisma.branch.count({ where: { organizationId: orgId } })).toBe(2);
    });

    it('владелец не может изменить подписку (нет маршрута) и не может создать владельца', async () => {
      const { orgId, owner } = await createOrgWithOwner(ctx, admin);
      expect((await owner.put(`${API}/admin/organizations/${orgId}/subscription`, {})).status).toBe(404);
      const r = await owner.post(`${API}/organizations/${orgId}/users`, {
        email: 'o2@test.kz',
        name: 'O2',
        temporaryPassword: 'Password123!',
        role: 'OWNER',
      });
      expect(r.status).toBe(403);
    });

    it('владелец восстанавливает доступ своему администратору филиала (D-35), но не владельцу и не чужим', async () => {
      const a = await createOrgWithOwner(ctx, admin, { name: 'A' });
      const b = await createOrgWithOwner(ctx, admin, { name: 'B' });
      const branch = (await a.owner.post(`${API}/organizations/${a.orgId}/branches`, { name: 'A1' })).body;
      const created = await a.owner.post(`${API}/organizations/${a.orgId}/users`, {
        email: 'adm-reset@test.kz',
        name: 'Админ',
        temporaryPassword: 'Password123!',
        role: 'BRANCH_ADMIN',
        branchAccess: [{ branchId: branch.id, permissions: ['appointments.view'] }],
      });
      expect(created.status).toBe(201);
      const adminHttp = await loginStaff(ctx, 'adm-reset@test.kz', 'Password123!');
      const url = (org: string, user: string) => `${API}/organizations/${org}/users/${user}/reset-password`;

      expect((await a.owner.post(url(a.orgId, created.body.id), { temporaryPassword: 'short' })).status).toBe(400);
      expect((await a.owner.post(url(a.orgId, created.body.id), { temporaryPassword: 'NewTemp12345' })).status).toBe(204);
      expect((await adminHttp.get(`${API}/auth/me`)).status).toBe(401); // сессии отозваны
      const relog = await new Http(ctx.app).post(`${API}/auth/staff/login`, { email: 'adm-reset@test.kz', password: 'NewTemp12345' });
      expect(relog.body.user.mustChangePassword).toBe(true);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'staff.password_reset', entityId: created.body.id } })).toBe(1);

      // владельца, себя и сотрудника чужой организации — нельзя
      const ownerA = await ctx.prisma.userOrganizationRole.findFirstOrThrow({ where: { organizationId: a.orgId, roleCode: 'OWNER' } });
      expect((await a.owner.post(url(a.orgId, ownerA.userId), { temporaryPassword: 'NewTemp12345' })).status).toBe(400); // это он сам
      const ownerB = await ctx.prisma.userOrganizationRole.findFirstOrThrow({ where: { organizationId: b.orgId, roleCode: 'OWNER' } });
      expect((await a.owner.post(url(a.orgId, ownerB.userId), { temporaryPassword: 'NewTemp12345' })).status).toBe(404);
      expect((await b.owner.post(url(b.orgId, created.body.id), { temporaryPassword: 'NewTemp12345' })).status).toBe(404);

      // сотрудник, работающий и в другой организации, — только через администратора платформы
      await ctx.prisma.userOrganizationRole.create({ data: { userId: created.body.id, organizationId: b.orgId, roleCode: 'BRANCH_ADMIN' } });
      expect((await a.owner.post(url(a.orgId, created.body.id), { temporaryPassword: 'NewTemp12345' })).status).toBe(403);
    });
  });

  describe('изоляция организаций (§26.5)', () => {
    it('владелец A не видит и не изменяет данные организации B', async () => {
      const a = await createOrgWithOwner(ctx, admin, { name: 'A' });
      const b = await createOrgWithOwner(ctx, admin, { name: 'B' });
      const bBranch = await b.owner.post(`${API}/organizations/${b.orgId}/branches`, { name: 'B-филиал' });
      expect(bBranch.status).toBe(201);

      expect((await a.owner.get(`${API}/organizations/${b.orgId}`)).status).toBe(404);
      expect((await a.owner.get(`${API}/organizations/${b.orgId}/branches`)).status).toBe(404);
      expect((await a.owner.post(`${API}/organizations/${b.orgId}/branches`, { name: 'hack' })).status).toBe(404);
      // подмена ID филиала в маршруте своей организации
      expect((await a.owner.get(`${API}/organizations/${a.orgId}/branches/${bBranch.body.id}`)).status).toBe(404);
      expect((await a.owner.patch(`${API}/organizations/${a.orgId}/branches/${bBranch.body.id}`, { name: 'x' })).status).toBe(404);
      expect((await a.owner.get(`${API}/organizations/not-a-uuid`)).status).toBe(404);
      const unchanged = await ctx.prisma.branch.findUniqueOrThrow({ where: { id: bBranch.body.id } });
      expect(unchanged.name).toBe('B-филиал');
    });

    it('выдача администратору доступа к филиалу чужой организации невозможна', async () => {
      const a = await createOrgWithOwner(ctx, admin, { name: 'A' });
      const b = await createOrgWithOwner(ctx, admin, { name: 'B' });
      const bBranch = await b.owner.post(`${API}/organizations/${b.orgId}/branches`, { name: 'B1' });
      const r = await a.owner.post(`${API}/organizations/${a.orgId}/users`, {
        email: 'adm@test.kz',
        name: 'Adm',
        temporaryPassword: 'Password123!',
        role: 'BRANCH_ADMIN',
        branchAccess: [{ branchId: bBranch.body.id, permissions: ['appointments.view'] }],
      });
      expect(r.status).toBe(404);
      expect(await ctx.prisma.user.count({ where: { email: 'adm@test.kz' } })).toBe(0);
    });
  });

  describe('RBAC администратора филиала (§3.2, §3.5)', () => {
    it('доступ ограничен назначенными филиалами и правами; повышение привилегий невозможно', async () => {
      const { orgId, owner } = await createOrgWithOwner(ctx, admin);
      const b1 = (await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'B1' })).body;
      const b2 = (await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'B2' })).body;
      const created = await owner.post(`${API}/organizations/${orgId}/users`, {
        email: 'admin1@test.kz',
        name: 'Admin1',
        temporaryPassword: 'Password123!',
        role: 'BRANCH_ADMIN',
        branchAccess: [{ branchId: b1.id, permissions: ['appointments.view', 'appointments.manage'] }],
      });
      expect(created.status).toBe(201);
      const adm = await loginStaff(ctx, 'admin1@test.kz', 'Password123!');

      const branches = await adm.get(`${API}/organizations/${orgId}/branches`);
      expect(branches.body.map((b: { id: string }) => b.id)).toEqual([b1.id]);
      expect((await adm.get(`${API}/organizations/${orgId}/branches/${b2.id}`)).status).toBe(404);
      expect((await adm.patch(`${API}/organizations/${orgId}/branches/${b1.id}`, { name: 'x' })).status).toBe(403);
      expect((await adm.post(`${API}/organizations/${orgId}/users`, { email: 'z@z.kz', name: 'z', temporaryPassword: 'Password123!', role: 'BRANCH_ADMIN' })).status).toBe(403);
      expect((await adm.put(`${API}/organizations/${orgId}/users/${created.body.id}/access`, { branchAccess: [{ branchId: b2.id, permissions: ['appointments.view'] }] })).status).toBe(403);
      expect((await adm.post(`${API}/organizations/${orgId}/branches`, { name: 'B3' })).status).toBe(403);
      expect((await adm.put(`${API}/organizations/${orgId}/branches/${b1.id}/booking-settings`, {})).status).toBe(403);

      // владелец выдаёт право — доступ появляется
      const upd = await owner.put(`${API}/organizations/${orgId}/users/${created.body.id}/access`, {
        branchAccess: [{ branchId: b1.id, permissions: ['appointments.view', 'branch.settings.manage'] }],
      });
      expect(upd.status).toBe(200);
      expect((await adm.patch(`${API}/organizations/${orgId}/branches/${b1.id}`, { name: 'B1 new' })).status).toBe(200);

      // отзыв доступа
      expect((await owner.delete(`${API}/organizations/${orgId}/users/${created.body.id}`)).status).toBe(204);
      expect((await adm.get(`${API}/organizations/${orgId}`)).status).toBe(404);
    });
  });

  describe('подписка ограничивает доступ (§2.3, критерий 15)', () => {
    it('expired: чтение доступно, изменения — SUBSCRIPTION_INACTIVE; продление восстанавливает', async () => {
      const { orgId, owner } = await createOrgWithOwner(ctx, admin, {
        startsAt: new Date(Date.now() - 40 * 86400_000),
        endsAt: new Date(Date.now() - 10 * 86400_000),
        graceDays: 3,
      });
      expect((await owner.get(`${API}/organizations/${orgId}`)).body.subscriptionStatus).toBe('expired');
      const r = await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'X' });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('SUBSCRIPTION_INACTIVE');

      const pay = await admin.post(`${API}/admin/organizations/${orgId}/subscription/payments`, {
        amount: 35000,
        paidAt: new Date().toISOString(),
        method: 'kaspi',
        extendTo: new Date(Date.now() + 30 * 86400_000).toISOString(),
      });
      expect(pay.status).toBe(201);
      expect((await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'X' })).status).toBe(201);
      const hist = await admin.get(`${API}/admin/organizations/${orgId}/subscription/history`);
      expect(hist.body.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['payment_recorded', 'renewed']));
      expect(hist.body.payments).toHaveLength(1);
    });

    it('grace_period: работа разрешена', async () => {
      const { orgId, owner } = await createOrgWithOwner(ctx, admin, {
        startsAt: new Date(Date.now() - 40 * 86400_000),
        endsAt: new Date(Date.now() - 1 * 86400_000),
        graceDays: 7,
      });
      expect((await owner.get(`${API}/organizations/${orgId}`)).body.subscriptionStatus).toBe('grace_period');
      expect((await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'X' })).status).toBe(201);
    });

    it('блокировка требует MFA-подтверждения; suspended блокирует изменения; история не удаляется', async () => {
      const { orgId, owner } = await createOrgWithOwner(ctx, admin);
      const saved = admin.mfaCode;
      admin.mfaCode = undefined;
      const noMfa = await admin.post(`${API}/admin/organizations/${orgId}/suspend`, { reason: 'Неоплата' });
      expect(noMfa.status).toBe(403);
      expect(noMfa.body.error.code).toBe('MFA_REQUIRED');
      admin.mfaCode = saved;
      const ok = await admin.post(`${API}/admin/organizations/${orgId}/suspend`, { reason: 'Неоплата' });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('suspended');
      const r = await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'X' });
      expect(r.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
      await expect(ctx.prisma.subscriptionHistory.deleteMany({ where: { organizationId: orgId } })).rejects.toThrow();
      await expect(ctx.prisma.auditLog.deleteMany({ where: { organizationId: orgId } })).rejects.toThrow();
      const restore = await admin.post(`${API}/admin/organizations/${orgId}/restore`, { reason: 'Оплачено' });
      expect(restore.body.status).toBe('active');
    });

    it('восстановление доступа (§3.4): временный пароль, смена при входе, отзыв сессий, снятие блокировки входа, аудит', async () => {
      const { orgId, owner, ownerEmail } = await createOrgWithOwner(ctx, admin);
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
      // владелец «забыл пароль» и заблокировал вход неудачными попытками
      await ctx.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 4, lockedUntil: new Date(Date.now() + 15 * 60_000) } });
      const url = `${API}/admin/users/${user.id}/reset-password`;
      const body = { temporaryPassword: 'TempReset12345', reason: 'Обращение владельца по телефону' };

      const saved = admin.mfaCode;
      admin.mfaCode = undefined;
      expect((await admin.post(url, body)).body.error.code).toBe('MFA_REQUIRED');
      admin.mfaCode = saved;
      expect((await admin.post(url, { ...body, temporaryPassword: 'short' })).status).toBe(400);
      // владелец организации не может восстанавливать доступ через админ-API (маршрут для него не существует)
      expect((await owner.post(url, body)).status).toBe(404);
      expect((await admin.post(url, body)).status).toBe(204);

      // старая сессия отозвана, старый пароль не подходит, временный — требует смены
      expect((await owner.get(`${API}/auth/me`)).status).toBe(401);
      expect((await new Http(ctx.app).post(`${API}/auth/staff/login`, { email: ownerEmail, password: 'OwnerPass123!X1' })).status).toBe(401);
      const fresh = new Http(ctx.app);
      const login = await fresh.post(`${API}/auth/staff/login`, { email: ownerEmail, password: 'TempReset12345' });
      expect(login.status).toBe(200);
      expect(login.body.user.mustChangePassword).toBe(true);
      const pending = await fresh.get(`${API}/organizations/${orgId}`);
      expect(pending.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await fresh.post(`${API}/auth/staff/change-password`, { currentPassword: 'TempReset12345', newPassword: 'NewOwnerPass123' })).status).toBe(204);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'user.password_reset', entityId: user.id } });
      expect(JSON.stringify(audit)).not.toContain('TempReset12345');

      // свой пароль — только через смену; у клиента пароля нет
      expect((await admin.post(`${API}/admin/users/${(await ctx.prisma.user.findFirstOrThrow({ where: { isSuperadmin: true } })).id}/reset-password`, body)).status).toBe(400);
      const client = await ctx.prisma.user.create({ data: { name: 'Клиент', phone: '+77019998877' } });
      expect((await admin.post(`${API}/admin/users/${client.id}/reset-password`, body)).status).toBe(422);
    });

    it('воркер пересчитывает статусы подписок и пишет переходы', async () => {
      const { orgId } = await createOrgWithOwner(ctx, admin);
      await ctx.prisma.subscription.update({ where: { organizationId: orgId }, data: { endsAt: new Date(Date.now() - 1000), graceDays: 0 } });
      const { SubscriptionsService } = await import('../src/subscriptions/subscriptions.service');
      const changed = await ctx.app.get(SubscriptionsService).refreshStatuses();
      expect(changed).toBe(1);
      const sub = await ctx.prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
      expect(sub.status).toBe('expired');
    });
  });
});
