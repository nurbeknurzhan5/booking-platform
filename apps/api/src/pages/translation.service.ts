import { Injectable, Logger } from '@nestjs/common';
import { LOCALES, type Locale, type TranslationStatus } from '@booking/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { JobsService } from '../common/jobs.service';
import { sha256 } from '../common/crypto';
import { getConfig } from '../config/config';
import { AppError } from '../common/errors';

export type EntityType = 'page' | 'service' | 'specialist' | 'service_category' | 'promotion';

/** Адаптер Google Cloud Translation v2 (поддерживает казахский). Ключ предоставляет заказчик (R-03). */
@Injectable()
export class GoogleTranslateProvider {
  isConfigured(): boolean {
    return !!getConfig().GOOGLE_TRANSLATE_API_KEY;
  }

  async translate(texts: string[], source: Locale, target: Locale): Promise<string[]> {
    const c = getConfig();
    const res = await fetch(`${c.GOOGLE_TRANSLATE_BASE_URL}/language/translate/v2?key=${encodeURIComponent(c.GOOGLE_TRANSLATE_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, source, target, format: 'text' }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { translations?: Array<{ translatedText: string }> }; error?: { message?: string } };
    if (!res.ok || !body.data?.translations) throw new Error(`Translate API ${res.status}: ${body.error?.message ?? 'error'}`);
    return body.data.translations.map((t) => t.translatedText);
  }
}

/**
 * Переводы контента (§13.5). Для каждого поля и языка хранится текст, источник (auto/manual)
 * и статус: missing / auto_translated / verified / manually_edited. Ручной перевод не перезаписывается автоматически.
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly provider: GoogleTranslateProvider,
  ) {}

  /**
   * Синхронизация исходного текста: создаёт записи для недостающих языков и ставит их в очередь перевода;
   * при изменении исходника автопереводы обновляются, ручные помечаются устаревшими.
   */
  async sync(tx: Tx, organizationId: string, entityType: EntityType, entityId: string, sourceLocale: Locale, fields: Record<string, string | null | undefined>) {
    for (const [field, text] of Object.entries(fields)) {
      const hash = text ? sha256(text) : null;
      for (const locale of LOCALES) {
        if (locale === sourceLocale) continue;
        const key = { organizationId_entityType_entityId_field_locale: { organizationId, entityType, entityId, field, locale } };
        const existing = await tx.pageTranslation.findUnique({ where: key });
        if (!text) {
          if (existing && existing.status === 'auto_translated') await tx.pageTranslation.delete({ where: { id: existing.id } });
          continue;
        }
        if (!existing) {
          const row = await tx.pageTranslation.create({
            data: { organizationId, entityType, entityId, field, locale, status: 'missing', sourceLocale, sourceHash: hash },
          });
          if (this.provider.isConfigured()) await this.jobs.enqueue('translate', { id: row.id }, { dedupeKey: `translate:${row.id}:${hash}` }, tx);
          continue;
        }
        if (existing.sourceHash === hash && existing.sourceLocale === sourceLocale) continue;
        if (existing.status === 'missing' || existing.status === 'auto_translated') {
          await tx.pageTranslation.update({ where: { id: existing.id }, data: { sourceHash: hash, sourceLocale, isOutdated: existing.status === 'auto_translated' } });
          if (this.provider.isConfigured()) await this.jobs.enqueue('translate', { id: existing.id }, { dedupeKey: `translate:${existing.id}:${hash}` }, tx);
        } else {
          // verified / manually_edited — текст не трогаем, отмечаем, что исходник изменился.
          await tx.pageTranslation.update({ where: { id: existing.id }, data: { isOutdated: true } });
        }
      }
    }
  }

  list(organizationId: string, filter: { entityType?: EntityType; entityIds?: string[]; locale?: Locale }) {
    return this.prisma.pageTranslation.findMany({
      where: {
        organizationId,
        ...(filter.entityType ? { entityType: filter.entityType } : {}),
        ...(filter.entityIds ? { entityId: { in: filter.entityIds } } : {}),
        ...(filter.locale ? { locale: filter.locale } : {}),
      },
      orderBy: [{ entityType: 'asc' }, { field: 'asc' }, { locale: 'asc' }],
    });
  }

  /** Ручное редактирование перевода владельцем. */
  async upsertManual(
    organizationId: string,
    items: Array<{ entityType: EntityType; entityId: string; field: string; locale: Locale; text: string; verified: boolean }>,
    userId: string | null,
  ) {
    for (const it of items) {
      await this.assertEntity(organizationId, it.entityType, it.entityId);
      const key = { organizationId_entityType_entityId_field_locale: { organizationId, entityType: it.entityType, entityId: it.entityId, field: it.field, locale: it.locale } };
      const existing = await this.prisma.pageTranslation.findUnique({ where: key });
      const status: TranslationStatus =
        it.verified && existing?.status === 'auto_translated' && existing.text === it.text ? 'verified' : 'manually_edited';
      await this.prisma.pageTranslation.upsert({
        where: key,
        create: { organizationId, entityType: it.entityType, entityId: it.entityId, field: it.field, locale: it.locale, text: it.text, status, source: 'manual', sourceLocale: 'ru', updatedByUserId: userId },
        update: { text: it.text, status, source: status === 'verified' ? 'auto' : 'manual', isOutdated: false, updatedByUserId: userId },
      });
    }
  }

  private async assertEntity(organizationId: string, entityType: EntityType, entityId: string) {
    const where = { id: entityId, organizationId };
    const found =
      entityType === 'page'
        ? await this.prisma.publicPage.findFirst({ where })
        : entityType === 'service'
          ? await this.prisma.service.findFirst({ where })
          : entityType === 'specialist'
            ? await this.prisma.specialist.findFirst({ where })
            : entityType === 'service_category'
              ? await this.prisma.serviceCategory.findFirst({ where })
              : await this.prisma.promotion.findFirst({ where });
    if (!found) throw AppError.notFound('Объект перевода');
  }

  /** Поставить в очередь автоперевод языка. Ручные переводы перезаписываются только с явного согласия. */
  async requestAuto(organizationId: string, locale: Locale, opts: { overwriteAuto: boolean; overwriteManual: boolean }) {
    if (!this.provider.isConfigured()) {
      throw AppError.unprocessable('VALIDATION_ERROR', 'Автоперевод не подключён: требуется ключ Google Cloud Translation (см. настройки интеграций)');
    }
    const statuses: TranslationStatus[] = ['missing'];
    if (opts.overwriteAuto) statuses.push('auto_translated');
    if (opts.overwriteManual) statuses.push('manually_edited', 'verified');
    const rows = await this.prisma.pageTranslation.findMany({ where: { organizationId, locale, OR: [{ status: { in: statuses } }, { status: 'auto_translated', isOutdated: true }] } });
    for (const r of rows) {
      await this.jobs.enqueue('translate', { id: r.id, force: opts.overwriteManual }, { dedupeKey: `translate:${r.id}:${r.sourceHash}:${Date.now()}` });
    }
    return { queued: rows.length };
  }

  /** Исходный текст поля сущности. */
  private async sourceText(entityType: string, entityId: string, field: string, sourceLocale: string): Promise<string | null> {
    if (entityType === 'page') {
      const d = await this.prisma.pageDraft.findUnique({ where: { pageId: entityId } });
      const v = (d?.content as Record<string, unknown> | undefined)?.[field] as Record<string, string> | undefined;
      return v?.[sourceLocale] ?? null;
    }
    const pick = (o: Record<string, unknown> | null) => (o && typeof o[field] === 'string' ? (o[field] as string) : null);
    if (entityType === 'service') return pick(await this.prisma.service.findUnique({ where: { id: entityId } }));
    if (entityType === 'specialist') return pick(await this.prisma.specialist.findUnique({ where: { id: entityId } }));
    if (entityType === 'service_category') return pick(await this.prisma.serviceCategory.findUnique({ where: { id: entityId } }));
    if (entityType === 'promotion') return pick(await this.prisma.promotion.findUnique({ where: { id: entityId } }));
    return null;
  }

  /** Воркер: обработка очереди автоперевода. */
  async processQueue(limit = 20): Promise<number> {
    if (!this.provider.isConfigured()) return 0;
    const jobs = await this.jobs.claim('translate', limit);
    for (const job of jobs) {
      const { id, force } = job.payload as { id: string; force?: boolean };
      try {
        const row = await this.prisma.pageTranslation.findUnique({ where: { id } });
        if (!row || ((row.status === 'manually_edited' || row.status === 'verified') && !force)) {
          await this.jobs.complete(job.id);
          continue;
        }
        const source = await this.sourceText(row.entityType, row.entityId, row.field, row.sourceLocale);
        if (!source) {
          await this.jobs.complete(job.id);
          continue;
        }
        const [translated] = await this.provider.translate([source], row.sourceLocale as Locale, row.locale as Locale);
        // Условное обновление: ручной перевод, сделанный во время запроса, не перезаписывается.
        await this.prisma.pageTranslation.updateMany({
          where: { id, ...(force ? {} : { status: { in: ['missing', 'auto_translated'] } }) },
          data: { text: translated, status: 'auto_translated', source: 'auto', sourceHash: sha256(source), isOutdated: false },
        });
        await this.jobs.complete(job.id);
      } catch (e) {
        this.logger.warn({ jobId: job.id, err: (e as Error).message }, 'Translation failed');
        await this.jobs.fail(job, (e as Error).message);
      }
    }
    return jobs.length;
  }

  /** Карта переводов для публичной страницы: `${entityType}:${entityId}:${field}` → { text, status }. */
  async mapFor(organizationId: string, locale: Locale, entities: Array<{ type: EntityType; ids: string[] }>) {
    const rows = await this.prisma.pageTranslation.findMany({
      where: { organizationId, locale, text: { not: null }, OR: entities.filter((e) => e.ids.length).map((e) => ({ entityType: e.type, entityId: { in: e.ids } })) },
    });
    return new Map(rows.map((r) => [`${r.entityType}:${r.entityId}:${r.field}`, { text: r.text!, status: r.status }]));
  }
}
