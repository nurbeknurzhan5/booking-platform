import sharp from 'sharp';
import { API, bootstrapTestApp, createOrgWithOwner, createSuperadmin, Http, loginStaff, loginSuperadmin, resetDb, type TestContext } from './helpers';

describe('Этап 5: публичные страницы, шаблоны, переводы, файлы', () => {
  let ctx: TestContext;
  let admin: Http;
  let owner: Http;
  let orgId: string;
  let branchId: string;
  let slug: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx);
    admin = await loginSuperadmin(ctx, await createSuperadmin(ctx));
    ({ orgId, owner } = await createOrgWithOwner(ctx, admin, { name: 'Барбер Про' }));
    const b = await owner.post(`${API}/organizations/${orgId}/branches`, { name: 'Барбер Про Абай', address: 'Алматы, Абая 10', latitude: 43.24, longitude: 76.91 });
    branchId = b.body.id;
    slug = b.body.slug;
  });

  const base = () => `${API}/organizations/${orgId}/branches/${branchId}/page`;
  const templates = async () => (await owner.get(`${API}/templates`)).body as Array<{ id: string; key: string; config: { colorSchemes: Array<{ key: string }>; bookingButtonPositions: string[] } }>;
  const draftBody = async (overrides: Record<string, unknown> = {}, templateKey = 'classic') => {
    const tpl = (await templates()).find((t) => t.key === templateKey)!;
    return {
      templateId: tpl.id,
      colorScheme: tpl.config.colorSchemes[0]!.key,
      bookingButtonPosition: tpl.config.bookingButtonPositions[0],
      primaryLocale: 'ru',
      content: { title: { ru: 'Барбершоп «Про»' }, about: { ru: 'Лучшие стрижки' }, socials: [{ url: 'https://instagram.com/barber' }], galleryAssetIds: [], hiddenSections: [], ...overrides },
    };
  };

  it('черновик не публикуется автоматически; публикация делает страницу доступной по постоянной ссылке', async () => {
    const editor = await owner.get(base());
    expect(editor.status).toBe(200);
    expect(editor.body.draft.content.title.ru).toBe('Барбер Про Абай');
    expect((await new Http(ctx.app).get(`${API}/public/pages/${slug}`)).status).toBe(404);

    expect((await owner.put(`${base()}/draft`, await draftBody())).status).toBe(200);
    expect((await new Http(ctx.app).get(`${API}/public/pages/${slug}`)).status).toBe(404); // критерий 14

    const pub = await owner.post(`${base()}/publish`);
    expect(pub.body.version).toBe(1);
    const page = await new Http(ctx.app).get(`${API}/public/pages/${slug}`);
    expect(page.status).toBe(200);
    expect(page.body.content.title).toBe('Барбершоп «Про»');
    expect(page.body.content.socials[0]).toMatchObject({ platform: 'instagram', label: 'Instagram' });
    expect(page.body.branch.map.url).toContain('2gis.kz');
    expect(page.body.availability).toMatchObject({ mode: 'open', bookingEnabled: true });

    // изменения черновика не видны до публикации
    await owner.put(`${base()}/draft`, await draftBody({ title: { ru: 'Новое название' } }));
    expect((await new Http(ctx.app).get(`${API}/public/pages/${slug}`)).body.content.title).toBe('Барбершоп «Про»');
    const preview = await owner.get(`${base()}/preview`);
    expect(preview.body.preview).toBe(true);
    expect(preview.body.content.title).toBe('Новое название');
  });

  it('смена шаблона не теряет контент, ссылка не меняется (критерий 13); цвета только из шаблона', async () => {
    await owner.put(`${base()}/draft`, await draftBody());
    await owner.post(`${base()}/publish`);
    const modern = await draftBody({}, 'modern');
    expect((await owner.put(`${base()}/draft`, modern)).status).toBe(200);
    await owner.post(`${base()}/publish`);
    const page = await new Http(ctx.app).get(`${API}/public/pages/${slug}`);
    expect(page.body.template.key).toBe('modern');
    expect(page.body.content.title).toBe('Барбершоп «Про»');
    expect(page.body.content.about).toBe('Лучшие стрижки');
    expect(page.body.slug).toBe(slug);

    const badColor = await owner.put(`${base()}/draft`, { ...modern, colorScheme: 'ff00ff' });
    expect(badColor.status).toBe(400);
    const badButton = await owner.put(`${base()}/draft`, { ...(await draftBody({}, 'minimal')), bookingButtonPosition: 'floating' });
    expect(badButton.status).toBe(400);
    const editor = await owner.get(base());
    expect(editor.body.previouslyUsedTemplateIds.length).toBeGreaterThanOrEqual(2);
  });

  it('история версий и восстановление предыдущей версии в черновик', async () => {
    await owner.put(`${base()}/draft`, await draftBody({ title: { ru: 'Версия 1' } }));
    await owner.post(`${base()}/publish`);
    await owner.put(`${base()}/draft`, await draftBody({ title: { ru: 'Версия 2' } }));
    await owner.post(`${base()}/publish`);
    const editor = await owner.get(base());
    expect(editor.body.publications.map((p: { version: number }) => p.version)).toEqual([2, 1]);
    const v1 = editor.body.publications.find((p: { version: number }) => p.version === 1);
    const restored = await owner.post(`${base()}/versions/${v1.id}/restore`);
    expect(restored.body.draft.content.title.ru).toBe('Версия 1');
    expect((await new Http(ctx.app).get(`${API}/public/pages/${slug}`)).body.content.title).toBe('Версия 2');
    await owner.post(`${base()}/publish`);
    expect((await new Http(ctx.app).get(`${API}/public/pages/${slug}`)).body.content.title).toBe('Версия 1');
    // опубликованные версии неизменяемы
    await expect(ctx.prisma.pagePublication.updateMany({ where: { id: v1.id }, data: { colorScheme: 'x' } })).rejects.toThrow();
  });

  it('статусы страницы и модерация', async () => {
    await owner.put(`${base()}/draft`, await draftBody({ closedMessage: { ru: 'Ремонт до понедельника' } }));
    await owner.post(`${base()}/publish`);
    await owner.put(`${base()}/status`, { status: 'temporarily_closed' });
    const closed = await new Http(ctx.app).get(`${API}/public/pages/${slug}`);
    expect(closed.status).toBe(200);
    expect(closed.body.availability).toMatchObject({ mode: 'closed_notice', bookingEnabled: false, reason: 'page_temporarily_closed' });
    expect(closed.body.content.closedMessage).toBe('Ремонт до понедельника');
    await owner.put(`${base()}/status`, { status: 'disabled' });
    expect((await new Http(ctx.app).get(`${API}/public/pages/${slug}`)).status).toBe(404);
    await owner.put(`${base()}/status`, { status: 'active' });

    const page = await ctx.prisma.publicPage.findUniqueOrThrow({ where: { branchId } });
    const mod = await admin.post(`${API}/admin/pages/${page.id}/moderation`, { blocked: true, reason: 'Недопустимый контент' });
    expect(mod.status).toBe(200);
    const blocked = await new Http(ctx.app).get(`${API}/public/pages/${slug}`);
    expect(blocked.status).toBe(404);
    expect(blocked.body.error.details.reason).toBe('moderation_blocked');
    expect((await owner.post(`${base()}/publish`)).status).toBe(403);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'page.moderation_blocked' } })).toBe(1);
  });

  it('права: администратор без pages.edit не редактирует; кнопка «Редактировать» только для уполномоченных', async () => {
    await owner.post(`${API}/organizations/${orgId}/users`, {
      email: 'adm@pages.kz',
      name: 'Adm',
      temporaryPassword: 'Password123!',
      role: 'BRANCH_ADMIN',
      branchAccess: [{ branchId, permissions: ['appointments.view'] }],
    });
    const adm = await loginStaff(ctx, 'adm@pages.kz', 'Password123!');
    expect((await adm.get(base())).status).toBe(403);
    expect((await adm.get(`${API}/public/pages/${slug}/can-edit`)).body.canEdit).toBe(false);
    expect((await owner.get(`${API}/public/pages/${slug}/can-edit`)).body).toMatchObject({ canEdit: true, branchId });
    expect((await new Http(ctx.app).get(`${API}/public/pages/${slug}/can-edit`)).body.canEdit).toBe(false);
  });

  it('мультиязычность: очередь переводов, ручной перевод, уведомление об автопереводе, fallback', async () => {
    await owner.put(`${base()}/draft`, await draftBody());
    const page = await ctx.prisma.publicPage.findUniqueOrThrow({ where: { branchId } });
    const missing = await ctx.prisma.pageTranslation.findMany({ where: { entityId: page.id } });
    expect(missing.map((m) => `${m.field}:${m.locale}:${m.status}`).sort()).toEqual(['about:en:missing', 'about:kk:missing', 'title:en:missing', 'title:kk:missing']);

    const manual = await owner.put(`${API}/organizations/${orgId}/translations`, {
      items: [{ entityType: 'page', entityId: page.id, field: 'title', locale: 'kk', text: '«Про» барбершопы' }],
    });
    expect(manual.status).toBe(200);
    // имитация автоперевода другого поля
    await ctx.prisma.pageTranslation.updateMany({ where: { entityId: page.id, field: 'about', locale: 'kk' }, data: { text: 'Үздік шаш қию', status: 'auto_translated', source: 'auto' } });
    await owner.post(`${base()}/publish`);

    const kk = await new Http(ctx.app).get(`${API}/public/pages/${slug}?locale=kk`);
    expect(kk.body.content.title).toBe('«Про» барбершопы');
    expect(kk.body.content.about).toBe('Үздік шаш қию');
    expect(kk.body.autoTranslated).toBe(true);
    const en = await new Http(ctx.app).get(`${API}/public/pages/${slug}?locale=en`);
    expect(en.body.content.title).toBe('Барбершоп «Про»');
    expect(en.body.missingTranslation).toBe(true);

    // изменение исходного текста: ручной перевод не перезаписывается, помечается устаревшим
    await owner.put(`${base()}/draft`, await draftBody({ title: { ru: 'Барбершоп «Про» Абай' } }));
    const tr = await ctx.prisma.pageTranslation.findFirstOrThrow({ where: { entityId: page.id, field: 'title', locale: 'kk' } });
    expect(tr).toMatchObject({ text: '«Про» барбершопы', status: 'manually_edited', isOutdated: true });

    const auto = await owner.post(`${API}/organizations/${orgId}/translations/auto`, { locale: 'en' });
    expect(auto.status).toBe(422); // ключ переводчика не настроен — честный отказ
  });

  it('соцсеть без распознанной платформы требует название', async () => {
    const r = await owner.put(`${base()}/draft`, await draftBody({ socials: [{ url: 'https://example.kz/promo' }] }));
    expect(r.status).toBe(400);
    const ok = await owner.put(`${base()}/draft`, await draftBody({ socials: [{ url: 'https://example.kz/promo', label: 'Наш сайт' }] }));
    expect(ok.status).toBe(200);
    const bad = await owner.put(`${base()}/draft`, await draftBody({ socials: [{ url: 'javascript:alert(1)', label: 'x' }] }));
    expect(bad.status).toBe(400);
  });

  describe('файлы (§24, §26.5)', () => {
    const upload = (http: Http, buffer: Buffer, filename: string, contentType: string, kind = 'logo') =>
      http
        .raw()
        .post(`${API}/organizations/${orgId}/files`)
        .set('X-CSRF-Token', http.csrf)
        .set('X-Forwarded-For', http.ip)
        .field('kind', kind)
        .attach('file', buffer, { filename, contentType });

    it('изображение перекодируется в WebP с миниатюрами и раздаётся', async () => {
      const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#cc3366' } }).png().toBuffer();
      const r = await upload(owner, png, 'logo.png', 'image/png');
      expect(r.status).toBe(201);
      expect(Object.keys(r.body.urls).sort()).toEqual(['large', 'medium', 'thumb']);
      const thumbPath = (r.body.urls.thumb as string).replace(/^\/api\/v1/, '');
      const file = await new Http(ctx.app).get(`${API}${thumbPath}`);
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toBe('image/webp');
      const meta = await sharp(file.body as Buffer).metadata();
      expect(meta.width).toBe(320);

      // использование ассета на странице
      const d = await owner.put(`${base()}/draft`, await draftBody({ logoAssetId: r.body.id }));
      expect(d.status).toBe(200);
    });

    it('запрещённые файлы отклоняются: подмена типа, SVG, слишком большой файл', async () => {
      const fake = await upload(owner, Buffer.from('<?php echo 1; ?>'.padEnd(200, ' ')), 'x.png', 'image/png');
      expect(fake.status).toBe(400);
      expect(fake.body.error.code).toBe('FILE_INVALID');
      const svg = await upload(owner, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'x.svg', 'image/svg+xml');
      expect(svg.status).toBe(400);
      const big = await upload(owner, Buffer.alloc(6 * 1024 * 1024, 1), 'big.jpg', 'image/jpeg');
      expect(big.status).toBe(413);
      const html = await upload(owner, Buffer.from('<html><script>alert(1)</script></html>'), 'a.jpg', 'image/jpeg');
      expect(html.status).toBe(400);
    });

    it('ассет другой организации нельзя использовать', async () => {
      const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer();
      const r = await upload(owner, png, 'a.png', 'image/png');
      const other = await createOrgWithOwner(ctx, admin, { name: 'Чужая' });
      const ob = await other.owner.post(`${API}/organizations/${other.orgId}/branches`, { name: 'Чужой филиал' });
      const tpl = (await templates()).find((t) => t.key === 'classic')!;
      const res = await other.owner.put(`${API}/organizations/${other.orgId}/branches/${ob.body.id}/page/draft`, {
        templateId: tpl.id,
        colorScheme: tpl.config.colorSchemes[0]!.key,
        bookingButtonPosition: tpl.config.bookingButtonPositions[0],
        primaryLocale: 'ru',
        content: { logoAssetId: r.body.id, galleryAssetIds: [], socials: [], hiddenSections: [] },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('шаблоны (суперадмин)', () => {
    it('создание, новая версия при изменении конфигурации, отключение убирает из каталога', async () => {
      const cfg = (await templates()).find((t) => t.key === 'classic')!.config;
      const created = await admin.post(`${API}/admin/templates`, { key: 'spa', name: 'SPA', config: cfg });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('draft');
      expect((await templates()).some((t) => t.key === 'spa')).toBe(false);
      await admin.post(`${API}/admin/templates/${created.body.id}/status`, { status: 'published' });
      expect((await templates()).some((t) => t.key === 'spa')).toBe(true);
      const upd = await admin.patch(`${API}/admin/templates/${created.body.id}`, { config: { ...cfg, sectionOrder: ['hero', 'services'] } });
      expect(upd.body.version).toBe(2);
      await admin.post(`${API}/admin/templates/${created.body.id}/status`, { status: 'disabled' });
      expect((await templates()).some((t) => t.key === 'spa')).toBe(false);
      expect((await owner.post(`${API}/admin/templates`, { key: 'x', name: 'x', config: cfg })).status).toBe(404);
    });
  });
});
