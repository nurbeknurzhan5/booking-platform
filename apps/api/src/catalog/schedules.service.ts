import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ScheduleExceptionInputSchema, WeeklyScheduleSchema } from '@booking/shared';
import { PrismaService } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { AuditService } from '../common/audit.service';
import type { ActorContext, TenantContext } from '../common/request-context';

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h! * 60 + m!;
}
export function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function dateOnly(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

function assertNoOverlap(intervals: Array<{ start: string; end: string }>, what: string) {
  const sorted = intervals.map((i) => [timeToMinutes(i.start), timeToMinutes(i.end)] as const).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]![0] < sorted[i - 1]![1]) throw AppError.badRequest('VALIDATION_ERROR', `${what}: интервалы пересекаются`);
  }
}

/** Расписания филиала и ресурсов (§7). Время — локальное время филиала. */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertResource(t: TenantContext, branchId: string, resourceId: string | null) {
    if (!resourceId) return;
    const r = await this.prisma.resource.findFirst({ where: { id: resourceId, organizationId: t.organizationId, branchId, archivedAt: null } });
    if (!r) throw AppError.notFound('Ресурс');
  }

  async get(t: TenantContext, branchId: string, resourceId: string | null) {
    await this.assertResource(t, branchId, resourceId);
    const where = { organizationId: t.organizationId, branchId, resourceId };
    const [hours, breaks, exceptions] = await Promise.all([
      this.prisma.workingHours.findMany({ where, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }),
      this.prisma.break.findMany({ where, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }),
      this.prisma.scheduleException.findMany({
        where: { ...where, dateTo: { gte: new Date(Date.now() - 30 * 86400_000) } },
        orderBy: { dateFrom: 'asc' },
      }),
    ]);
    const days = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      intervals: hours.filter((h) => h.weekday === weekday).map((h) => ({ start: minutesToTime(h.startMinute), end: minutesToTime(h.endMinute) })),
      breaks: breaks.filter((b) => b.weekday === weekday).map((b) => ({ start: minutesToTime(b.startMinute), end: minutesToTime(b.endMinute) })),
    }));
    return {
      resourceId,
      /** true — у ресурса нет собственного расписания, используется расписание филиала. */
      inheritsBranch: resourceId !== null && hours.length === 0,
      days,
      exceptions: exceptions.map((e) => ({
        id: e.id,
        dateFrom: e.dateFrom.toISOString().slice(0, 10),
        dateTo: e.dateTo.toISOString().slice(0, 10),
        kind: e.kind,
        intervals: (e.intervals as Array<{ start: number; end: number }>).map((i) => ({ start: minutesToTime(i.start), end: minutesToTime(i.end) })),
        reason: e.reason,
      })),
    };
  }

  async setWeekly(t: TenantContext, branchId: string, input: z.infer<typeof WeeklyScheduleSchema>, actor: ActorContext) {
    await this.assertResource(t, branchId, input.resourceId);
    const weekdays = input.days.map((d) => d.weekday);
    if (new Set(weekdays).size !== weekdays.length) throw AppError.badRequest('VALIDATION_ERROR', 'День недели указан дважды');
    for (const d of input.days) {
      assertNoOverlap(d.intervals, `День ${d.weekday}`);
      assertNoOverlap(d.breaks, `Перерывы, день ${d.weekday}`);
    }
    const before = await this.get(t, branchId, input.resourceId);
    const base = { organizationId: t.organizationId, branchId, resourceId: input.resourceId };
    await this.prisma.$transaction(async (tx) => {
      await tx.workingHours.deleteMany({ where: base });
      await tx.break.deleteMany({ where: base });
      const hours = input.days.flatMap((d) => d.intervals.map((i) => ({ ...base, weekday: d.weekday, startMinute: timeToMinutes(i.start), endMinute: timeToMinutes(i.end) })));
      const brks = input.days.flatMap((d) => d.breaks.map((i) => ({ ...base, weekday: d.weekday, startMinute: timeToMinutes(i.start), endMinute: timeToMinutes(i.end) })));
      if (hours.length) await tx.workingHours.createMany({ data: hours });
      if (brks.length) await tx.break.createMany({ data: brks });
    });
    const after = await this.get(t, branchId, input.resourceId);
    await this.audit.log(actor, 'schedule.updated', input.resourceId ? 'resource' : 'branch', input.resourceId ?? branchId, { before: before.days, after: after.days });
    return after;
  }

  async addException(t: TenantContext, branchId: string, input: z.infer<typeof ScheduleExceptionInputSchema>, actor: ActorContext) {
    await this.assertResource(t, branchId, input.resourceId);
    assertNoOverlap(input.intervals, 'Особые часы');
    const e = await this.prisma.scheduleException.create({
      data: {
        organizationId: t.organizationId,
        branchId,
        resourceId: input.resourceId,
        dateFrom: dateOnly(input.dateFrom),
        dateTo: dateOnly(input.dateTo),
        kind: input.kind,
        intervals: input.intervals.map((i) => ({ start: timeToMinutes(i.start), end: timeToMinutes(i.end) })),
        reason: input.reason,
      },
    });
    await this.audit.log(actor, 'schedule.exception_added', 'schedule_exception', e.id, { after: input });
    return e;
  }

  async removeException(t: TenantContext, branchId: string, id: string, actor: ActorContext) {
    const r = await this.prisma.scheduleException.deleteMany({ where: { id, organizationId: t.organizationId, branchId } });
    if (r.count === 0) throw AppError.notFound('Исключение');
    await this.audit.log(actor, 'schedule.exception_removed', 'schedule_exception', id);
  }
}
