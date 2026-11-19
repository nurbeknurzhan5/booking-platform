import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AppError } from '../common/errors';
import {
  computeSlots,
  dayWindows,
  findAssignment,
  intersect,
  type EngineResource,
  type EngineService,
  type EngineSettings,
  type ExceptionRule,
  type Interval,
  type RequestItem,
  type ScheduleSource,
  type SlotAssignment,
} from './engine';
import type { BookingSettings, Branch } from '../generated/prisma/client';

export interface LoadedService extends EngineService {
  basePrice: number;
  branchPrice: number | null;
  onlineBookingEnabled: boolean;
}

export interface BookingContext {
  branch: Branch;
  settings: BookingSettings;
  services: LoadedService[];
  resources: EngineResource[];
  branchWindows: Interval[];
  specialistPrices: Map<string, number | null>; // `${specialistId}:${serviceId}` → цена
  specialistNames: Map<string, string>;
  date: string;
}

export interface LoadOptions {
  /** Публичная запись: учитываются флаги онлайн-записи и минимальный срок. */
  audience: 'public' | 'staff';
  /** Исключить занятость этой записи (перенос). */
  excludeAppointmentId?: string;
  now?: Date;
}

/** Загрузка данных филиала на дату для движка доступности. */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async loadContext(db: Tx | PrismaService, branchId: string, date: string, items: RequestItem[], opts: LoadOptions): Promise<BookingContext> {
    const branch = await db.branch.findFirst({ where: { id: branchId, archivedAt: null } });
    if (!branch) throw AppError.notFound('Филиал');
    const settings =
      (await db.bookingSettings.findUnique({ where: { branchId } })) ??
      (await db.bookingSettings.create({ data: { branchId, organizationId: branch.organizationId } }));

    const serviceIds = [...new Set(items.map((i) => i.serviceId))];
    const svcRows = await db.service.findMany({
      where: { id: { in: serviceIds }, organizationId: branch.organizationId, archivedAt: null, isActive: true },
      include: { requirements: true, branchServices: { where: { branchId, isActive: true } } },
    });
    const services: LoadedService[] = svcRows
      .filter((s) => s.branchServices.length > 0)
      .filter((s) => opts.audience === 'staff' || s.onlineBookingEnabled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        durationMinutes: s.durationMinutes,
        bufferBeforeMinutes: s.bufferBeforeMinutes,
        bufferAfterMinutes: s.bufferAfterMinutes,
        requiresSpecialist: s.requiresSpecialist,
        requirements: s.requirements.map((r) => ({ resourceType: r.resourceType, quantity: r.quantity })),
        basePrice: s.price,
        branchPrice: s.branchServices[0]?.priceOverride ?? null,
        onlineBookingEnabled: s.onlineBookingEnabled,
      }));
    if (services.length !== serviceIds.length) {
      throw AppError.badRequest('VALIDATION_ERROR', 'Одна из услуг недоступна для записи в этом филиале');
    }

    const requiredTypes = [...new Set(services.flatMap((s) => s.requirements.map((r) => r.resourceType)))];
    const resRows = await db.resource.findMany({
      where: {
        organizationId: branch.organizationId,
        branchId,
        archivedAt: null,
        isActive: true,
        OR: [
          { type: 'specialist', specialist: { isActive: true, archivedAt: null, services: { some: { serviceId: { in: serviceIds } } } } },
          ...(requiredTypes.length ? [{ type: { in: requiredTypes as never[] }, services: { some: { serviceId: { in: serviceIds } } } }] : []),
        ],
      },
      include: {
        specialist: { include: { services: true } },
        services: true,
      },
    });

    // Расписания филиала и ресурсов
    const resIds = resRows.map((r) => r.id);
    const midnight = DateTime.fromISO(date, { zone: branch.timezone }).startOf('day');
    if (!midnight.isValid) throw AppError.badRequest('VALIDATION_ERROR', 'Некорректная дата');
    const dateObj = new Date(`${date}T00:00:00.000Z`);
    // Последовательно: внутри транзакции запросы идут по одному соединению.
    const hours = await db.workingHours.findMany({ where: { branchId, OR: [{ resourceId: null }, { resourceId: { in: resIds } }] } });
    const breaks = await db.break.findMany({ where: { branchId, OR: [{ resourceId: null }, { resourceId: { in: resIds } }] } });
    const exceptions = await db.scheduleException.findMany({
      where: { branchId, dateFrom: { lte: dateObj }, dateTo: { gte: dateObj }, OR: [{ resourceId: null }, { resourceId: { in: resIds } }] },
    });
    const srcFor = (resourceId: string | null): ScheduleSource => ({
      hours: hours.filter((h) => h.resourceId === resourceId).map((h) => ({ weekday: h.weekday, start: h.startMinute, end: h.endMinute })),
      breaks: breaks.filter((b) => b.resourceId === resourceId).map((b) => ({ weekday: b.weekday, start: b.startMinute, end: b.endMinute })),
      exceptions: exceptions
        .filter((e) => e.resourceId === resourceId)
        .map(
          (e): ExceptionRule => ({
            dateFrom: e.dateFrom.toISOString().slice(0, 10),
            dateTo: e.dateTo.toISOString().slice(0, 10),
            kind: e.kind as 'closed' | 'custom_hours',
            intervals: e.intervals as Array<{ start: number; end: number }>,
          }),
        ),
    });
    const branchWindows = dayWindows(srcFor(null), date, branch.timezone);

    // Занятость: активные строки, кроме истёкших неосвобождённых резервов (они считаются свободными).
    const from = midnight.minus({ days: 1 }).toJSDate();
    const to = midnight.plus({ days: 2 }).toJSDate();
    const busyRows = resIds.length
      ? await db.$queryRaw<Array<{ resource_id: string; start_at: Date; end_at: Date }>>`
          SELECT ar.resource_id, ar.start_at, ar.end_at
          FROM appointment_resources ar
          JOIN appointments a ON a.id = ar.appointment_id
          LEFT JOIN booking_holds h ON h.appointment_id = a.id
          WHERE ar.is_active
            AND ar.resource_id = ANY(${resIds}::uuid[])
            AND ar.start_at < ${to} AND ar.end_at > ${from}
            AND NOT (a.status = 'pending_otp' AND h.released_at IS NULL AND h.expires_at <= now())
            AND (${opts.excludeAppointmentId ?? null}::uuid IS NULL OR ar.appointment_id <> ${opts.excludeAppointmentId ?? null}::uuid)
          ORDER BY ar.start_at`
      : [];

    const dayStart = midnight.toMillis();
    const dayEnd = midnight.plus({ days: 1 }).toMillis();
    const specialistPrices = new Map<string, number | null>();
    const specialistNames = new Map<string, string>();

    const resources: EngineResource[] = resRows.map((r) => {
      const busy = busyRows
        .filter((b) => b.resource_id === r.id)
        .map((b) => ({ start: b.start_at.getTime(), end: b.end_at.getTime() }));
      const load = busy.reduce((sum, b) => sum + Math.max(0, Math.min(b.end, dayEnd) - Math.max(b.start, dayStart)) / 60_000, 0);
      const own = dayWindows(srcFor(r.id), date, branch.timezone, branchWindows);
      let serviceSet: Set<string>;
      if (r.type === 'specialist' && r.specialist) {
        serviceSet = new Set(r.specialist.services.map((s) => s.serviceId));
        for (const s of r.specialist.services) specialistPrices.set(`${r.specialist.id}:${s.serviceId}`, s.priceOverride);
        specialistNames.set(r.specialist.id, r.specialist.name);
      } else {
        serviceSet = new Set(r.services.map((s) => s.serviceId));
      }
      return {
        id: r.id,
        type: r.type,
        specialistId: r.specialist?.id ?? null,
        name: r.name,
        sortOrder: r.sortOrder,
        serviceIds: serviceSet,
        available: intersect(own, branchWindows),
        busy,
        loadMinutes: load,
      };
    });

    return { branch, settings, services, resources, branchWindows, specialistPrices, specialistNames, date };
  }

  engineSettings(ctx: BookingContext, audience: 'public' | 'staff', now = new Date()): EngineSettings {
    const s = ctx.settings;
    return {
      slotIntervalMinutes: s.slotIntervalMinutes,
      multiServiceMode: s.multiServiceMode,
      loadBalancing: s.loadBalancing,
      earliestStart: now.getTime() + (audience === 'public' ? s.minLeadMinutes * 60_000 : 0),
      latestStart: now.getTime() + (audience === 'public' ? s.maxHorizonDays : 365) * 86400_000,
    };
  }

  /** Локальная дата филиала для момента времени. */
  static localDate(instant: Date, timezone: string): string {
    return DateTime.fromJSDate(instant, { zone: timezone }).toISODate()!;
  }

  slots(ctx: BookingContext, items: RequestItem[], audience: 'public' | 'staff', now = new Date()): SlotAssignment[] {
    return computeSlots({
      date: ctx.date,
      timezone: ctx.branch.timezone,
      branchWindows: ctx.branchWindows,
      services: ctx.services,
      resources: ctx.resources,
      items,
      settings: this.engineSettings(ctx, audience, now),
    });
  }

  /** Назначение на конкретное время с проверкой ограничений времени. */
  assignmentAt(ctx: BookingContext, items: RequestItem[], start: Date, audience: 'public' | 'staff', now = new Date()): SlotAssignment | null {
    const st = this.engineSettings(ctx, audience, now);
    const t = start.getTime();
    if (t < st.earliestStart) throw AppError.badRequest(audience === 'public' ? 'BOOKING_TOO_SOON' : 'VALIDATION_ERROR', 'Выбранное время слишком близко или уже прошло');
    if (t > st.latestStart) throw AppError.badRequest('BOOKING_TOO_FAR', 'Выбранная дата за пределами горизонта записи');
    // Время начала должно быть в сетке слотов
    const midnight = DateTime.fromISO(ctx.date, { zone: ctx.branch.timezone }).startOf('day').toMillis();
    if ((t - midnight) % (ctx.settings.slotIntervalMinutes * 60_000) !== 0) return null;
    if (!ctx.branchWindows.some((w) => w.start <= t && t < w.end)) return null;
    return findAssignment(t, ctx.services, ctx.resources, items, st);
  }
}
