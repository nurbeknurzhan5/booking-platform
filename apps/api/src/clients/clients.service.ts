import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { UpdateClientSchema } from '@booking/shared';
import { PrismaService } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { allowedBranches } from '../common/tenant-access';
import type { ActorContext, TenantContext } from '../common/request-context';
import type { Prisma } from '../generated/prisma/client';

/** Клиенты организации (§11). Администратор видит клиентов, у которых есть записи в его филиалах. */
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private scope(t: TenantContext): Prisma.ClientWhereInput {
    const allowed = allowedBranches(t, 'clients.view');
    return {
      organizationId: t.organizationId,
      mergedIntoId: null,
      ...(allowed ? { appointments: { some: { branchId: { in: allowed } } } } : {}),
    };
  }

  private async stats(organizationId: string, clientIds: string[], branchIds: string[] | null) {
    if (!clientIds.length) return new Map<string, { visits: number; cancellations: number; noShows: number; lastVisitAt: Date | null }>();
    const rows = await this.prisma.appointment.groupBy({
      by: ['clientId', 'status'],
      where: { organizationId, clientId: { in: clientIds }, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
      _count: { _all: true },
      _max: { startAt: true },
    });
    const out = new Map<string, { visits: number; cancellations: number; noShows: number; lastVisitAt: Date | null }>();
    for (const id of clientIds) out.set(id, { visits: 0, cancellations: 0, noShows: 0, lastVisitAt: null });
    for (const r of rows) {
      const s = out.get(r.clientId)!;
      if (r.status === 'completed') {
        s.visits += r._count._all;
        if (r._max.startAt && (!s.lastVisitAt || r._max.startAt > s.lastVisitAt)) s.lastVisitAt = r._max.startAt;
      }
      if (r.status === 'cancelled_by_client' || r.status === 'cancelled_by_admin') s.cancellations += r._count._all;
      if (r.status === 'no_show') s.noShows += r._count._all;
    }
    return out;
  }

  async list(t: TenantContext, q: { search?: string; page: number; pageSize: number }) {
    const s = q.search?.trim();
    const digits = s?.replace(/\D/g, '');
    const where: Prisma.ClientWhereInput = {
      ...this.scope(t),
      anonymizedAt: null,
      ...(s
        ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, ...(digits && digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.client.count({ where }),
      this.prisma.client.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const stats = await this.stats(t.organizationId, rows.map((r) => r.id), allowedBranches(t, 'clients.view'));
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((c) => ({ id: c.id, name: c.name, phone: c.phone, locale: c.locale, registered: !!c.userId, createdAt: c.createdAt, ...stats.get(c.id) })),
    };
  }

  async card(t: TenantContext, id: string) {
    const c = await this.prisma.client.findFirst({ where: { id, ...this.scope(t) } });
    if (!c) throw AppError.notFound('Клиент');
    const branches = allowedBranches(t, 'clients.view');
    const [appointments, reviews, consents, stats] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { clientId: id, organizationId: t.organizationId, ...(branches ? { branchId: { in: branches } } : {}) },
        orderBy: { startAt: 'desc' },
        take: 200,
        include: { items: { select: { serviceNameSnapshot: true, specialistNameSnapshot: true, finalPrice: true } }, branch: { select: { id: true, name: true } } },
      }),
      this.prisma.review.findMany({ where: { clientId: id, organizationId: t.organizationId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.clientConsent.findMany({ where: { phone: c.phone, OR: [{ organizationId: t.organizationId }, { organizationId: null }] }, orderBy: { createdAt: 'desc' } }),
      this.stats(t.organizationId, [id], branches),
    ]);
    const latest: Record<string, { granted: boolean; at: Date }> = {};
    for (const cs of consents) if (!latest[cs.consentType]) latest[cs.consentType] = { granted: cs.granted, at: cs.createdAt };
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      locale: c.locale,
      notes: c.notes,
      registered: !!c.userId,
      createdAt: c.createdAt,
      anonymized: !!c.anonymizedAt,
      stats: stats.get(id),
      consents: latest,
      appointments,
      reviews,
    };
  }

  async update(t: TenantContext, id: string, input: z.infer<typeof UpdateClientSchema>, actor: ActorContext) {
    const before = await this.prisma.client.findFirst({ where: { id, ...this.scope(t) } });
    if (!before) throw AppError.notFound('Клиент');
    const after = await this.prisma.client.update({ where: { id }, data: input });
    await this.audit.log(actor, 'client.updated', 'client', id, { before, after });
    return after;
  }

  /** Объединение дублей с сохранением истории записей и аудита (§11). Только владелец. */
  async merge(t: TenantContext, sourceId: string, targetId: string, actor: ActorContext) {
    if (sourceId === targetId) throw AppError.badRequest('VALIDATION_ERROR', 'Нельзя объединить клиента с самим собой');
    const [source, target] = await Promise.all([
      this.prisma.client.findFirst({ where: { id: sourceId, organizationId: t.organizationId, mergedIntoId: null } }),
      this.prisma.client.findFirst({ where: { id: targetId, organizationId: t.organizationId, mergedIntoId: null } }),
    ]);
    if (!source || !target) throw AppError.notFound('Клиент');
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.appointment.updateMany({ where: { clientId: sourceId, organizationId: t.organizationId }, data: { clientId: targetId } });
      await tx.review.updateMany({ where: { clientId: sourceId, organizationId: t.organizationId }, data: { clientId: targetId } });
      await tx.promotionRedemption.updateMany({ where: { clientId: sourceId, organizationId: t.organizationId }, data: { clientId: targetId } });
      await tx.waitlistEntry.updateMany({ where: { clientId: sourceId, organizationId: t.organizationId }, data: { clientId: targetId } });
      await tx.client.update({ where: { id: sourceId }, data: { mergedIntoId: targetId } });
      if (!target.userId && source.userId) await tx.client.update({ where: { id: targetId }, data: { userId: source.userId } });
      await this.audit.log(actor, 'client.merged', 'client', targetId, {
        before: { source: { id: source.id, name: source.name, phone: source.phone }, target: { id: target.id, name: target.name, phone: target.phone } },
        after: { movedAppointments: moved.count },
      }, tx);
      return { targetId, movedAppointments: moved.count };
    });
  }

  /** Обезличивание по запросу субъекта персональных данных (§22). История визитов сохраняется без ПД. */
  async anonymize(t: TenantContext, id: string, actor: ActorContext) {
    const c = await this.prisma.client.findFirst({ where: { id, organizationId: t.organizationId, mergedIntoId: null, anonymizedAt: null } });
    if (!c) throw AppError.notFound('Клиент');
    const active = await this.prisma.appointment.count({ where: { clientId: id, status: { in: ['pending_otp', 'confirmed'] }, endAt: { gt: new Date() } } });
    if (active > 0) throw AppError.conflict('У клиента есть активные записи — сначала отмените их');
    await this.prisma.$transaction([
      this.prisma.client.update({
        where: { id },
        data: { name: 'Удалённый клиент', phone: `anon-${id.slice(0, 10)}`, notes: null, userId: null, anonymizedAt: new Date() },
      }),
      this.prisma.review.updateMany({ where: { clientId: id }, data: { authorName: 'Удалённый клиент' } }),
      // Лист ожидания: заявки и действующие предложения обезличенного клиента аннулируются.
      this.prisma.waitlistOffer.updateMany({ where: { entry: { clientId: id }, status: 'pending' }, data: { status: 'cancelled' } }),
      this.prisma.waitlistEntry.updateMany({
        where: { clientId: id, status: { in: ['pending_otp', 'waiting', 'offered'] } },
        data: { status: 'cancelled', cancelledAt: new Date(), tokenHash: null, offeredAt: null, offerExpiresAt: null },
      }),
    ]);
    await this.audit.log(actor, 'client.anonymized', 'client', id, { before: { id } });
  }
}
