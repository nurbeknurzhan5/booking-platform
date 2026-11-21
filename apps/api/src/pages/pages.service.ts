import type { PageSection } from '@booking/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  detectSocialPlatform,
  hasPermission,
  LOCALES,
  PageContentSchema,
  SavePageDraftSchema,
  type Locale,
  type PageContent,
  type PageStatus,
  type TemplateConfig,
} from '@booking/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { BookingService } from '../booking/booking.service';
import { ReviewsService } from '../reviews/reviews.service';
import { PromotionsService } from '../promotions/promotions.service';
import { MediaService } from '../files/media.service';
import { TranslationService } from './translation.service';
import { minutesToTime } from '../catalog/schedules.service';
import type { ActorContext, AuthUser, TenantContext } from '../common/request-context';
import type { Prisma } from '../generated/prisma/client';

type SaveDraft = z.infer<typeof SavePageDraftSchema>;
const TEXT_FIELDS = ['title', 'tagline', 'about', 'closedMessage'] as const;

interface RenderSource {
  content: PageContent;
  templateId: string;
  templateVersionId: string;
  colorScheme: string;
  bookingButtonPosition: string;
  primaryLocale: Locale;
  /** Снимок переводов страницы: field → locale → { text, status }. */
  pageTranslations: Record<string, Record<string, { text: string; status: string }>>;
  version: number | null;
}

