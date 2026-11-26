import { randomUUID } from 'node:crypto';
import { API, bootstrapTestApp, createOrgWithOwner, createSuperadmin, Http, loginSuperadmin, type TestContext } from './helpers';
import { seedReferenceData } from '../src/seed/reference-data';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { AdminOrganizationsService } from '../src/admin/admin-organizations.service';
import { AppError } from '../src/common/errors';

/**
 * Аудит B: несуществующие даты и периоды подписки со смещениями.
 * БД общая с другими наборами: без resetDb, уникальные имена и IP 10.66.x.x.
 */
describe('Аудит B: даты и периоды', () => {
  let ctx: TestContext;
  let admin: Http;
  let planId: string;
  const tag = randomUUID().slice(0, 8);
  let ipSeq = 0;
  const ip = () => `10.66.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
  const actor = { userId: null, actorType: 'superadmin' as const, ip: '10.66.250.1', userAgent: 'audit-b' };

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    // Справочники уже загружены другими наборами; иначе — идемпотентная загрузка (не очистка).
    if (!(await ctx.prisma.plan.findUnique({ where: { code: 'business' } }))) await seedReferenceData(ctx.prisma);
    planId = (await ctx.prisma.plan.findUniqueOrThrow({ where: { code: 'business' } })).id;
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    admin = await loginSuperadmin(ctx, await createSuperadmin(ctx, `root-audit-b-${randomUUID().slice(0, 8)}@platform.kz`));
    admin.ip = ip();
  });

  const sub = (startsAt: string, endsAt: string) => ({ planId, maxBranches: 2, startsAt, endsAt, graceDays: 7 });

  it('PUT подписки: период сравнивается как моменты времени, а не как строки', async () => {
    const { orgId } = await createOrgWithOwner(ctx, admin, { name: `Аудит B ${tag} подписка` });
    const url = `${API}/admin/organizations/${orgId}/subscription`;

    // 04:00-08:00 = 12:00Z позже 11:00Z: строковое сравнение пропускало такой период
    const inverted = await admin.put(url, sub('2026-12-01T04:00:00-08:00', '2026-12-01T11:00:00Z'));
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(inverted.body.error.details)).toContain('endsAt');

    // 12:00+05:00 = 07:00Z позже 06:00Z
    expect((await admin.put(url, sub('2026-12-01T12:00:00+05:00', '2026-12-01T06:00:00Z'))).status).toBe(400);
    // Пустой период
    expect((await admin.put(url, sub('2026-12-01T06:00:00Z', '2026-12-01T11:00:00+05:00'))).status).toBe(400);

    // 09:00Z раньше 05:00-05:00 = 10:00Z: строковое сравнение отклоняло корректный период
    const ok = await admin.put(url, sub('2026-12-01T09:00:00Z', '2026-12-01T05:00:00-05:00'));
    expect(ok.status).toBe(200);
    const saved = await ctx.prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(saved.startsAt.toISOString()).toBe('2026-12-01T09:00:00.000Z');
    expect(saved.endsAt.toISOString()).toBe('2026-12-01T10:00:00.000Z');

    // 10:00+05:00 = 05:00Z раньше 06:00Z — тоже корректный период
    expect((await admin.put(url, sub('2026-12-01T10:00:00+05:00', '2026-12-01T06:00:00Z'))).status).toBe(200);

    // Несуществующая дата в подписке
    expect((await admin.put(url, sub('2026-02-31T00:00:00Z', '2026-12-01T06:00:00Z'))).status).toBe(400);
  });

  it('POST /admin/organizations с неверным периодом подписки — 400, организация не создаётся', async () => {
    const name = `Аудит B ${tag} создание`;
    const body = (startsAt: string, endsAt: string) => ({ name, businessCategory: 'beauty_salon', subscription: sub(startsAt, endsAt) });

    const bad = await admin.post(`${API}/admin/organizations`, body('2026-12-01T04:00:00-08:00', '2026-12-01T11:00:00Z'));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect((await admin.post(`${API}/admin/organizations`, body('2026-12-01T12:00:00Z', '2026-12-01T06:00:00Z'))).status).toBe(400);
    expect(await ctx.prisma.organization.count({ where: { name } })).toBe(0);

    const ok = await admin.post(`${API}/admin/organizations`, body('2026-12-01T09:00:00Z', '2026-12-01T05:00:00-05:00'));
    expect(ok.status).toBe(201);
    const saved = await ctx.prisma.subscription.findUniqueOrThrow({ where: { organizationId: ok.body.id } });
    expect(saved.endsAt.getTime() - saved.startsAt.getTime()).toBe(3600_000);
  });

  it('сервисы проверяют период и без схемы (защита в глубину)', async () => {
    const { orgId } = await createOrgWithOwner(ctx, admin, { name: `Аудит B ${tag} сервис` });
    const before = await ctx.prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    const subs = ctx.app.get(SubscriptionsService);
    const err = await subs
      .set(orgId, { ...sub('2026-12-01T04:00:00-08:00', '2026-12-01T11:00:00Z'), graceDays: 7 }, { ...actor, organizationId: orgId })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('VALIDATION_ERROR');
    expect((err as AppError).status).toBe(400);
    const after = await ctx.prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(after.endsAt.toISOString()).toBe(before.endsAt.toISOString());

    const name = `Аудит B ${tag} сервис-создание`;
    const orgs = ctx.app.get(AdminOrganizationsService);
    const err2 = await orgs
      .create(
        {
          name,
          businessCategory: 'beauty_salon',
          contacts: {},
          defaultLocale: 'ru',
          subscription: { ...sub('2026-12-01T07:00:00Z', '2026-12-01T07:00:00Z'), graceDays: 7 },
        },
        actor,
      )
      .catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(AppError);
    expect((err2 as AppError).code).toBe('VALIDATION_ERROR');
    expect(await ctx.prisma.organization.count({ where: { name } })).toBe(0);
  });

  it('несуществующие даты в поиске слотов и аналитике — 400 VALIDATION_ERROR', async () => {
    const anon = new Http(ctx.app, ip());
    const items = [{ serviceId: randomUUID() }];
    for (const date of ['2026-02-31', '2026-13-01', '2026-00-10', '2025-02-29']) {
      for (const path of ['availability', 'availability/overview']) {
        const res = await anon.post(`${API}/public/branches/audit-b-${tag}/${path}`, { date, items });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    }

    const { orgId, owner } = await createOrgWithOwner(ctx, admin, { name: `Аудит B ${tag} аналитика` });
    owner.ip = ip();
    // Раньше 2026-02-31 молча сдвигалась на 3 марта
    const bad = await owner.get(`${API}/organizations/${orgId}/analytics?from=2026-02-31&to=2026-03-05`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect((await owner.get(`${API}/organizations/${orgId}/analytics?from=2026-02-01&to=2026-02-28`)).status).toBe(200);
  });
});
