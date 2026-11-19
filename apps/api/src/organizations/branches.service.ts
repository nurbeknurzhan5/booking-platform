import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BranchInputSchema, UpdateBranchSchema, BookingSettingsSchema, slugify } from '@booking/shared';
import { PrismaService } from '../common/prisma.service';
import { AppError, isUniqueViolation } from '../common/errors';
import { AuditService } from '../common/audit.service';
import type { ActorContext } from '../common/request-context';

type BranchInput = z.infer<typeof BranchInputSchema>;
type UpdateBranchInput = z.infer<typeof UpdateBranchSchema>;

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string, branchIds: string[] | null) {
    return this.prisma.branch.findMany({
      where: { organizationId, archivedAt: null, ...(branchIds ? { id: { in: branchIds } } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { page: { select: { id: true, status: true, publishedPublicationId: true } } },
    });
  }

  async get(organizationId: string, branchId: string) {
    const b = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId, archivedAt: null },
      include: { bookingSettings: true, page: { select: { id: true, status: true, publishedPublicationId: true } } },
    });
    if (!b) throw AppError.notFound('Филиал');
    return b;
  }

  /**
   * Создание филиала с проверкой лимита тарифа (§2.2, §4). Строка организации блокируется,
   * чтобы параллельные запросы не обошли лимит.
   */
  async create(organizationId: string, input: BranchInput, actor: ActorContext) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
        const sub = await tx.subscription.findUnique({ where: { organizationId } });
        const count = await tx.branch.count({ where: { organizationId, archivedAt: null } });
        const limit = sub?.maxBranches ?? 0;
        if (count >= limit) {
          throw new AppError('BRANCH_LIMIT_REACHED', HttpStatus.FORBIDDEN, `Достигнут лимит филиалов по тарифу (${limit})`, {
            limit,
            current: count,
          });
        }
        const slug = input.slug ?? (await this.uniqueSlug(tx, slugify(input.name)));
        const branch = await tx.branch.create({
          data: {
            organizationId,
            name: input.name,
            slug,
            address: input.address,
            phone: input.phone,
            timezone: input.timezone,
            description: input.description,
            latitude: input.latitude,
            longitude: input.longitude,
            mapUrl: input.mapUrl,
            mapEnabled: input.mapEnabled ?? true,
          },
        });
        await tx.bookingSettings.create({ data: { branchId: branch.id, organizationId } });
        await tx.publicPage.create({ data: { organizationId, branchId: branch.id } });
        await this.audit.log(actor, 'branch.created', 'branch', branch.id, { after: branch, organizationId }, tx);
        return branch;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.conflict('Ссылка (slug) уже занята');
      throw e;
    }
  }

  private async uniqueSlug(tx: { branch: { findUnique: (a: { where: { slug: string } }) => Promise<unknown> } }, base: string) {
    let candidate = base.length >= 3 ? base : `${base}-branch`;
    for (let i = 2; i < 200; i++) {
      if (!(await tx.branch.findUnique({ where: { slug: candidate } }))) return candidate;
      candidate = `${base.slice(0, 55)}-${i}`;
    }
    throw AppError.conflict('Не удалось подобрать свободную ссылку');
  }

  async update(organizationId: string, branchId: string, input: UpdateBranchInput, actor: ActorContext) {
    const before = await this.get(organizationId, branchId);
    const after = await this.prisma.branch.update({
      where: { id: branchId },
      data: {
        name: input.name,
        address: input.address,
        phone: input.phone,
        timezone: input.timezone,
        description: input.description,
        latitude: input.latitude,
        longitude: input.longitude,
        mapUrl: input.mapUrl,
        mapEnabled: input.mapEnabled,
      },
    });
    await this.audit.log(actor, 'branch.updated', 'branch', branchId, { before, after, organizationId });
    return after;
  }

  /** Архивирование (данные и история сохраняются). Будущие активные записи блокируют архивирование. */
  async archive(organizationId: string, branchId: string, actor: ActorContext) {
    await this.get(organizationId, branchId);
    const future = await this.prisma.appointment.count({
      where: { organizationId, branchId, status: { in: ['pending_otp', 'confirmed'] }, startAt: { gt: new Date() } },
    });
    if (future > 0) throw AppError.conflict(`В филиале есть будущие записи (${future}). Перенесите или отмените их.`);
    await this.prisma.branch.update({ where: { id: branchId }, data: { archivedAt: new Date() } });
    await this.prisma.publicPage.updateMany({ where: { branchId }, data: { status: 'disabled' } });
    await this.audit.log(actor, 'branch.archived', 'branch', branchId, { organizationId });
  }

  async getBookingSettings(organizationId: string, branchId: string) {
    await this.get(organizationId, branchId);
    return this.prisma.bookingSettings.upsert({
      where: { branchId },
      create: { branchId, organizationId },
      update: {},
    });
  }

  async updateBookingSettings(
    organizationId: string,
    branchId: string,
    input: z.infer<typeof BookingSettingsSchema>,
    actor: ActorContext,
  ) {
    const before = await this.getBookingSettings(organizationId, branchId);
    const after = await this.prisma.bookingSettings.update({ where: { branchId }, data: input });
    await this.audit.log(actor, 'booking_settings.updated', 'branch', branchId, { before, after, organizationId });
    return after;
  }
}