/** Публичные страницы филиалов (§13): черновик → предпросмотр → публикация, история версий, шаблоны, переводы. */
/** Раздел «залы и оборудование» появился позже шаблонов: если в шаблоне его нет — после специалистов (или услуг). */
function withResourcesSection(order: PageSection[]): PageSection[] {
  if (order.includes('resources')) return order;
  const at = order.indexOf('specialists') >= 0 ? order.indexOf('specialists') : order.indexOf('services');
  return at < 0 ? [...order, 'resources'] : [...order.slice(0, at + 1), 'resources', ...order.slice(at + 1)];
}

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly booking: BookingService,
    private readonly reviews: ReviewsService,
    private readonly promotions: PromotionsService,
    private readonly media: MediaService,
    private readonly translations: TranslationService,
  ) {}

  // ---------------------------------------------------------------- редактор

  private async page(t: TenantContext, branchId: string) {
    const page = await this.prisma.publicPage.findFirst({ where: { branchId, organizationId: t.organizationId } });
    if (!page) throw AppError.notFound('Страница');
    return page;
  }

  private async defaultTemplate() {
    const tpl = await this.prisma.pageTemplate.findFirst({ where: { status: 'published', currentVersionId: { not: null } }, orderBy: { sortOrder: 'asc' }, include: { currentVersion: true } });
    if (!tpl?.currentVersion) throw AppError.unprocessable('VALIDATION_ERROR', 'Нет опубликованных шаблонов');
    return tpl;
  }

  /** Черновик создаётся при первом открытии редактора с данными филиала. */
  private async ensureDraft(t: TenantContext, branchId: string) {
    const page = await this.page(t, branchId);
    const existing = await this.prisma.pageDraft.findUnique({ where: { pageId: page.id } });
    if (existing) return { page, draft: existing };
    const [tpl, branch, org] = await Promise.all([
      this.defaultTemplate(),
      this.prisma.branch.findUniqueOrThrow({ where: { id: branchId } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: t.organizationId } }),
    ]);
    const cfg = tpl.currentVersion!.config as TemplateConfig;
    const locale = (org.defaultLocale as Locale) ?? 'ru';
    const content: PageContent = {
      title: { [locale]: branch.name },
      about: branch.description ? { [locale]: branch.description } : undefined,
      galleryAssetIds: [],
      socials: [],
      hiddenSections: [],
    };
    const draft = await this.prisma.pageDraft.create({
      data: {
        organizationId: t.organizationId,
        pageId: page.id,
        content: content as Prisma.InputJsonValue,
        templateId: tpl.id,
        templateVersionId: tpl.currentVersionId!,
        colorScheme: cfg.colorSchemes[0]!.key,
        bookingButtonPosition: cfg.bookingButtonPositions[0]!,
        primaryLocale: locale,
      },
    });
    await this.prisma.publicPage.update({ where: { id: page.id }, data: { primaryLocale: locale } });
    return { page, draft };
  }

  async editor(t: TenantContext, branchId: string) {
    const { page, draft } = await this.ensureDraft(t, branchId);
    const [publications, translations, usedTemplates] = await Promise.all([
      this.prisma.pagePublication.findMany({
        where: { pageId: page.id },
        orderBy: { version: 'desc' },
        take: 50,
        select: { id: true, version: true, templateId: true, colorScheme: true, publishedByUserId: true, createdAt: true },
      }),
      this.translations.list(t.organizationId, { entityType: 'page', entityIds: [page.id] }),
      this.prisma.pageHistory.findMany({ where: { pageId: page.id, templateId: { not: null } }, distinct: ['templateId'], select: { templateId: true } }),
    ]);
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: branchId }, select: { slug: true, name: true } });
    return {
      page: {
        id: page.id,
        slug: branch.slug,
        status: page.status,
        moderationBlocked: page.moderationBlocked,
        moderationReason: page.moderationReason,
        publishedPublicationId: page.publishedPublicationId,
      },
      draft: {
        content: draft.content,
        templateId: draft.templateId,
        colorScheme: draft.colorScheme,
        bookingButtonPosition: draft.bookingButtonPosition,
        primaryLocale: draft.primaryLocale,
        hasUnpublishedChanges: draft.hasChanges,
        updatedAt: draft.updatedAt,
      },
      publications,
      translations,
      previouslyUsedTemplateIds: [...new Set([...usedTemplates.map((u) => u.templateId!), ...publications.map((p) => p.templateId)])],
    };
  }

  private async validateDraft(t: TenantContext, input: SaveDraft, currentTemplateId: string | null) {
    const tpl = await this.prisma.pageTemplate.findUnique({ where: { id: input.templateId }, include: { currentVersion: true } });
    // Отключённый шаблон можно сохранить, только если он уже используется этой страницей.
    if (!tpl?.currentVersion || (tpl.status !== 'published' && tpl.id !== currentTemplateId)) throw AppError.badRequest('VALIDATION_ERROR', 'Шаблон недоступен');
    const cfg = tpl.currentVersion.config as TemplateConfig;
    if (!cfg.colorSchemes.some((c) => c.key === input.colorScheme)) {
      throw AppError.badRequest('VALIDATION_ERROR', 'Цветовая схема не предусмотрена шаблоном (произвольные цвета запрещены)');
    }
    if (!(cfg.bookingButtonPositions as string[]).includes(input.bookingButtonPosition)) {
      throw AppError.badRequest('VALIDATION_ERROR', 'Расположение кнопки записи не предусмотрено шаблоном');
    }
    for (const s of input.content.socials) {
      if (!detectSocialPlatform(s.url) && !s.label) throw AppError.badRequest('VALIDATION_ERROR', `Для ссылки ${s.url} укажите название`);
    }
    const assetIds = [input.content.logoAssetId, input.content.coverAssetId, ...input.content.galleryAssetIds].filter((x): x is string => !!x);
    if (assetIds.length) {
      const n = await this.prisma.mediaAsset.count({ where: { id: { in: assetIds }, organizationId: t.organizationId, archivedAt: null } });
      if (n !== new Set(assetIds).size) throw AppError.notFound('Изображение');
    }
    return tpl;
  }

  /** Исходные тексты хранятся только на основном языке; переводы — в page_translations. */
  private normalizeContent(content: PageContent, primary: Locale): PageContent {
    const out: PageContent = { ...content };
    for (const f of TEXT_FIELDS) {
      const v = content[f];
      out[f] = v?.[primary] !== undefined ? { [primary]: v[primary] } : undefined;
    }
    return out;
  }

  async saveDraft(t: TenantContext, branchId: string, input: SaveDraft, actor: ActorContext) {
    const { page, draft } = await this.ensureDraft(t, branchId);
    const tpl = await this.validateDraft(t, input, draft.templateId);
    const content = this.normalizeContent(PageContentSchema.parse(input.content), input.primaryLocale);
    await this.prisma.$transaction(async (tx) => {
      await tx.pageDraft.update({
        where: { id: draft.id },
        data: {
          content: content as Prisma.InputJsonValue,
          templateId: tpl.id,
          templateVersionId: tpl.currentVersionId!,
          colorScheme: input.colorScheme,
          bookingButtonPosition: input.bookingButtonPosition,
          primaryLocale: input.primaryLocale,
          hasChanges: true,
          updatedByUserId: actor.userId,
        },
      });
      await tx.publicPage.update({ where: { id: page.id }, data: { primaryLocale: input.primaryLocale } });
      // Новое содержимое попадает в очередь перевода (§13.5).
      await this.translations.sync(
        tx,
        t.organizationId,
        'page',
        page.id,
        input.primaryLocale,
        Object.fromEntries(TEXT_FIELDS.map((f) => [f, content[f]?.[input.primaryLocale] ?? null])),
      );
      await tx.pageHistory.create({
        data: { organizationId: t.organizationId, pageId: page.id, action: 'draft_saved', templateId: tpl.id, actorUserId: actor.userId },
      });
      if (tpl.id !== draft.templateId) {
        await tx.pageHistory.create({
          data: { organizationId: t.organizationId, pageId: page.id, action: 'template_changed', templateId: tpl.id, actorUserId: actor.userId, details: { from: draft.templateId, to: tpl.id } },
        });
      }
    });
    return this.editor(t, branchId);
  }

  private async pageTranslationSnapshot(db: Tx | PrismaService, organizationId: string, pageId: string) {
    const rows = await db.pageTranslation.findMany({ where: { organizationId, entityType: 'page', entityId: pageId, text: { not: null } } });
    const snap: Record<string, Record<string, { text: string; status: string }>> = {};
    for (const r of rows) (snap[r.field] ??= {})[r.locale] = { text: r.text!, status: r.status };
    return snap;
  }

  /** Публикация: черновик → неизменяемый снимок. До публикации посетители видят предыдущую версию. */
  async publish(t: TenantContext, branchId: string, actor: ActorContext) {
    const { page, draft } = await this.ensureDraft(t, branchId);
    if (page.moderationBlocked) throw AppError.forbidden('Страница заблокирована модератором: ' + (page.moderationReason ?? ''));
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM public_pages WHERE id = ${page.id}::uuid FOR UPDATE`;
      const last = await tx.pagePublication.findFirst({ where: { pageId: page.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const pub = await tx.pagePublication.create({
        data: {
          organizationId: t.organizationId,
          pageId: page.id,
          version: (last?.version ?? 0) + 1,
          content: draft.content as Prisma.InputJsonValue,
          translations: (await this.pageTranslationSnapshot(tx, t.organizationId, page.id)) as Prisma.InputJsonValue,
          templateId: draft.templateId,
          templateVersionId: draft.templateVersionId,
          colorScheme: draft.colorScheme,
          bookingButtonPosition: draft.bookingButtonPosition,
          primaryLocale: draft.primaryLocale,
          publishedByUserId: actor.userId,
        },
      });
      await tx.publicPage.update({ where: { id: page.id }, data: { publishedPublicationId: pub.id } });
      await tx.pageDraft.update({ where: { id: draft.id }, data: { hasChanges: false } });
      await tx.pageHistory.create({
        data: { organizationId: t.organizationId, pageId: page.id, action: 'published', publicationId: pub.id, templateId: draft.templateId, actorUserId: actor.userId },
      });
      await this.audit.log(actor, 'page.published', 'public_page', page.id, { after: { version: pub.version } }, tx);
      return { publicationId: pub.id, version: pub.version };
    });
  }

  /** Восстановление версии — копия снимка в черновик (публикация — отдельным действием). */
  async restore(t: TenantContext, branchId: string, publicationId: string, actor: ActorContext) {
    const { page, draft } = await this.ensureDraft(t, branchId);
    const pub = await this.prisma.pagePublication.findFirst({ where: { id: publicationId, pageId: page.id } });
    if (!pub) throw AppError.notFound('Версия');
    await this.prisma.$transaction([
      this.prisma.pageDraft.update({
        where: { id: draft.id },
        data: {
          content: pub.content as Prisma.InputJsonValue,
          templateId: pub.templateId,
          templateVersionId: pub.templateVersionId,
          colorScheme: pub.colorScheme,
          bookingButtonPosition: pub.bookingButtonPosition,
          primaryLocale: pub.primaryLocale,
          hasChanges: true,
          updatedByUserId: actor.userId,
        },
      }),
      this.prisma.pageHistory.create({
        data: { organizationId: t.organizationId, pageId: page.id, action: 'restored', publicationId: pub.id, templateId: pub.templateId, actorUserId: actor.userId, details: { version: pub.version } },
      }),
    ]);
    return this.editor(t, branchId);
  }

  async setStatus(t: TenantContext, branchId: string, status: PageStatus, actor: ActorContext) {
    const page = await this.page(t, branchId);
    await this.prisma.$transaction([
      this.prisma.publicPage.update({ where: { id: page.id }, data: { status } }),
      this.prisma.pageHistory.create({
        data: { organizationId: t.organizationId, pageId: page.id, action: 'status_changed', actorUserId: actor.userId, details: { from: page.status, to: status } },
      }),
    ]);
    await this.audit.log(actor, 'page.status_changed', 'public_page', page.id, { before: { status: page.status }, after: { status } });
    return { status };
  }

  history(t: TenantContext, branchId: string) {
    return this.page(t, branchId).then((p) =>
      this.prisma.pageHistory.findMany({ where: { pageId: p.id }, orderBy: { createdAt: 'desc' }, take: 200 }),
    );
  }

  /** Модерация суперадмином (§13.8). */
  async moderate(pageId: string, blocked: boolean, reason: string, actor: ActorContext) {
    const page = await this.prisma.publicPage.findUnique({ where: { id: pageId } });
    if (!page) throw AppError.notFound('Страница');
    await this.prisma.$transaction([
      this.prisma.publicPage.update({
        where: { id: pageId },
        data: { moderationBlocked: blocked, moderationReason: reason, moderatedAt: new Date(), moderatedByUserId: actor.userId },
      }),
      this.prisma.pageHistory.create({
        data: { organizationId: page.organizationId, pageId, action: 'moderated', actorUserId: actor.userId, details: { blocked, reason } },
      }),
    ]);
    await this.audit.log(actor, blocked ? 'page.moderation_blocked' : 'page.moderation_unblocked', 'public_page', pageId, {
      after: { reason },
      organizationId: page.organizationId,
    });
    return { blocked, reason };
  }

  // ---------------------------------------------------------------- рендер

  /** Публичная страница по постоянной ссылке (§13). */
  async publicPage(slug: string, locale: Locale) {
    const { branch, availability } = await this.booking.publicBranch(slug);
    if (!availability.visible) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Страница недоступна', { reason: availability.reason });
    }
    const pub = await this.prisma.pagePublication.findUniqueOrThrow({ where: { id: branch.page!.publishedPublicationId! } });
    return this.render(branch.id, {
      content: pub.content as PageContent,
      templateId: pub.templateId,
      templateVersionId: pub.templateVersionId,
      colorScheme: pub.colorScheme,
      bookingButtonPosition: pub.bookingButtonPosition,
      primaryLocale: pub.primaryLocale as Locale,
      pageTranslations: pub.translations as RenderSource['pageTranslations'],
      version: pub.version,
    }, locale, availability);
  }

  /** Предпросмотр черновика (для редакторов; внутренние просмотры не учитываются в аналитике). */
  async preview(t: TenantContext, branchId: string, locale: Locale, templateOverride?: { templateId: string; colorScheme?: string }) {
    const { page, draft } = await this.ensureDraft(t, branchId);
    let templateId = draft.templateId;
    let templateVersionId = draft.templateVersionId;
    let colorScheme = draft.colorScheme;
    if (templateOverride) {
      const tpl = await this.prisma.pageTemplate.findFirst({ where: { id: templateOverride.templateId, status: 'published' }, include: { currentVersion: true } });
      if (!tpl?.currentVersion) throw AppError.notFound('Шаблон');
      const cfg = tpl.currentVersion.config as TemplateConfig;
      templateId = tpl.id;
      templateVersionId = tpl.currentVersionId!;
      colorScheme = cfg.colorSchemes.find((c) => c.key === templateOverride.colorScheme)?.key ?? cfg.colorSchemes[0]!.key;
    }
    const { availability } = await this.booking.publicBranch((await this.prisma.branch.findUniqueOrThrow({ where: { id: branchId } })).slug);
    return {
      preview: true,
      ...(await this.render(branchId, {
        content: draft.content as PageContent,
        templateId,
        templateVersionId,
        colorScheme,
        bookingButtonPosition: draft.bookingButtonPosition,
        primaryLocale: draft.primaryLocale as Locale,
        pageTranslations: await this.pageTranslationSnapshot(this.prisma, t.organizationId, page.id),
        version: null,
      }, locale, availability)),
    };
  }

  private async render(
    branchId: string,
    src: RenderSource,
    locale: Locale,
    availability: Awaited<ReturnType<BookingService['publicBranch']>>['availability'],
  ) {
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: branchId }, include: { organization: true, bookingSettings: true } });
    const tplVersion = await this.prisma.pageTemplateVersion.findUniqueOrThrow({ where: { id: src.templateVersionId }, include: { template: true } });
    const config = tplVersion.config as TemplateConfig;
    const scheme = config.colorSchemes.find((c) => c.key === src.colorScheme) ?? config.colorSchemes[0]!;
    const lang: Locale = (LOCALES as readonly string[]).includes(locale) ? locale : src.primaryLocale;
    let autoTranslated = false;
    let missingTranslation = false;

    const pageText = (field: (typeof TEXT_FIELDS)[number]): string | null => {
      const source = src.content[field]?.[src.primaryLocale] ?? null;
      if (!source) return null;
      if (lang === src.primaryLocale) return source;
      const tr = src.pageTranslations[field]?.[lang];
      if (tr?.text) {
        if (tr.status === 'auto_translated') autoTranslated = true;
        return tr.text;
      }
      missingTranslation = true;
      return source;
    };

    const [services, specialists, schedule, reviews, promotions, publicResources] = await Promise.all([
      this.prisma.service.findMany({
        where: { organizationId: branch.organizationId, archivedAt: null, isActive: true, branchServices: { some: { branchId, isActive: true } } },
        include: { category: true, branchServices: { where: { branchId } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.specialist.findMany({
        where: { branchId, archivedAt: null, isActive: true, isPublic: true },
        include: { services: { select: { serviceId: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.workingHours.findMany({ where: { branchId, resourceId: null }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }),
      this.reviews.publicSummary(branchId),
      this.promotions.publicForBranch(branch.organizationId, branchId),
      // Места, залы и оборудование, отмеченные для показа (задача 22)
      this.prisma.resource.findMany({
        where: { branchId, archivedAt: null, isActive: true, isPublic: true, type: { not: 'specialist' } },
        include: { services: { select: { serviceId: true } } },
        orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);

    const trMap = await this.translations.mapFor(branch.organizationId, lang, [
      { type: 'service', ids: services.map((s) => s.id) },
      { type: 'specialist', ids: specialists.map((s) => s.id) },
      { type: 'service_category', ids: [...new Set(services.map((s) => s.categoryId).filter((x): x is string => !!x))] },
      { type: 'promotion', ids: promotions.map((p) => p.id) },
    ]);
    const tr = (type: string, id: string, field: string, source: string | null) => {
      if (!source || lang === src.primaryLocale) return source;
      const hit = trMap.get(`${type}:${id}:${field}`);
      if (hit) {
        if (hit.status === 'auto_translated') autoTranslated = true;
        return hit.text;
      }
      missingTranslation = true;
      return source;
    };

    const assetIds = [
      src.content.logoAssetId,
      src.content.coverAssetId,
      ...src.content.galleryAssetIds,
      ...services.map((s) => s.photoAssetId),
      ...specialists.map((s) => s.photoAssetId),
      ...publicResources.map((r) => r.photoAssetId),
    ].filter((x): x is string => !!x);
    const urls = await this.media.urlsFor([...new Set(assetIds)]);
    const img = (id: string | null | undefined) => (id ? (urls.get(id) ?? null) : null);

    // Сначала вычисляем все переводимые тексты — они выставляют флаги autoTranslated / missingTranslation.
    const content = {
      title: pageText('title') ?? branch.name,
      tagline: pageText('tagline'),
      about: pageText('about'),
      closedMessage: pageText('closedMessage'),
      logo: img(src.content.logoAssetId),
      cover: img(src.content.coverAssetId),
      gallery: src.content.galleryAssetIds.map((id) => img(id)).filter(Boolean),
      socials: src.content.socials.map((s) => {
        const d = detectSocialPlatform(s.url);
        return { url: s.url, platform: d?.platform ?? 'link', label: s.label ?? d?.label ?? s.url };
      }),
    };
    const servicesView = services.map((s) => ({
      id: s.id,
      name: tr('service', s.id, 'name', s.name),
      description: tr('service', s.id, 'description', s.description),
      category: s.category ? { id: s.category.id, name: tr('service_category', s.category.id, 'name', s.category.name) } : null,
      price: s.branchServices[0]?.priceOverride ?? s.price,
      durationMinutes: s.durationMinutes,
      onlineBooking: s.onlineBookingEnabled,
      photo: img(s.photoAssetId),
    }));
    const specialistsView = specialists.map((s) => ({
      id: s.id,
      name: s.name,
      specialization: tr('specialist', s.id, 'specialization', s.specialization),
      description: tr('specialist', s.id, 'description', s.description),
      photo: img(s.photoAssetId),
      serviceIds: s.services.map((x) => x.serviceId),
    }));
    const resourcesView = publicResources.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      description: r.description,
      photo: img(r.photoAssetId),
      serviceIds: r.services.map((x) => x.serviceId).filter((id) => services.some((s) => s.id === id)),
    }));
    const promotionsView = promotions.map((p) => ({ ...p, name: tr('promotion', p.id, 'name', p.name), description: tr('promotion', p.id, 'description', p.description) }));

    return {
      slug: branch.slug,
      version: src.version,
      locale: lang,
      primaryLocale: src.primaryLocale,
      availableLocales: LOCALES,
      autoTranslated,
      missingTranslation,
      availability: {
        mode: availability.mode,
        bookingEnabled: availability.bookingEnabled && (branch.bookingSettings?.onlineBookingEnabled ?? true),
        waitlistEnabled: availability.bookingEnabled && (branch.bookingSettings?.onlineBookingEnabled ?? true) && (branch.bookingSettings?.waitlistEnabled ?? false),
        reason: availability.reason,
      },
      template: {
        key: tplVersion.template.key,
        layout: config.layout,
        style: config.style ?? null,
        sectionOrder: withResourcesSection(config.sectionOrder).filter((s) => !src.content.hiddenSections.includes(s)),
        colors: scheme,
        bookingButtonPosition: src.bookingButtonPosition,
      },
      branch: {
        id: branch.id,
        name: branch.name,
        organizationName: branch.organization.name,
        address: branch.address,
        phone: branch.phone,
        timezone: branch.timezone,
        map: branch.mapEnabled
          ? {
              latitude: branch.latitude,
              longitude: branch.longitude,
              url:
                branch.mapUrl ??
                (branch.latitude !== null && branch.longitude !== null
                  ? `https://2gis.kz/geo/${branch.longitude},${branch.latitude}`
                  : branch.address
                    ? `https://2gis.kz/search/${encodeURIComponent(branch.address)}`
                    : null),
            }
          : null,
      },
      content,
      schedule: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        intervals: schedule.filter((h) => h.weekday === weekday).map((h) => ({ start: minutesToTime(h.startMinute), end: minutesToTime(h.endMinute) })),
      })),
      services: servicesView,
      specialists: specialistsView,
      resources: resourcesView,
      reviews,
      promotions: promotionsView,
    };
  }

  /** Кнопка «Редактировать страницу» на публичной странице (§13.2). */
  async canEdit(slug: string, user: AuthUser | undefined) {
    if (!user || user.sessionKind !== 'staff') return { canEdit: false };
    const branch = await this.prisma.branch.findFirst({ where: { slug, archivedAt: null }, select: { id: true, organizationId: true } });
    if (!branch) return { canEdit: false };
    if (user.isSuperadmin) return { canEdit: true, organizationId: branch.organizationId, branchId: branch.id };
    const m = await this.prisma.userOrganizationRole.findFirst({ where: { userId: user.id, organizationId: branch.organizationId, revokedAt: null } });
    if (!m) return { canEdit: false };
    let ok = m.roleCode === 'OWNER';
    if (!ok) {
      const access = await this.prisma.userBranchAccess.findFirst({ where: { userId: user.id, branchId: branch.id }, include: { permissions: true } });
      ok = !!access && hasPermission({ role: 'BRANCH_ADMIN', branchPermissions: { [branch.id]: access.permissions.map((p) => p.permissionCode) } }, 'pages.edit', branch.id);
    }
    return ok ? { canEdit: true, organizationId: branch.organizationId, branchId: branch.id } : { canEdit: false };
  }
}
