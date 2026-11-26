import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import express from 'express';
import pinoHttp from 'pino-http';
import request from 'supertest';
import { authenticator } from 'otplib';
import { Client } from 'pg';
import { API, bootstrapTestApp, createOrgWithOwner, createSuperadmin, Http, lastDevMessage, loginStaff, loginSuperadmin, otpFromText, type TestContext } from './helpers';
import { bookAndConfirm, createBookableBranch, drainNotifications, futureDate, localTime, publishPageDirect } from './fixtures';
import { seedReferenceData } from '../src/seed/reference-data';
import { createApp, docsEnabled, isInternalAddress, trustProxy } from '../src/bootstrap';
import { getConfig, resetConfigCache } from '../src/config/config';
import { httpLoggerOptions, redactUrlPath } from '../src/common/logging';
import { decrypt, encrypt } from '../src/common/crypto';
import { HealthController } from '../src/health.controller';
import { SESSION_COOKIE } from '../src/auth/session.service';
import { sha256 } from '../src/common/crypto';
import { SystemSettingsService } from '../src/common/system-settings.service';

/**
 * Аудит (подзадача D): MFA, сессии, журналы, IP за прокси, переводы, медиа, Swagger/CSP, crypto, health, pg.
 * БД общая с другими наборами: resetDb не вызывается, все данные и IP уникальны.
 */
