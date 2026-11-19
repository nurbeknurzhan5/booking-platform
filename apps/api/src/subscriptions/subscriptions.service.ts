import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { computeSubscriptionStatus, graceEndsAt, RecordPaymentSchema, SetSubscriptionSchema } from '@booking/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { AuditService } from '../common/audit.service';
import type { ActorContext } from '../common/request-context';
import type { Prisma, Subscription } from '../generated/prisma/client';

type SetSubscription = z.infer<typeof SetSubscriptionSchema>;
type RecordPayment = z.infer<typeof RecordPaymentSchema>;

function snapshot(s: Subscription): Prisma.InputJsonValue {
  return {
    planId: s.planId,
    maxBranches: s.maxBranches,
    price: s.price,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    graceDays: s.graceDays,
    suspended: s.suspended,
    status: s.status,
  };
}

/** Подписки (§2.3). Изменяет только суперадминистратор; история и платежи — append-only. */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async summary(organizationId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
    if (!sub) return { status: 'expired' as const, subscription: null };
    const status = computeSubscriptionStatus(sub, new Date());
    const branchesUsed = await this.prisma.branch.count({ where: { organizationId, archivedAt: null } });
    return {
      status,
      subscription: {
        plan: { id: sub.plan.id, code: sub.plan.code, name: sub.plan.name },
        maxBranches: sub.maxBranches,
        branchesUsed,
        price: sub.price,
        startsAt: sub.startsAt,
        endsAt: sub.endsAt,
        graceDays: sub.graceDays,
        graceEndsAt: graceEndsAt(sub),
        lastPaymentAt: sub.lastPaymentAt,
        lastPaymentAmount: sub.lastPaymentAmount,
        suspendedReason: sub.suspended ? sub.suspendedReason : null,
      },
    };
  }

  async set(organizationId: string, input: SetSubscription, actor: ActorContext, tx?: Tx) {
    const run = async (db: Tx) => {
      const plan = await db.plan.findUnique({ where: { id: input.planId } });
      if (!plan) throw AppError.notFound('Тариф');
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      const existing = await db.subscription.findUnique({ where: { organizationId } });
      const base = {
        planId: plan.id,
        maxBranches: input.maxBranches ?? plan.maxBranches,
        price: input.price ?? plan.monthlyPrice,
        startsAt,
        endsAt,
        graceDays: input.graceDays,
      };
      const status = computeSubscriptionStatus({ ...base, suspended: existing?.suspended ?? false }, new Date());
      const sub = existing
        ? await db.subscription.update({ where: { organizationId }, data: { ...base, status } })
        : await db.subscription.create({ data: { ...base, organizationId, status } });
      await db.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: sub.id,
          action: existing ? 'changed' : 'created',
          fromStatus: existing?.status ?? null,
          toStatus: status,
          snapshot: snapshot(sub),
          actorUserId: actor.userId,
          note: input.note,
        },
      });
      await this.audit.log(actor, existing ? 'subscription.changed' : 'subscription.created', 'subscription', sub.id, {
        before: existing,
        after: sub,
        organizationId,
      }, db);
      return sub;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /** Фиксация оплаты; при extendTo — продление (подтверждение оплаты суперадмином). */
  async recordPayment(organizationId: string, input: RecordPayment, actor: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { organizationId } });
      if (!sub) throw AppError.notFound('Подписка');
      const payment = await tx.subscriptionPayment.create({
        data: {
          organizationId,
          subscriptionId: sub.id,
          amount: input.amount,
          paidAt: new Date(input.paidAt),
          method: input.method,
          reference: input.reference,
          note: input.note,
          recordedByUserId: actor.userId,
        },
      });
      let updated = await tx.subscription.update({
        where: { id: sub.id },
        data: { lastPaymentAt: payment.paidAt, lastPaymentAmount: payment.amount },
      });
      await tx.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: sub.id,
          action: 'payment_recorded',
          fromStatus: sub.status,
          toStatus: sub.status,
          snapshot: { ...(snapshot(updated) as object), paymentId: payment.id, amount: payment.amount },
          actorUserId: actor.userId,
          note: input.note,
        },
      });
      if (input.extendTo) {
        const endsAt = new Date(input.extendTo);
        if (endsAt <= sub.endsAt) throw AppError.badRequest('VALIDATION_ERROR', 'Новая дата окончания должна быть позже текущей');
        const status = computeSubscriptionStatus({ ...updated, endsAt }, new Date());
        updated = await tx.subscription.update({ where: { id: sub.id }, data: { endsAt, status } });
        await tx.subscriptionHistory.create({
          data: {
            organizationId,
            subscriptionId: sub.id,
            action: 'renewed',
            fromStatus: sub.status,
            toStatus: status,
            snapshot: snapshot(updated),
            actorUserId: actor.userId,
            note: `Продление до ${endsAt.toISOString()}`,
          },
        });
      }
      await this.audit.log(actor, 'subscription.payment_recorded', 'subscription', sub.id, { after: { payment, endsAt: updated.endsAt }, organizationId }, tx);
      return { payment, subscription: updated };
    });
  }

  async setSuspended(organizationId: string, suspended: boolean, reason: string, actor: ActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { organizationId } });
      if (!sub) throw AppError.notFound('Подписка');
      const status = computeSubscriptionStatus({ ...sub, suspended }, new Date());
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: { suspended, suspendedReason: suspended ? reason : null, status },
      });
      await tx.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: sub.id,
          action: suspended ? 'suspended' : 'restored',
          fromStatus: sub.status,
          toStatus: status,
          snapshot: snapshot(updated),
          actorUserId: actor.userId,
          note: reason,
        },
      });
      await this.audit.log(actor, suspended ? 'organization.suspended' : 'organization.restored', 'organization', organizationId, {
        before: { status: sub.status },
        after: { status, reason },
        organizationId,
      }, tx);
      return updated;
    });
  }

  history(organizationId: string) {
    return Promise.all([
      this.prisma.subscriptionHistory.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.subscriptionPayment.findMany({ where: { organizationId }, orderBy: { paidAt: 'desc' }, take: 200 }),
    ]).then(([history, payments]) => ({ history, payments }));
  }

  /** Воркер: пересчёт сохранённых статусов и запись переходов в историю. */
  async refreshStatuses(now = new Date()): Promise<number> {
    const subs = await this.prisma.subscription.findMany();
    let changed = 0;
    for (const sub of subs) {
      const status = computeSubscriptionStatus(sub, now);
      if (status === sub.status) continue;
      const res = await this.prisma.$transaction(async (tx) => {
        const r = await tx.subscription.updateMany({ where: { id: sub.id, status: sub.status }, data: { status } });
        if (r.count === 0) return 0;
        await tx.subscriptionHistory.create({
          data: {
            organizationId: sub.organizationId,
            subscriptionId: sub.id,
            action: 'status_changed',
            fromStatus: sub.status,
            toStatus: status,
            snapshot: snapshot({ ...sub, status }),
            note: 'Автоматический пересчёт статуса',
          },
        });
        return 1;
      });
      changed += res;
    }
    return changed;
  }
}
