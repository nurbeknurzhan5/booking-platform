import { HttpStatus, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { ShiftCopySchema, ShiftDeleteSchema, ShiftFillSchema, ShiftUpsertSchema } from '@booking/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { dayWindows, instantToMinutes, shiftWindows, type ExceptionRule, type Interval, type ScheduleSource } from '../booking/engine';
import type { ActorContext, TenantContext } from '../common/request-context';

type ShiftInput = z.infer<typeof ShiftUpsertSchema>;

/** Запись, которая окажется вне смены специалиста (предупреждение при снятии или сокращении смены). */
export interface ShiftConflict {
  appointmentId: string;
  startAt: string;
  endAt: string;
  status: string;
  clientName: string;
  clientPhone: string;
  services: string[];
  resourceId: string;
  specialistName: string | null;
}

const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const toDbDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * График смен (задача 21). В режиме «по сменам» специалист доступен для записи только в назначенные смены
 * (AvailabilityService учитывает их при расчёте слотов). Снятие или сокращение смены, из-за которого
 * существующие записи окажутся вне рабочего времени, без подтверждения (force) отклоняется
 * с ошибкой SHIFT_CONFLICT и списком этих записей. Записи при подтверждении не отменяются:
 * они остаются в списке конфликтов, пока администратор их не перенесёт или не отменит.
 */
@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async branch(t: TenantContext, branchId: string) {
    const b = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId: t.organizationId, archivedAt: null }, include: { bookingSettings: true } });
    if (!b) throw AppError.notFound('Филиал');
    return b;
  }

  private async specialistResources(organizationId: string, branchId: string) {
    return this.prisma.specialist.findMany({
      where: { organizationId, branchId, archivedAt: null },
      select: { id: true, name: true, resourceId: true, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async list(t: TenantContext, branchId: string, from: string, to: string) {
    const b = await this.branch(t, branchId);
    const [specialists, shifts] = await Promise.all([
      this.specialistResources(t.organizationId, branchId),
      this.prisma.staffShift.findMany({ where: { organizationId: t.organizationId, branchId, date: { gte: toDbDate(from), lte: toDbDate(to) } }, orderBy: [{ date: 'asc' }] }),
    ]);
    return {
      mode: b.bookingSettings?.scheduleMode ?? 'weekly',
      timezone: b.timezone,
      specialists,
      shifts: shifts.map((s) => ({ id: s.id, resourceId: s.resourceId, date: dateKey(s.date), startMinute: s.startMinute, endMinute: s.endMinute, breakStart: s.breakStart, breakEnd: s.breakEnd })),
    };
  }

  /** Записи специалиста на дату, которые не помещаются в новые рабочие окна (null — снятие со смены). */
  private async conflictsFor(db: Tx | PrismaService, resourceId: string, date: string, timezone: string, windows: Interval[]): Promise<ShiftConflict[]> {
    const midnight = DateTime.fromISO(date, { zone: timezone }).startOf('day');
    const rows = await db.appointmentResource.findMany({
      where: {
        resourceId,
        isActive: true,
        startAt: { gte: midnight.toJSDate(), lt: midnight.plus({ days: 1 }).toJSDate() },
        appointment: { OR: [{ status: 'confirmed' }, { status: 'pending_otp', hold: { releasedAt: null, expiresAt: { gt: new Date() } } }] },
      },
      include: {
        appointment: { select: { id: true, status: true, startAt: true, endAt: true, client: { select: { name: true, phone: true } }, items: { select: { serviceNameSnapshot: true, specialistNameSnapshot: true } } } },
      },
    });
    const inside = (a: number, b: number) => windows.some((w) => w.start <= a && b <= w.end);
    const seen = new Set<string>();
    const out: ShiftConflict[] = [];
    for (const r of rows) {
      if (inside(r.startAt.getTime(), r.endAt.getTime()) || seen.has(r.appointment.id)) continue;
      seen.add(r.appointment.id);
      out.push({
        appointmentId: r.appointment.id,
        startAt: r.appointment.startAt.toISOString(),
        endAt: r.appointment.endAt.toISOString(),
        status: r.appointment.status,
        clientName: r.appointment.client.name,
        clientPhone: r.appointment.client.phone,
        services: r.appointment.items.map((i) => i.serviceNameSnapshot),
        resourceId,
        specialistName: r.appointment.items.find((i) => i.specialistNameSnapshot)?.specialistNameSnapshot ?? null,
      });
    }
    return out.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  private assertNoConflicts(conflicts: ShiftConflict[], force: boolean) {
    if (conflicts.length && !force) {
      throw new AppError(
        'SHIFT_CONFLICT',
        HttpStatus.CONFLICT,
        `На это время у специалиста есть записи (${conflicts.length}). Перенесите или отмените их, либо подтвердите изменение.`,
        { appointments: conflicts },
      );
    }
  }

  private async assertSpecialist(organizationId: string, branchId: string, resourceId: string) {
    const r = await this.prisma.resource.findFirst({ where: { id: resourceId, organizationId, branchId, type: 'specialist', archivedAt: null } });
    if (!r) throw AppError.badRequest('VALIDATION_ERROR', 'Специалист не найден в этом филиале');
  }

  async upsert(t: TenantContext, branchId: string, input: ShiftInput, actor: ActorContext) {
    const b = await this.branch(t, branchId);
    await this.assertSpecialist(t.organizationId, branchId, input.resourceId);
    const rule = { startMinute: input.startMinute, endMinute: input.endMinute, breakStart: input.breakStart ?? null, breakEnd: input.breakEnd ?? null };
    const conflicts = await this.conflictsFor(this.prisma, input.resourceId, input.date, b.timezone, shiftWindows(rule, input.date, b.timezone));
    this.assertNoConflicts(conflicts, input.force);
    const shift = await this.prisma.staffShift.upsert({
      where: { resourceId_date: { resourceId: input.resourceId, date: toDbDate(input.date) } },
      create: { organizationId: t.organizationId, branchId, resourceId: input.resourceId, date: toDbDate(input.date), ...rule, updatedByUserId: actor.userId },
      update: { ...rule, updatedByUserId: actor.userId },
    });
    await this.audit.log(actor, 'shift.saved', 'resource', input.resourceId, { after: { date: input.date, ...rule, conflicts: conflicts.length }, organizationId: t.organizationId });
    return { id: shift.id, resourceId: shift.resourceId, date: input.date, ...rule, conflicts };
  }

  async remove(t: TenantContext, branchId: string, input: z.infer<typeof ShiftDeleteSchema>, actor: ActorContext) {
    const b = await this.branch(t, branchId);
    await this.assertSpecialist(t.organizationId, branchId, input.resourceId);
    const conflicts = await this.conflictsFor(this.prisma, input.resourceId, input.date, b.timezone, []);
    this.assertNoConflicts(conflicts, input.force);
    const r = await this.prisma.staffShift.deleteMany({ where: { organizationId: t.organizationId, branchId, resourceId: input.resourceId, date: toDbDate(input.date) } });
    if (r.count) await this.audit.log(actor, 'shift.removed', 'resource', input.resourceId, { before: { date: input.date }, after: { conflicts: conflicts.length }, organizationId: t.organizationId });
    return { removed: r.count, conflicts };
  }

  /** Заполнение смен по недельному графику специалистов (или филиала, если у специалиста своего нет). */
  async fill(t: TenantContext, branchId: string, input: z.infer<typeof ShiftFillSchema>, actor: ActorContext) {
    const b = await this.branch(t, branchId);
    const specialists = await this.specialistResources(t.organizationId, branchId);
    const resIds = specialists.filter((s) => s.isActive && (!input.resourceIds || input.resourceIds.includes(s.resourceId))).map((s) => s.resourceId);
    const owner = { branchId, OR: [{ resourceId: null }, { resourceId: { in: resIds } }] };
    const [hours, breaks, exceptions, existing] = await Promise.all([
      this.prisma.workingHours.findMany({ where: owner }),
      this.prisma.break.findMany({ where: owner }),
      this.prisma.scheduleException.findMany({ where: { ...owner, dateFrom: { lte: toDbDate(input.to) }, dateTo: { gte: toDbDate(input.from) } } }),
      this.prisma.staffShift.findMany({ where: { branchId, resourceId: { in: resIds }, date: { gte: toDbDate(input.from), lte: toDbDate(input.to) } }, select: { resourceId: true, date: true } }),
    ]);
    const src = (resourceId: string | null): ScheduleSource => ({
      hours: hours.filter((h) => h.resourceId === resourceId).map((h) => ({ weekday: h.weekday, start: h.startMinute, end: h.endMinute })),
      breaks: breaks.filter((x) => x.resourceId === resourceId).map((x) => ({ weekday: x.weekday, start: x.startMinute, end: x.endMinute })),
      exceptions: exceptions
        .filter((e) => e.resourceId === resourceId)
        .map((e): ExceptionRule => ({ dateFrom: dateKey(e.dateFrom), dateTo: dateKey(e.dateTo), kind: e.kind as 'closed' | 'custom_hours', intervals: e.intervals as Array<{ start: number; end: number }> })),
    });
    const has = new Set(existing.map((e) => `${e.resourceId}:${dateKey(e.date)}`));
    let created = 0;
    let skipped = 0;
    for (let d = DateTime.fromISO(input.from); d <= DateTime.fromISO(input.to); d = d.plus({ days: 1 })) {
      const date = d.toISODate()!;
      const branchWin = dayWindows(src(null), date, b.timezone);
      for (const resourceId of resIds) {
        if (has.has(`${resourceId}:${date}`) && !input.overwrite) {
          skipped++;
          continue;
        }
        const win = dayWindows(src(resourceId), date, b.timezone, branchWin);
        if (!win.length) continue; // выходной по недельному графику
        const startMinute = instantToMinutes(win[0]!.start, date, b.timezone);
        const endMinute = instantToMinutes(win[win.length - 1]!.end, date, b.timezone);
        // Смена хранит один перерыв — первый промежуток между рабочими интервалами.
        const breakStart = win.length > 1 ? instantToMinutes(win[0]!.end, date, b.timezone) : null;
        const breakEnd = win.length > 1 ? instantToMinutes(win[1]!.start, date, b.timezone) : null;
        await this.prisma.staffShift.upsert({
          where: { resourceId_date: { resourceId, date: toDbDate(date) } },
          create: { organizationId: t.organizationId, branchId, resourceId, date: toDbDate(date), startMinute, endMinute, breakStart, breakEnd, updatedByUserId: actor.userId },
          update: { startMinute, endMinute, breakStart, breakEnd, updatedByUserId: actor.userId },
        });
        created++;
      }
    }
    await this.audit.log(actor, 'shift.filled', 'branch', branchId, { after: { from: input.from, to: input.to, created }, organizationId: t.organizationId });
    return { created, skipped };
  }

  /** Копирование смен одного дня на другие даты. При перезаписи с конфликтами — SHIFT_CONFLICT без изменений. */
  async copy(t: TenantContext, branchId: string, input: z.infer<typeof ShiftCopySchema>, actor: ActorContext) {
    const b = await this.branch(t, branchId);
    const source = await this.prisma.staffShift.findMany({ where: { organizationId: t.organizationId, branchId, date: toDbDate(input.fromDate) } });
    const targets = [...new Set(input.toDates)].filter((d) => d !== input.fromDate);
    const existing = await this.prisma.staffShift.findMany({ where: { branchId, date: { in: targets.map(toDbDate) } } });
    const conflicts: ShiftConflict[] = [];
    if (input.overwrite) {
      for (const date of targets) {
        for (const ex of existing.filter((e) => dateKey(e.date) === date)) {
          const src = source.find((s) => s.resourceId === ex.resourceId);
          const win = src ? shiftWindows(src, date, b.timezone) : [];
          conflicts.push(...(await this.conflictsFor(this.prisma, ex.resourceId, date, b.timezone, win)));
        }
      }
      this.assertNoConflicts(conflicts, false);
    }
    let created = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const date of targets) {
        if (input.overwrite) await tx.staffShift.deleteMany({ where: { branchId, date: toDbDate(date) } });
        for (const s of source) {
          if (!input.overwrite && existing.some((e) => e.resourceId === s.resourceId && dateKey(e.date) === date)) continue;
          await tx.staffShift.create({
            data: { organizationId: t.organizationId, branchId, resourceId: s.resourceId, date: toDbDate(date), startMinute: s.startMinute, endMinute: s.endMinute, breakStart: s.breakStart, breakEnd: s.breakEnd, updatedByUserId: actor.userId },
          });
          created++;
        }
      }
    });
    await this.audit.log(actor, 'shift.copied', 'branch', branchId, { after: { fromDate: input.fromDate, toDates: targets, created }, organizationId: t.organizationId });
    return { created };
  }

  /**
   * Записи вне смен в режиме «по сменам» (специалиста сняли со смены или сократили её) и статус графика на завтра —
   * для предупреждений в кабинете.
   */
  async status(t: TenantContext, branchId: string) {
    const b = await this.branch(t, branchId);
    const mode = b.bookingSettings?.scheduleMode ?? 'weekly';
    if (mode !== 'shifts') return { mode, tomorrow: null, conflicts: [] as ShiftConflict[] };
    const today = DateTime.now().setZone(b.timezone).startOf('day');
    const tomorrow = today.plus({ days: 1 }).toISODate()!;
    const specialists = (await this.specialistResources(t.organizationId, branchId)).filter((s) => s.isActive);
    const horizon = today.plus({ days: 31 });
    const [tomorrowShifts, upcoming, shifts] = await Promise.all([
      this.prisma.staffShift.count({ where: { branchId, date: toDbDate(tomorrow) } }),
      this.prisma.appointmentResource.findMany({
        where: {
          isActive: true,
          resourceId: { in: specialists.map((s) => s.resourceId) },
          startAt: { gte: new Date(), lt: horizon.toJSDate() },
          appointment: { status: 'confirmed' },
        },
        select: { resourceId: true, startAt: true },
      }),
      this.prisma.staffShift.findMany({ where: { branchId, date: { gte: toDbDate(today.toISODate()!), lte: toDbDate(horizon.toISODate()!) } } }),
    ]);
    // Даты, на которые у специалистов есть записи: проверяем только их
    const keys = new Set(upcoming.map((u) => `${u.resourceId}|${DateTime.fromJSDate(u.startAt, { zone: b.timezone }).toISODate()}`));
    const conflicts: ShiftConflict[] = [];
    for (const key of keys) {
      const [resourceId, date] = key.split('|') as [string, string];
      const shift = shifts.find((s) => s.resourceId === resourceId && dateKey(s.date) === date);
      conflicts.push(...(await this.conflictsFor(this.prisma, resourceId, date, b.timezone, shift ? shiftWindows(shift, date, b.timezone) : [])));
    }
    return {
      mode,
      tomorrow: { date: tomorrow, specialists: specialists.length, withShift: tomorrowShifts, filled: tomorrowShifts > 0 || specialists.length === 0 },
      conflicts: conflicts.sort((a, c) => a.startAt.localeCompare(c.startAt)),
    };
  }
}
