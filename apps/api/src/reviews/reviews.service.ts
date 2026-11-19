import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { assertBranchPermission, branchFilter } from '../common/tenant-access';
import type { ActorContext, TenantContext } from '../common/request-context';

const REVIEW_WINDOW_DAYS = 30;

/**
 * Отзывы (§14, решение D-18): только по завершённым визитам, один отзыв на визит,
 * текст и оценка неизменяемы (триггер БД). Владелец отвечает или жалуется, скрывает — суперадмин.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(appointmentId: string, input: { rating: number; text?: string }) {
    const a = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: { client: true, review: true } });
    if (!a) throw AppError.notFound('Запись');
    if (a.status !== 'completed') throw new AppError('REVIEW_NOT_ALLOWED', HttpStatus.UNPROCESSABLE_ENTITY, 'Отзыв можно оставить только после завершённого визита');
    if (a.review) throw new AppError('REVIEW_NOT_ALLOWED', HttpStatus.CONFLICT, 'Отзыв к этому визиту уже оставлен');
    if (Date.now() - a.endAt.getTime() > REVIEW_WINDOW_DAYS * 86400_000) {
      throw new AppError('REVIEW_NOT_ALLOWED', HttpStatus.UNPROCESSABLE_ENTITY, 'Срок для отзыва истёк');
    }
    const firstName = a.client.name.split(/\s+/)[0] ?? a.client.name;
    return this.prisma.review.create({
      data: {
        organizationId: a.organizationId,
        branchId: a.branchId,
        appointmentId,
        clientId: a.clientId,
        rating: input.rating,
        text: input.text?.trim() || null,
        authorName: firstName.slice(0, 200),
      },
    });
  }

  list(t: TenantContext, branchId?: string) {
    return this.prisma.review.findMany({
      where: { organizationId: t.organizationId, ...branchFilter(t, 'reviews.manage', branchId) },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { appointment: { select: { startAt: true, items: { select: { serviceNameSnapshot: true, specialistNameSnapshot: true } } } } },
    });
  }

  private async load(t: TenantContext, id: string) {
    const r = await this.prisma.review.findFirst({ where: { id, organizationId: t.organizationId } });
    if (!r) throw AppError.notFound('Отзыв');
    assertBranchPermission(t, 'reviews.manage', r.branchId);
    return r;
  }

  async reply(t: TenantContext, id: string, text: string, actor: ActorContext) {
    const r = await this.load(t, id);
    const updated = await this.prisma.review.update({ where: { id }, data: { reply: text, repliedAt: new Date(), repliedByUserId: actor.userId } });
    await this.audit.log(actor, 'review.replied', 'review', id, { before: { reply: r.reply }, after: { reply: text } });
    return updated;
  }

  async report(t: TenantContext, id: string, reason: string, actor: ActorContext) {
    await this.load(t, id);
    const updated = await this.prisma.review.update({ where: { id }, data: { reportedAt: new Date(), reportReason: reason } });
    await this.audit.log(actor, 'review.reported', 'review', id, { after: { reason } });
    return updated;
  }

  /** Модерация суперадмином с фиксацией причины. */
  async moderate(id: string, status: 'published' | 'hidden', reason: string, actor: ActorContext) {
    const r = await this.prisma.review.findUnique({ where: { id } });
    if (!r) throw AppError.notFound('Отзыв');
    const updated = await this.prisma.review.update({
      where: { id },
      data: { status, moderationReason: reason, moderatedAt: new Date(), moderatedByUserId: actor.userId },
    });
    await this.audit.log(actor, 'review.moderated', 'review', id, { before: { status: r.status }, after: { status, reason }, organizationId: r.organizationId });
    return updated;
  }

  async publicSummary(branchId: string, limit = 20) {
    const [items, agg] = await Promise.all([
      this.prisma.review.findMany({
        where: { branchId, status: 'published' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, rating: true, text: true, authorName: true, reply: true, repliedAt: true, createdAt: true },
      }),
      this.prisma.review.aggregate({ where: { branchId, status: 'published' }, _avg: { rating: true }, _count: { _all: true } }),
    ]);
    return { average: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : null, count: agg._count._all, items };
  }
}