describe('Аудит D: auth, логи, страницы, медиа, bootstrap', () => {
  let ctx: TestContext;
  const uniq = () => randomUUID().slice(0, 8);
  const octet = () => 1 + Math.floor(Math.random() * 250);
  const ip = () => `10.68.${octet()}.${octet()}`;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    await seedReferenceData(ctx.prisma);
  });
  afterAll(async () => ctx.close());
  // Общая тестовая БД: другие наборы могут очистить справочники между тестами (идемпотентно).
  beforeEach(async () => {
    await seedReferenceData(ctx.prisma);
    ctx.app.get(SystemSettingsService).invalidate();
  });

  const superadmin = () => createSuperadmin(ctx, `root-${uniq()}@audit-d.kz`);
  /** Код TOTP соседнего временного шага (принимается с допуском ±1 шаг). */
  const codeAt = (secret: string, offsetSec: number) => authenticator.clone({ epoch: Date.now() + offsetSec * 1000 }).generate(secret);

  describe('step-up MFA', () => {
    it('11 неверных X-MFA-Code → 429 (лимит на пользователя), затем и верный код не принимается до конца окна', async () => {
      const sa = await superadmin();
      const admin = await loginSuperadmin(ctx, sa);
      admin.beforeRequest = undefined;
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        statuses.push((await admin.put(`${API}/admin/settings`, {}, { 'X-MFA-Code': String(100000 + i) })).status);
      }
      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(403));
      const blocked = await admin.put(`${API}/admin/settings`, {}, { 'X-MFA-Code': codeAt(sa.secret, 30) });
      expect(statuses[10]).toBe(429);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      // другие IP не обходят лимит: ключ — пользователь
      admin.ip = ip();
      expect((await admin.put(`${API}/admin/settings`, {}, { 'X-MFA-Code': '123456' })).status).toBe(429);
    });

    it('повторное использование того же верного кода отклоняется (в том числе кода, которым выполнен вход)', async () => {
      const sa = await superadmin();
      const admin = await loginSuperadmin(ctx, sa);
      admin.beforeRequest = undefined;
      // код входа уже использован
      const reused = await admin.put(`${API}/admin/settings`, {}, { 'X-MFA-Code': sa.totp() });
      expect(reused.status).toBe(403);
      expect(reused.body.error.code).toBe('MFA_INVALID');
      // код следующего шага принимается один раз (тело пустое → 400 уже после проверки MFA)
      const next = codeAt(sa.secret, 30);
      expect((await admin.put(`${API}/admin/settings`, {}, { 'X-MFA-Code': next })).status).toBe(400);
      const again = await admin.put(`${API}/admin/settings`, {}, { 'X-MFA-Code': next });
      expect(again.status).toBe(403);
      expect(again.body.error.code).toBe('MFA_INVALID');
      // код прошлого шага (старше принятого) тоже не принимается
      expect((await admin.put(`${API}/admin/settings`, {}, { 'X-MFA-Code': codeAt(sa.secret, -30) })).status).toBe(403);
    });

    it('вход суперадмина: повтор кода и перебор TOTP ограничены тем же счётчиком', async () => {
      const sa = await superadmin();
      const code = sa.totp();
      const h = new Http(ctx.app, ip());
      expect((await h.post(`${API}/auth/staff/login`, { email: sa.email, password: sa.password, totpCode: code })).status).toBe(200);
      const replay = await new Http(ctx.app, ip()).post(`${API}/auth/staff/login`, { email: sa.email, password: sa.password, totpCode: code });
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('MFA_INVALID');
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const r = await new Http(ctx.app, ip()).post(`${API}/auth/staff/login`, { email: sa.email, password: sa.password, totpCode: String(200000 + i) });
        statuses.push(r.status);
      }
      expect(statuses).toContain(429);
    });
  });

  describe('сессии', () => {
    it('повторный вход в том же браузере отзывает прежнюю сессию из cookie', async () => {
      const sa = await superadmin();
      const admin = await loginSuperadmin(ctx, sa);
      const { ownerEmail } = await createOrgWithOwner(ctx, admin, { name: `Сессии ${uniq()}` });
      const h = await loginStaff(ctx, ownerEmail, 'OwnerPass123!X1');
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
      // сессия этого браузера — последняя созданная (первая осталась от входа в createOrgWithOwner, другой «браузер»)
      const before = await ctx.prisma.userSession.findMany({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: 'asc' } });
      const mine = before[before.length - 1]!;
      expect((await h.post(`${API}/auth/staff/login`, { email: ownerEmail, password: 'OwnerPass123!X1' })).status).toBe(200);
      expect((await ctx.prisma.userSession.findUniqueOrThrow({ where: { id: mine.id } })).revokedAt).not.toBeNull();
      // сессии других браузеров не затронуты
      expect((await ctx.prisma.userSession.findUniqueOrThrow({ where: { id: before[0]!.id } })).revokedAt).toBeNull();
      expect(await ctx.prisma.userSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(before.length);
      expect((await h.get(`${API}/auth/me`)).status).toBe(200);
    });

    it('вход по коду на номер, указанный у сотрудника без подтверждения, не открывает профиль сотрудника', async () => {
      const admin = await loginSuperadmin(ctx, await superadmin());
      const P = `+7708${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
      const { orgId, owner } = await createOrgWithOwner(ctx, admin, { name: `Телефон ${uniq()}` });
      const email = `staff-d-${uniq()}@audit-d.kz`;
      expect((await owner.post(`${API}/organizations/${orgId}/users`, { email, name: 'Сотрудник', phone: P, temporaryPassword: 'Password123!', role: 'BRANCH_ADMIN' })).status).toBe(201);
      const staff = await loginStaff(ctx, email, 'Password123!');
      const staffUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });

      // гость бронирует в другой организации на номер P
      const b = await createBookableBranch(ctx, admin, { name: `Тел ${uniq()}` });
      const { confirm } = await bookAndConfirm(ctx, b.slug, { startAt: localTime(futureDate(4), '11:00'), items: [{ serviceId: b.services.haircut }], phone: P });
      expect(confirm?.status).toBeLessThan(300);
      const appt = await ctx.prisma.appointment.findFirstOrThrow({ where: { organizationId: b.orgId, client: { phone: P } } });

      // владелец номера входит по коду
      await ctx.prisma.otpCode.updateMany({ where: { phone: P }, data: { createdAt: new Date(Date.now() - 3600_000) } });
      const c = new Http(ctx.app, ip());
      expect((await c.post(`${API}/auth/client/otp/request`, { phone: P })).status).toBe(200);
      await drainNotifications(ctx);
      const v = await c.post(`${API}/auth/client/otp/verify`, { phone: P, code: otpFromText((await lastDevMessage(ctx, P, 'otp'))!.text) });
      expect(v.status).toBe(200);
      expect(v.body.user.id).not.toBe(staffUser.id);
      expect(v.body.user.email).toBeNull();
      expect(((await c.get(`${API}/me/appointments`)).body as Array<{ id: string }>).map((x) => x.id)).toContain(appt.id);

      // парольная сессия сотрудника работает, но записей владельца номера не видит; номер снят с профиля
      expect((await staff.get(`${API}/auth/me`)).status).toBe(200);
      const staffList = await staff.get(`${API}/me/appointments`);
      expect(staffList.status === 403 || (staffList.status === 200 && (staffList.body as unknown[]).length === 0)).toBe(true);
      const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: staffUser.id } });
      expect(after.phone).toBeNull();
      expect(after.phoneVerifiedAt).toBeNull();
      expect((await ctx.prisma.client.findFirstOrThrow({ where: { id: appt.clientId } })).userId).toBe(v.body.user.id);
    });

    it('чужой/навязанный токен в cookie при входе гасится (session fixation)', async () => {
      const sa = await superadmin();
      const admin = await loginSuperadmin(ctx, sa);
      const { ownerEmail } = await createOrgWithOwner(ctx, admin, { name: `Фиксация ${uniq()}` });
      const victim = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
      const planted = `planted-${uniq()}${uniq()}`;
      await ctx.prisma.userSession.create({
        data: { userId: victim.id, tokenHash: sha256(planted), kind: 'staff', mfaVerified: false, ip: '10.68.0.1', userAgent: 'x', expiresAt: new Date(Date.now() + 3600_000) },
      });
      const res = await request(ctx.app.getHttpServer())
        .post(`${API}/auth/staff/login`)
        .set('X-Forwarded-For', ip())
        .set('Cookie', `${SESSION_COOKIE}=${planted}; bk_csrf=csrf-d`)
        .set('X-CSRF-Token', 'csrf-d')
        .send({ email: ownerEmail, password: 'OwnerPass123!X1' });
      expect(res.status).toBe(200);
      const s = await ctx.prisma.userSession.findUniqueOrThrow({ where: { tokenHash: sha256(planted) } });
      expect(s.revokedAt).not.toBeNull();
    });
  });

  describe('журналы', () => {
    it('секретные сегменты пути и query маскируются', () => {
      expect(redactUrlPath('/api/v1/public/manage/SECRETtoken123/review?x=1')).toBe('/api/v1/public/manage/[REDACTED]/review');
      expect(redactUrlPath('/api/v1/public/waitlist-offers/abc.def/accept')).toBe('/api/v1/public/waitlist-offers/[REDACTED]/accept');
      expect(redactUrlPath('/ru/confirm/0f8fad5b-d9cb-469f-a165-70867728950e.secret')).toBe('/ru/confirm/[REDACTED]');
      expect(redactUrlPath('/api/v1/public/pages/my-salon?token=1')).toBe('/api/v1/public/pages/my-salon');
    });

    it('после GET /public/manage/<token> в выводе HTTP-журнала нет токена и секретных заголовков', async () => {
      const lines: string[] = [];
      const sink = new Writable({
        write(chunk: Buffer, _enc, cb) {
          lines.push(chunk.toString('utf8'));
          cb();
        },
      });
      const app = express();
      app.use(pinoHttp(httpLoggerOptions('info'), sink));
      app.get('/api/v1/public/manage/:token', (_req, res) => {
        res.cookie('bk_sid', 'set-cookie-secret-value');
        res.json({ ok: true });
      });
      app.get('/api/v1/public/waitlist-offers/:token', (_req, res) => res.json({ ok: true }));
      const token = `tok_${randomUUID()}_${uniq()}`;
      await request(app)
        .get(`/api/v1/public/manage/${token}?again=${token}`)
        .set('Authorization', 'Bearer auth-header-secret')
        .set('Cookie', 'bk_sid=cookie-header-secret')
        .set('X-MFA-Code', '654321')
        .expect(200);
      await request(app).get(`/api/v1/public/waitlist-offers/${token}`).expect(200);
      const out = lines.join('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(out).toContain('/api/v1/public/manage/[REDACTED]');
      for (const secret of [token, 'auth-header-secret', 'cookie-header-secret', '654321', 'set-cookie-secret-value']) expect(out).not.toContain(secret);
    });
  });

  describe('IP клиента за прокси (rate limit)', () => {
    afterEach(() => ctx.app.set('trust proxy', trustProxy(getConfig().TRUST_PROXY)));

    it('внутренние адреса распознаются, внешние — нет', () => {
      for (const a of ['127.0.0.1', '::1', '::ffff:10.1.2.3', '172.18.0.5', '192.168.1.1', 'fd00::1']) expect(isInternalAddress(a)).toBe(true);
      for (const a of ['203.0.113.7', '8.8.8.8', '2001:db8::1', 'garbage']) expect(isInternalAddress(a)).toBe(false);
    });

    // production и Codespaces: TRUST_PROXY=1 (один пишущий прокси, Next rewrite запись не добавляет); 2 — запас на лишний хоп
    it.each([1, 2])('TRUST_PROXY=%i: подставленный клиентом X-Forwarded-For не становится ключом rate limit', async (hops) => {
      ctx.app.set('trust proxy', trustProxy(hops));
      const spoofed = `203.0.113.${octet()}`;
      const real = `198.51.100.${octet()}`;
      const slug = `nope-${uniq()}`;
      // внешний прокси дописал реальный адрес клиента к присланному клиентом заголовку
      await new Http(ctx.app).get(`${API}/public/pages/${slug}`, { 'X-Forwarded-For': `${spoofed}, ${real}` });
      const keys = (await ctx.prisma.$queryRaw<Array<{ key: string }>>`
        SELECT key FROM rate_limit_buckets WHERE key LIKE 'rl:pub-page:ip:%' AND (key LIKE ${'%' + spoofed} OR key LIKE ${'%' + real})`).map((r) => r.key);
      expect(keys).toContain(`rl:pub-page:ip:${real}`);
      expect(keys).not.toContain(`rl:pub-page:ip:${spoofed}`);
    });

    it.each([1, 2])('TRUST_PROXY=%i: 21 запрос otp/request с разными поддельными XFF от одного клиента → 429', async (hops) => {
      ctx.app.set('trust proxy', trustProxy(hops));
      const real = `198.51.100.${octet()}`;
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) {
        const phone = `+7701${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
        const xff = `203.0.${octet()}.${octet()}, ${real}`;
        statuses.push((await new Http(ctx.app).post(`${API}/auth/client/otp/request`, { phone }, { 'X-Forwarded-For': xff })).status);
      }
      expect(statuses).toContain(429);
      expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(20);
    });

    // локально, CI/E2E, Codespaces: браузер → Next.js → API, Next пропускает присланный заголовок как есть (D-54)
    it('TRUST_PROXY=0: X-Forwarded-For игнорируется, ключ — адрес соединения (Next.js)', async () => {
      ctx.app.set('trust proxy', trustProxy(0));
      const spoofed = `203.0.113.${octet()}`;
      const inner = `10.68.${octet()}.${octet()}`;
      await new Http(ctx.app).get(`${API}/public/pages/nope-${uniq()}`, { 'X-Forwarded-For': `${spoofed}, ${inner}` });
      const keys = (await ctx.prisma.$queryRaw<Array<{ key: string }>>`
        SELECT key FROM rate_limit_buckets
        WHERE key LIKE ${'%' + spoofed} OR key LIKE ${'%' + inner} OR key = 'rl:pub-page:ip:127.0.0.1'`).map((r) => r.key);
      expect(keys).toEqual(['rl:pub-page:ip:127.0.0.1']);
    });
  });

  describe('переводы и страницы', () => {
    it('BRANCH_ADMIN филиала A: перевод страницы филиала B → 404, акции организации → 403; GET без чужих филиалов', async () => {
      const admin = await loginSuperadmin(ctx, await superadmin());
      const { orgId, owner } = await createOrgWithOwner(ctx, admin, { name: `Переводы ${uniq()}` });
      const a = (await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'Филиал A' })).body.id as string;
      const b = (await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'Филиал B' })).body.id as string;
      const pageA = await ctx.prisma.publicPage.findUniqueOrThrow({ where: { branchId: a } });
      const pageB = await ctx.prisma.publicPage.findUniqueOrThrow({ where: { branchId: b } });
      const promo = await ctx.prisma.promotion.create({
        data: { organizationId: orgId, kind: 'sale', name: 'Акция', discountType: 'percent', discountValue: 10 },
      });
      const email = `ba-${uniq()}@audit-d.kz`;
      const created = await owner.post(`${API}/organizations/${orgId}/users`, {
        email,
        name: 'Админ A',
        temporaryPassword: 'Password123!',
        role: 'BRANCH_ADMIN',
        branchAccess: [{ branchId: a, permissions: ['pages.edit'] }],
      });
      expect(created.status).toBe(201);
      const ba = await loginStaff(ctx, email, 'Password123!');
      const url = `${API}/organizations/${orgId}/translations`;
      const item = (entityType: string, entityId: string) => ({ items: [{ entityType, entityId, field: 'title', locale: 'en', text: 'Hello', verified: false }] });

      expect((await owner.put(url, item('page', pageB.id))).status).toBe(200);
      const foreignPage = await ba.put(url, item('page', pageB.id));
      expect(foreignPage.status).toBe(404);
      const orgLevel = await ba.put(url, { items: [{ entityType: 'promotion', entityId: promo.id, field: 'name', locale: 'en', text: 'Sale', verified: false }] });
      expect(orgLevel.status).toBe(403);
      // смешанный запрос не применяется частично
      const mixed = await ba.put(url, { items: [...item('page', pageA.id).items, ...item('page', pageB.id).items] });
      expect(mixed.status).toBe(404);
      expect(await ctx.prisma.pageTranslation.count({ where: { entityId: pageA.id, locale: 'en', field: 'title', text: 'Hello' } })).toBe(0);
      expect((await ba.put(url, item('page', pageA.id))).status).toBe(200);
      expect((await owner.put(url, { items: [{ entityType: 'promotion', entityId: promo.id, field: 'name', locale: 'en', text: 'Sale', verified: false }] })).status).toBe(200);

      const list = await ba.get(url);
      expect(list.status).toBe(200);
      const ids = (list.body as Array<{ entityId: string }>).map((r) => r.entityId);
      expect(ids).toContain(pageA.id);
      expect(ids).not.toContain(pageB.id);
      expect(ids).not.toContain(promo.id);
      const ownerIds = ((await owner.get(url)).body as Array<{ entityId: string }>).map((r) => r.entityId);
      expect(ownerIds).toEqual(expect.arrayContaining([pageA.id, pageB.id, promo.id]));
    });

    it('can-edit: суперадмин без подтверждённой MFA в сессии — false', async () => {
      const sa = await superadmin();
      const admin = await loginSuperadmin(ctx, sa);
      const { orgId, owner } = await createOrgWithOwner(ctx, admin, { name: `Редактор ${uniq()}` });
      const branch = (await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'Центр' })).body as { slug: string };
      expect((await admin.get(`${API}/public/pages/${branch.slug}/can-edit`)).body.canEdit).toBe(true);
      await ctx.prisma.userSession.updateMany({ where: { userId: sa.user.id }, data: { mfaVerified: false } });
      expect((await admin.get(`${API}/public/pages/${branch.slug}/can-edit`)).body).toEqual({ canEdit: false });
    });

    it('публичная страница не показывает изображения другой организации (urlsFor фильтрует organizationId)', async () => {
      const admin = await loginSuperadmin(ctx, await superadmin());
      const orgA = await createOrgWithOwner(ctx, admin, { name: `Медиа A ${uniq()}` });
      const orgB = await createOrgWithOwner(ctx, admin, { name: `Медиа B ${uniq()}` });
      const assetId = randomUUID();
      const prefix = `org/${orgA.orgId}/${assetId}`;
      await ctx.prisma.mediaAsset.create({
        data: {
          id: assetId,
          organizationId: orgA.orgId,
          kind: 'gallery',
          storageKey: `${prefix}/large.webp`,
          mimeType: 'image/webp',
          width: 10,
          height: 10,
          sizeBytes: 10,
          variants: { thumb: `${prefix}/thumb.webp`, medium: `${prefix}/medium.webp`, large: `${prefix}/large.webp` },
        },
      });
      const branch = (await orgB.owner.post(`${API}/organizations/${orgB.orgId}/branches`, { name: 'Галерея' })).body as { id: string; slug: string };
      await publishPageDirect(ctx, orgB.orgId, branch.id);
      // старая/подложенная публикация со ссылкой на чужой ассет
      const page = await ctx.prisma.publicPage.findUniqueOrThrow({ where: { branchId: branch.id } });
      const v1 = await ctx.prisma.pagePublication.findUniqueOrThrow({ where: { id: page.publishedPublicationId! } });
      const v2 = await ctx.prisma.pagePublication.create({
        data: {
          organizationId: orgB.orgId,
          pageId: page.id,
          version: 2,
          content: { title: { ru: 'Тест' }, galleryAssetIds: [assetId], logoAssetId: assetId, socials: [], hiddenSections: [] },
          templateId: v1.templateId,
          templateVersionId: v1.templateVersionId,
          colorScheme: v1.colorScheme,
          bookingButtonPosition: v1.bookingButtonPosition,
          primaryLocale: v1.primaryLocale,
        },
      });
      await ctx.prisma.publicPage.update({ where: { id: page.id }, data: { publishedPublicationId: v2.id } });
      const res = await new Http(ctx.app, ip()).get(`${API}/public/pages/${branch.slug}`);
      expect(res.status).toBe(200);
      expect(res.body.content.gallery).toEqual([]);
      expect(res.body.content.logo).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain(orgA.orgId);
    });

    it('не-UUID userId в маршрутах сотрудников → 400, не 500', async () => {
      const admin = await loginSuperadmin(ctx, await superadmin());
      const { orgId, owner } = await createOrgWithOwner(ctx, admin, { name: `UUID ${uniq()}` });
      expect((await owner.put(`${API}/organizations/${orgId}/users/not-a-uuid/access`, { branchAccess: [] })).status).toBe(400);
      expect((await owner.delete(`${API}/organizations/${orgId}/users/not-a-uuid`)).status).toBe(400);
    });
  });

  describe('bootstrap: Swagger и CSP', () => {
    it('строгая CSP для API, unsafe-inline только на странице документации', async () => {
      const health = await new Http(ctx.app, ip()).get(`${API}/health`);
      expect(health.headers['content-security-policy']).toContain("default-src 'none'");
      expect(health.headers['content-security-policy']).not.toContain('unsafe-inline');
      const docs = await new Http(ctx.app, ip()).get(`${API}/docs/`);
      expect(docs.status).toBe(200);
      expect(docs.headers['content-security-policy']).toContain("'unsafe-inline'");
    });

    it('APP_ENV=production: /docs и /docs-json не публикуются', async () => {
      expect(docsEnabled('production')).toBe(false);
      expect(docsEnabled('test')).toBe(true);
      const saved = { ...process.env };
      Object.assign(process.env, { APP_ENV: 'production', COOKIE_SECURE: 'true', NOTIFICATION_CHANNELS: 'whatsapp', DEV_INBOX_ENABLED: 'false' });
      resetConfigCache();
      try {
        const prod = await createApp();
        await prod.init();
        try {
          expect((await request(prod.getHttpServer()).get(`${API}/docs/`)).status).toBe(404);
          expect((await request(prod.getHttpServer()).get(`${API}/docs-json`)).status).toBe(404);
        } finally {
          await prod.close();
        }
      } finally {
        process.env = saved;
        resetConfigCache();
      }
    });
  });

  describe('ошибки тела запроса (body-parser)', () => {
    const post = (body: string | Buffer, headers: Record<string, string> = {}) => {
      const r = request(ctx.app.getHttpServer()).post(`${API}/auth/client/otp/request`).set('X-Forwarded-For', ip()).set('Content-Type', 'application/json');
      for (const [k, v] of Object.entries(headers)) r.set(k, v);
      return r.send(body);
    };

    it('JSON больше 1 МБ → 413 PAYLOAD_TOO_LARGE в формате API, не 500', async () => {
      const big = JSON.stringify({ phone: '+77010000000', pad: 'x'.repeat(1024 * 1024) });
      const res = await post(big);
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(res.body.error.message).toMatch(/Слишком большой запрос/);
      // ровно на границе лимита — обычная обработка (здесь 400 валидации: телефон в теле не тот)
      const edge = JSON.stringify({ phone: 'x', pad: '' });
      const atLimit = edge.slice(0, -2) + 'x'.repeat(1024 * 1024 - edge.length) + '"}';
      expect(Buffer.byteLength(atLimit)).toBe(1024 * 1024);
      expect((await post(atLimit)).status).toBe(400);
      const over = atLimit.slice(0, -2) + 'x"}';
      expect(Buffer.byteLength(over)).toBe(1024 * 1024 + 1);
      expect((await post(over)).status).toBe(413);
    });

    it('битый JSON → 400 VALIDATION_ERROR с русским сообщением (не текст парсера)', async () => {
      const res = await post('{"phone": "+7701');
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({ code: 'VALIDATION_ERROR', message: 'Некорректный JSON в теле запроса' });
      expect(JSON.stringify(res.body)).not.toMatch(/Unexpected|JSON input|position/);
    });

    it('неподдерживаемые кодировка сжатия и charset → 415', async () => {
      const enc = await post('{}', { 'Content-Encoding': 'x-unknown' });
      expect(enc.status).toBe(415);
      expect(enc.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      const charset = await post('{}', { 'Content-Type': 'application/json; charset=koi8-r' });
      expect(charset.status).toBe(415);
      expect(charset.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  describe('crypto, health, pg', () => {
    it('decrypt: тег GCM строго 16 байт (усечённый тег отвергается)', () => {
      const key = getConfig().ENCRYPTION_KEY;
      const enc = encrypt(key, 'секрет');
      expect(decrypt(key, enc)).toBe('секрет');
      const [v, iv, tag, ct] = enc.split('.');
      const short = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url');
      expect(() => decrypt(key, [v, iv, short, ct].join('.'))).toThrow();
    });

    it('публичный /health не считает очередь уведомлений на каждый вызов (кеш)', async () => {
      const health = new HealthController(ctx.prisma);
      const spy = jest.spyOn(ctx.prisma, '$queryRaw');
      try {
        for (let i = 0; i < 5; i++) await health.health();
        const outboxQueries = spy.mock.calls.filter((c) => String(c[0]).includes('notification_outbox'));
        expect(outboxQueries).toHaveLength(1);
        expect((await health.health()).notifications).toEqual({ pending: expect.any(Number), dead: expect.any(Number) });
      } finally {
        spy.mockRestore();
      }
    });

    it('запросы внутри транзакции не выполняются параллельно на одном соединении pg (нет DeprecationWarning)', async () => {
      let concurrent = 0;
      const original = Client.prototype.query;
      const spy = jest.spyOn(Client.prototype, 'query').mockImplementation(function (this: Client, ...args: unknown[]) {
        if ((this as unknown as { _activeQuery?: unknown })._activeQuery) concurrent += 1;
        return (original as (...a: unknown[]) => unknown).apply(this, args) as ReturnType<Client['query']>;
      });
      try {
        await ctx.prisma.$transaction(async (tx) => {
          await Promise.all([tx.plan.findMany(), tx.businessCategory.findMany(), tx.role.findMany()]);
          // include нескольких связей: движок Prisma загружает их параллельно
          await tx.user.findMany({ take: 3, include: { sessions: true, orgRoles: true, branchAccess: true } });
        });
      } finally {
        spy.mockRestore();
      }
      expect(concurrent).toBe(0);
    });
  });
});
