import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ResourceInputSchema, SpecialistInputSchema, UpdateResourceSchema, UpdateSpecialistSchema } from '@booking/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { TranslationService } from '../pages/translation.service';
import { StorageService } from '../files/storage.service';
import type { ActorContext, TenantContext } from '../common/request-context';

type SpecialistInput = z.infer<typeof SpecialistInputSchema>;
type ResourceInput = z.infer<typeof ResourceInputSchema>;

const SPECIALIST_INCLUDE = {
  services: { select: { serviceId: true, priceOverride: true } },
  photo: { select: { id: true, variants: true } },
} as const;

/**
 * Универсальная модель ресурсов (§6): специалист — ресурс типа specialist с профилем.
 * Специалист в каждом филиале — отдельная карточка (§4).
 */
@Injectable()
export class ResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly translations: TranslationService,
    private readonly storage: StorageService,
  ) {}

  /** Ссылка на миниатюру фото для кабинета (в БД хранятся ключи хранилища, а не URL). */
  private withPhotoUrl<T extends { photo: { id: string; variants: unknown } | null }>(s: T) {
    const v = (s.photo?.variants ?? null) as Record<string, string> | null;
    const key = v?.thumb ?? v?.medium ?? null;
    return { ...s, photoUrl: key ? this.storage.publicUrl(key) : null };
  }

  /** Услуги должны принадлежать организации и быть доступны в филиале. */
  private async assertServicesInBranch(tx: Tx, organizationId: string, branchId: string, serviceIds: string[]) {
    const ids = [...new Set(serviceIds)];
    if (ids.length !== serviceIds.length) throw AppError.badRequest('VALIDATION_ERROR', 'Услуга указана дважды');
    if (!ids.length) return;
    const n = await tx.branchService.count({ where: { organizationId, branchId, serviceId: { in: ids }, service: { archivedAt: null } } });
    if (n !== ids.length) throw AppError.badRequest('VALIDATION_ERROR', 'Одна из услуг не найдена или не подключена к филиалу');
  }

  private async assertPhoto(tx: Tx, organizationId: string, assetId?: string | null) {
    if (!assetId) return;
    const a = await tx.mediaAsset.findFirst({ where: { id: assetId, organizationId, archivedAt: null } });
    if (!a) throw AppError.notFound('Изображение');
  }

  private async assertNoFutureBookings(resourceId: string) {
    const n = await this.prisma.appointmentResource.count({ where: { resourceId, isActive: true, endAt: { gt: new Date() } } });
    if (n > 0) throw AppError.conflict(`У ресурса есть будущие записи (${n}). Перенесите или отмените их.`);
  }

  // ---------- специалисты ----------
  async listSpecialists(t: TenantContext, branchId: string) {
    const rows = await this.prisma.specialist.findMany({
      where: { organizationId: t.organizationId, branchId, archivedAt: null },
      include: SPECIALIST_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.withPhotoUrl(r));
  }

  async getSpecialist(t: TenantContext, branchId: string, id: string) {
    const s = await this.prisma.specialist.findFirst({ where: { id, organizationId: t.organizationId, branchId, archivedAt: null }, include: SPECIALIST_INCLUDE });
    if (!s) throw AppError.notFound('Специалист');
    return this.withPhotoUrl(s);
  }

  async createSpecialist(t: TenantContext, branchId: string, input: SpecialistInput, actor: ActorContext) {
    const organizationId = t.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.assertServicesInBranch(tx, organizationId, branchId, input.services.map((s) => s.serviceId));
      await this.assertPhoto(tx, organizationId, input.photoAssetId);
      const resource = await tx.resource.create({
        data: { organizationId, branchId, type: 'specialist', name: input.name, isActive: input.isActive, sortOrder: input.sortOrder },
      });
      const sp = await tx.specialist.create({
        data: {
          organizationId,
          branchId,
          resourceId: resource.id,
          name: input.name,
          specialization: input.specialization,
          description: input.description,
          photoAssetId: input.photoAssetId ?? null,
          isActive: input.isActive,
          isPublic: input.isPublic,
          sortOrder: input.sortOrder,
        },
      });
      if (input.services.length) {
        await tx.specialistService.createMany({
          data: input.services.map((s) => ({ organizationId, specialistId: sp.id, serviceId: s.serviceId, priceOverride: s.priceOverride ?? null })),
        });
      }
      await this.translations.syncEntity(tx, organizationId, 'specialist', sp.id, { specialization: input.specialization, description: input.description });
      await this.audit.log(actor, 'specialist.created', 'specialist', sp.id, { after: input }, tx);
      return tx.specialist.findUniqueOrThrow({ where: { id: sp.id }, include: SPECIALIST_INCLUDE });
    });
  }

  async updateSpecialist(t: TenantContext, branchId: string, id: string, input: z.infer<typeof UpdateSpecialistSchema>, actor: ActorContext) {
    const before = await this.getSpecialist(t, branchId, id);
    const organizationId = t.organizationId;
    return this.prisma.$transaction(async (tx) => {
      if (input.services) await this.assertServicesInBranch(tx, organizationId, branchId, input.services.map((s) => s.serviceId));
      await this.assertPhoto(tx, organizationId, input.photoAssetId);
      await tx.specialist.update({
        where: { id },
        data: {
          name: input.name,
          specialization: input.specialization,
          description: input.description,
          photoAssetId: input.photoAssetId,
          isActive: input.isActive,
          isPublic: input.isPublic,
          sortOrder: input.sortOrder,
        },
      });
      await tx.resource.update({
        where: { id: before.resourceId },
        data: { name: input.name, isActive: input.isActive, sortOrder: input.sortOrder },
      });
      if (input.services) {
        await tx.specialistService.deleteMany({ where: { specialistId: id } });
        if (input.services.length) {
          await tx.specialistService.createMany({
            data: input.services.map((s) => ({ organizationId, specialistId: id, serviceId: s.serviceId, priceOverride: s.priceOverride ?? null })),
          });
        }
      }
      const after = await tx.specialist.findUniqueOrThrow({ where: { id }, include: SPECIALIST_INCLUDE });
      await this.translations.syncEntity(tx, organizationId, 'specialist', id, { specialization: after.specialization, description: after.description });
      await this.audit.log(actor, 'specialist.updated', 'specialist', id, { before, after }, tx);
      return after;
    });
  }

  async archiveSpecialist(t: TenantContext, branchId: string, id: string, actor: ActorContext) {
    const sp = await this.getSpecialist(t, branchId, id);
    await this.assertNoFutureBookings(sp.resourceId);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.specialist.update({ where: { id }, data: { archivedAt: now, isActive: false } }),
      this.prisma.resource.update({ where: { id: sp.resourceId }, data: { archivedAt: now, isActive: false } }),
    ]);
    await this.audit.log(actor, 'specialist.archived', 'specialist', id, { before: sp });
  }

  // ---------- ресурсы (кабинеты, залы, оборудование, автомобили, посты) ----------
  listResources(t: TenantContext, branchId: string) {
    return this.prisma.resource.findMany({
      where: { organizationId: t.organizationId, branchId, archivedAt: null, type: { not: 'specialist' } },
      include: { services: { select: { serviceId: true } } },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async getResource(t: TenantContext, branchId: string, id: string) {
    const r = await this.prisma.resource.findFirst({
      where: { id, organizationId: t.organizationId, branchId, archivedAt: null, type: { not: 'specialist' } },
      include: { services: { select: { serviceId: true } } },
    });
    if (!r) throw AppError.notFound('Ресурс');
    return r;
  }

  async createResource(t: TenantContext, branchId: string, input: ResourceInput, actor: ActorContext) {
    const organizationId = t.organizationId;
    return this.prisma.$transaction(async (tx) => {
      await this.assertServicesInBranch(tx, organizationId, branchId, input.serviceIds);
      const r = await tx.resource.create({
        data: { organizationId, branchId, type: input.type, name: input.name, description: input.description, isActive: input.isActive, sortOrder: input.sortOrder },
      });
      if (input.serviceIds.length) {
        await tx.resourceService.createMany({ data: input.serviceIds.map((serviceId) => ({ organizationId, resourceId: r.id, serviceId })) });
      }
      await this.audit.log(actor, 'resource.created', 'resource', r.id, { after: input }, tx);
      return tx.resource.findUniqueOrThrow({ where: { id: r.id }, include: { services: { select: { serviceId: true } } } });
    });
  }

  async updateResource(t: TenantContext, branchId: string, id: string, input: z.infer<typeof UpdateResourceSchema>, actor: ActorContext) {
    const before = await this.getResource(t, branchId, id);
    const organizationId = t.organizationId;
    return this.prisma.$transaction(async (tx) => {
      if (input.serviceIds) await this.assertServicesInBranch(tx, organizationId, branchId, input.serviceIds);
      await tx.resource.update({
        where: { id },
        data: { name: input.name, description: input.description, isActive: input.isActive, sortOrder: input.sortOrder },
      });
      if (input.serviceIds) {
        await tx.resourceService.deleteMany({ where: { resourceId: id } });
        if (input.serviceIds.length) {
          await tx.resourceService.createMany({ data: input.serviceIds.map((serviceId) => ({ organizationId, resourceId: id, serviceId })) });
        }
      }
      const after = await tx.resource.findUniqueOrThrow({ where: { id }, include: { services: { select: { serviceId: true } } } });
      await this.audit.log(actor, 'resource.updated', 'resource', id, { before, after }, tx);
      return after;
    });
  }

  async archiveResource(t: TenantContext, branchId: string, id: string, actor: ActorContext) {
    const r = await this.getResource(t, branchId, id);
    await this.assertNoFutureBookings(id);
    await this.prisma.resource.update({ where: { id }, data: { archivedAt: new Date(), isActive: false } });
    await this.audit.log(actor, 'resource.archived', 'resource', id, { before: r });
  }
}
