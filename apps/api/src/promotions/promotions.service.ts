import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PromotionInputSchema } from '@booking/shared';
import { PrismaService } from '../common/prisma.service';
import { AppError, isUniqueViolation } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { TranslationService } from '../pages/translation.service';
import type { ActorContext, TenantContext } from '../common/request-context';

type PromotionInput = z.infer<typeof PromotionInputSchema>;

/** Промокоды и временные акции (§12). Применение и лимиты проверяются при бронировании на сервере. */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly translations: TranslationService,
  ) {}

  private async assertRefs(t: TenantContext, input: Partial<PromotionInput>) {
    if (input.branchIds?.length) {
      const n = await this.prisma.branch.count({ where: { id: { in: input.branchIds }, organizationId: t.organizationId, archivedAt: null } });
      if (n !== new Set(input.branchIds).size) throw AppError.notFound('Филиал');
    }
    if (input.serviceIds?.length) {
      const n = await this.prisma.service.count({ where: { id: { in: input.serviceIds }, organizationId: t.organizationId, archivedAt: null } });
      if (n !== new Set(input.serviceIds).size) throw AppError.notFound('Услуга');
    }
  }

  private data(input: PromotionInput) {
    return {
      kind: input.kind,
      name: input.name,
      code: input.kind === 'promo_code' ? (input.code ?? null) : null,
      description: input.description,
      discountType: input.discountType,
      discountValue: input.discountValue,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      allBranches: !input.branchIds,
      branchIds: input.branchIds ?? [],
      allServices: !input.serviceIds,
      serviceIds: input.serviceIds ?? [],
      minAmount: input.minAmount ?? null,
      usageLimit: input.usageLimit ?? null,
      perClientLimit: input.perClientLimit ?? null,
      isActive: input.isActive,
      showOnPage: input.showOnPage,
    };
  }

  async list(t: TenantContext) {
    const rows = await this.prisma.promotion.findMany({ where: { organizationId: t.organizationId, archivedAt: null }, orderBy: { createdAt: 'desc' } });
    const counts = await this.prisma.promotionRedemption.groupBy({
      by: ['promotionId'],
      where: { organizationId: t.organizationId, status: { in: ['reserved', 'applied'] } },
      _count: { _all: true },
    });
    const used = new Map(counts.map((c) => [c.promotionId, c._count._all]));
    return rows.map((r) => ({ ...r, usedCount: used.get(r.id) ?? 0 }));
  }

  async create(t: TenantContext, input: PromotionInput, actor: ActorContext) {
    await this.assertRefs(t, input);
    try {
      const p = await this.prisma.promotion.create({ data: { organizationId: t.organizationId, ...this.data(input) } });
      await this.translations.syncEntity(this.prisma, t.organizationId, 'promotion', p.id, { name: p.name, description: p.description });
      await this.audit.log(actor, 'promotion.created', 'promotion', p.id, { after: p });
      return p;
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.conflict('Промокод с таким кодом уже существует');
      throw e;
    }
  }

  async update(t: TenantContext, id: string, input: PromotionInput, actor: ActorContext) {
    const before = await this.prisma.promotion.findFirst({ where: { id, organizationId: t.organizationId, archivedAt: null } });
    if (!before) throw AppError.notFound('Акция');
    await this.assertRefs(t, input);
    try {
      const after = await this.prisma.promotion.update({ where: { id }, data: this.data(input) });
      await this.translations.syncEntity(this.prisma, t.organizationId, 'promotion', id, { name: after.name, description: after.description });
      await this.audit.log(actor, 'promotion.updated', 'promotion', id, { before, after });
      return after;
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.conflict('Промокод с таким кодом уже существует');
      throw e;
    }
  }

  async archive(t: TenantContext, id: string, actor: ActorContext) {
    const r = await this.prisma.promotion.updateMany({ where: { id, organizationId: t.organizationId, archivedAt: null }, data: { archivedAt: new Date(), isActive: false } });
    if (r.count === 0) throw AppError.notFound('Акция');
    await this.audit.log(actor, 'promotion.archived', 'promotion', id);
  }

  /** Акции для публичной страницы филиала. */
  async publicForBranch(organizationId: string, branchId: string) {
    const now = new Date();
    const rows = await this.prisma.promotion.findMany({
      where: {
        organizationId,
        showOnPage: true,
        isActive: true,
        archivedAt: null,
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows
      .filter((p) => p.allBranches || p.branchIds.includes(branchId))
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        name: p.name,
        description: p.description,
        code: p.kind === 'promo_code' ? p.code : null,
        discountType: p.discountType,
        discountValue: p.discountValue,
        endsAt: p.endsAt,
      }));
  }
}
