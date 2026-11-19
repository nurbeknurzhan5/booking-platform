import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ServiceCategoryInputSchema, ServiceInputSchema, UpdateServiceSchema } from '@booking/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { allowedBranches } from '../common/tenant-access';
import type { ActorContext, TenantContext } from '../common/request-context';

type ServiceInput = z.infer<typeof ServiceInputSchema>;
type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>;

const SERVICE_INCLUDE = {
  category: { select: { id: true, name: true } },
  branchServices: { select: { branchId: true, priceOverride: true, isActive: true } },
  requirements: { select: { resourceType: true, quantity: true } },
  photo: { select: { id: true, variants: true } },
} as const;

/**
 * Каталог услуг организации (§5). Администратор с правом services.manage может работать только
 * с услугами, доступными исключительно в его филиалах.
 */
@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Владелец видит весь каталог; администратор — услуги своих филиалов. */
  async list(t: TenantContext, branchId?: string) {
    const adminBranches = t.grant.role === 'OWNER' ? null : Object.keys(t.grant.branchPermissions);
    if (branchId && adminBranches && !adminBranches.includes(branchId)) throw AppError.notFound('Филиал');
    const branchCond = branchId ? [branchId] : adminBranches;
    return this.prisma.service.findMany({
      where: {
        organizationId: t.organizationId,
        archivedAt: null,
        ...(branchCond ? { branchServices: { some: { branchId: { in: branchCond } } } } : {}),
      },
      include: SERVICE_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async get(t: TenantContext, id: string) {
    const s = await this.prisma.service.findFirst({ where: { id, organizationId: t.organizationId, archivedAt: null }, include: SERVICE_INCLUDE });
    if (!s) throw AppError.notFound('Услуга');
    if (t.grant.role !== 'OWNER') {
      const mine = Object.keys(t.grant.branchPermissions);
      if (!s.branchServices.some((b) => mine.includes(b.branchId))) throw AppError.notFound('Услуга');
    }
    return s;
  }

  private assertBranchesAllowed(t: TenantContext, branchIds: string[]) {
    const allowed = allowedBranches(t, 'services.manage');
    if (allowed === null) return;
    if (branchIds.length === 0) throw AppError.forbidden('Укажите хотя бы один свой филиал');
    if (branchIds.some((b) => !allowed.includes(b))) throw AppError.forbidden('Нет прав на один из филиалов');
  }

  private async assertRefs(tx: Tx, t: TenantContext, input: { categoryId?: string | null; photoAssetId?: string | null; branches?: { branchId: string }[] }) {
    if (input.categoryId) {
      const c = await tx.serviceCategory.findFirst({ where: { id: input.categoryId, organizationId: t.organizationId, archivedAt: null } });
      if (!c) throw AppError.notFound('Категория');
    }
    if (input.photoAssetId) {
      const a = await tx.mediaAsset.findFirst({ where: { id: input.photoAssetId, organizationId: t.organizationId, archivedAt: null } });
      if (!a) throw AppError.notFound('Изображение');
    }
    if (input.branches?.length) {
      const ids = [...new Set(input.branches.map((b) => b.branchId))];
      const n = await tx.branch.count({ where: { id: { in: ids }, organizationId: t.organizationId, archivedAt: null } });
      if (n !== ids.length) throw AppError.notFound('Филиал');
    }
  }

  async create(t: TenantContext, input: ServiceInput, actor: ActorContext) {
    this.assertBranchesAllowed(t, input.branches.map((b) => b.branchId));
    return this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, t, input);
      const s = await tx.service.create({
        data: {
          organizationId: t.organizationId,
          categoryId: input.categoryId ?? null,
          name: input.name,
          description: input.description,
          photoAssetId: input.photoAssetId ?? null,
          price: input.price,
          durationMinutes: input.durationMinutes,
          bufferBeforeMinutes: input.bufferBeforeMinutes,
          bufferAfterMinutes: input.bufferAfterMinutes,
          requiresSpecialist: input.requiresSpecialist,
          isActive: input.isActive,
          onlineBookingEnabled: input.onlineBookingEnabled,
          sortOrder: input.sortOrder,
        },
      });
      await this.replaceBranches(tx, t.organizationId, s.id, input.branches);
      await this.replaceRequirements(tx, t.organizationId, s.id, input.resourceRequirements);
      await this.audit.log(actor, 'service.created', 'service', s.id, { after: input }, tx);
      return tx.service.findUniqueOrThrow({ where: { id: s.id }, include: SERVICE_INCLUDE });
    });
  }

  async update(t: TenantContext, id: string, input: UpdateServiceInput, actor: ActorContext) {
    const before = await this.get(t, id);
    this.assertBranchesAllowed(t, before.branchServices.map((b) => b.branchId));
    if (input.branches) this.assertBranchesAllowed(t, input.branches.map((b) => b.branchId));
    return this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, t, input);
      await tx.service.update({
        where: { id },
        data: {
          categoryId: input.categoryId,
          name: input.name,
          description: input.description,
          photoAssetId: input.photoAssetId,
          price: input.price,
          durationMinutes: input.durationMinutes,
          bufferBeforeMinutes: input.bufferBeforeMinutes,
          bufferAfterMinutes: input.bufferAfterMinutes,
          requiresSpecialist: input.requiresSpecialist,
          isActive: input.isActive,
          onlineBookingEnabled: input.onlineBookingEnabled,
          sortOrder: input.sortOrder,
        },
      });
      if (input.branches) await this.replaceBranches(tx, t.organizationId, id, input.branches);
      if (input.resourceRequirements) await this.replaceRequirements(tx, t.organizationId, id, input.resourceRequirements);
      const after = await tx.service.findUniqueOrThrow({ where: { id }, include: SERVICE_INCLUDE });
      await this.audit.log(actor, 'service.updated', 'service', id, { before, after }, tx);
      return after;
    });
  }

  async archive(t: TenantContext, id: string, actor: ActorContext) {
    const before = await this.get(t, id);
    this.assertBranchesAllowed(t, before.branchServices.map((b) => b.branchId));
    await this.prisma.service.update({ where: { id }, data: { archivedAt: new Date(), isActive: false } });
    await this.audit.log(actor, 'service.archived', 'service', id, { before });
  }

  private async replaceBranches(tx: Tx, organizationId: string, serviceId: string, branches: { branchId: string; priceOverride?: number | null }[]) {
    await tx.branchService.deleteMany({ where: { serviceId } });
    if (branches.length) {
      await tx.branchService.createMany({
        data: branches.map((b) => ({ organizationId, serviceId, branchId: b.branchId, priceOverride: b.priceOverride ?? null })),
      });
    }
  }

  private async replaceRequirements(
    tx: Tx,
    organizationId: string,
    serviceId: string,
    reqs: { resourceType: Exclude<import('@booking/shared').ResourceType, 'specialist'>; quantity: number }[],
  ) {
    await tx.serviceResource.deleteMany({ where: { serviceId } });
    if (reqs.length) {
      const seen = new Set<string>();
      for (const r of reqs) {
        if (seen.has(r.resourceType)) throw AppError.badRequest('VALIDATION_ERROR', 'Тип ресурса указан дважды');
        seen.add(r.resourceType);
      }
      await tx.serviceResource.createMany({ data: reqs.map((r) => ({ organizationId, serviceId, resourceType: r.resourceType, quantity: r.quantity })) });
    }
  }

  // ---------- категории ----------
  listCategories(t: TenantContext) {
    return this.prisma.serviceCategory.findMany({ where: { organizationId: t.organizationId, archivedAt: null }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async createCategory(t: TenantContext, input: z.infer<typeof ServiceCategoryInputSchema>, actor: ActorContext) {
    const c = await this.prisma.serviceCategory.create({ data: { organizationId: t.organizationId, ...input } });
    await this.audit.log(actor, 'service_category.created', 'service_category', c.id, { after: c });
    return c;
  }

  async updateCategory(t: TenantContext, id: string, input: z.infer<typeof ServiceCategoryInputSchema>, actor: ActorContext) {
    const r = await this.prisma.serviceCategory.updateMany({ where: { id, organizationId: t.organizationId, archivedAt: null }, data: input });
    if (r.count === 0) throw AppError.notFound('Категория');
    await this.audit.log(actor, 'service_category.updated', 'service_category', id, { after: input });
    return this.prisma.serviceCategory.findUniqueOrThrow({ where: { id } });
  }

  async archiveCategory(t: TenantContext, id: string, actor: ActorContext) {
    const r = await this.prisma.serviceCategory.updateMany({ where: { id, organizationId: t.organizationId, archivedAt: null }, data: { archivedAt: new Date() } });
    if (r.count === 0) throw AppError.notFound('Категория');
    await this.prisma.service.updateMany({ where: { categoryId: id, organizationId: t.organizationId }, data: { categoryId: null } });
    await this.audit.log(actor, 'service_category.archived', 'service_category', id);
  }
}
