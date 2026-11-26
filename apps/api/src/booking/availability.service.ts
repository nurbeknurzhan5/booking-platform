import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AppError, isUniqueViolation } from '../common/errors';
import {
  computeSlots,
  dayWindows,
  findAssignment,
  intersect,
  shiftWindows,
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

  /**
   * Настройки записи филиала; у нового филиала создаются со значениями по умолчанию.
   * Параллельные первые запросы не дают 500: при гонке вставки (23505) читается строка победителя.
   */
  async ensureSettings(db: Tx | PrismaService, branch: Pick<Branch, 'id' | 'organizationId'>): Promise<BookingSettings> {
    const found = await db.bookingSettings.findUnique({ where: { branchId: branch.id } });
    if (found) return found;
    try {
      return await db.bookingSettings.upsert({ where: { branchId: branch.id }, create: { branchId: branch.id, organizationId: branch.organizationId }, update: {} });
    } catch (e) {
      // В транзакции после ошибки повторный запрос невозможен — ошибку обработает вызывающий (повтор транзакции).
      if (!isUniqueViolation(e) || db !== this.prisma) throw e;
      return db.bookingSettings.findUniqueOrThrow({ where: { branchId: branch.id } });
    }
  }

  /** Полный контекст: настройки, каталог, расписания и занятость ресурсов. */
  async loadContext(db: Tx | PrismaService, branchId: string, date: string, items: RequestItem[], opts: LoadOptions): Promise<BookingContext> {
    const base = await this.loadStatic(db, branchId, date, items, opts);
    return this.withOccupancy(db, base, opts.excludeAppointmentId);
  }

  /**
   * Статическая часть контекста: филиал, настройки, услуги, ресурсы, расписания (без занятости).
   * Бронирование загружает её до блокировки филиала: эти данные меняются без этой блокировки,
   * поэтому чтение до неё даёт такой же снимок, а время под блокировкой сокращается.
   */
  async loadStatic(db: Tx | PrismaService, branchId: string, date: string, items: RequestItem[], opts: Pick<LoadOptions, 'audience'>): Promise<BookingContext> {
    // Вне транзакции — параллельно; внутри транзакции — последовательно (одно соединение).
    const parallel = db === this.prisma;
    const branch = await db.branch.findFirst({ where: { id: branchId, archivedAt: null } });
    if (!branch) throw AppError.notFound('Филиал');

    const serviceIds = [...new Set(items.map((i) => i.serviceId))];
    const loadSettings = () => this.ensureSettings(db, branch);
    const loadServices = () =>
      db.service.findMany({
        where: { id: { in: serviceIds }, organizationId: branch.organizationId, archivedAt: null, isActive: true },
        include: { requirements: true, branchServices: { where: { branchId, isActive: true } } },
      });
    const [settings, svcRows] = parallel ? await Promise.all([loadSettings(), loadServices()]) : [await loadSettings(), await loadServices()];
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
    const ownerFilter = { branchId, OR: [{ resourceId: null }, { resourceId: { in: resIds } }] };
    const q = [
      () => db.workingHours.findMany({ where: ownerFilter }),
      () => db.break.findMany({ where: ownerFilter }),
      () => db.scheduleException.findMany({ where: { ...ownerFilter, dateFrom: { lte: dateObj }, dateTo: { gte: dateObj } } }),
    ] as const;
    const [hours, breaks, exceptions] = parallel
      ? await Promise.all([q[0](), q[1](), q[2]()])
      : [await q[0](), await q[1](), await q[2]()];
    // Режим «по сменам» (задача 21): специалист работает только в назначенную на эту дату смену.
    const shiftsMode = settings.scheduleMode === 'shifts';
    const specialistResIds = resRows.filter((r) => r.type === 'specialist').map((r) => r.id);
    const shifts = shiftsMode && specialistResIds.length ? await db.staffShift.findMany({ where: { branchId, date: dateObj, resourceId: { in: specialistResIds } } }) : [];
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

    const specialistPrices = new Map<string, number | null>();
    const specialistNames = new Map<string, string>();

    const resources: EngineResource[] = resRows.map((r) => {
      let own = dayWindows(srcFor(r.id), date, branch.timezone, branchWindows);
      if (shiftsMode && r.type === 'specialist') {
        const shift = shifts.find((x) => x.resourceId === r.id);
        own = shift ? shiftWindows(shift, date, branch.timezone) : [];
      }
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
        busy: [],
        loadMinutes: 0,
      };
    });

    return { branch, settings, services, resources, branchWindows, specialistPrices, specialistNames, date };
  }

  /**
   * Занятость ресурсов на дату (±1 сутки): активные строки, кроме истёкших неосвобождённых резервов
   * (они считаются свободными). Внутри бронирования вызывается под блокировкой филиала.
   */
  async withOccupancy(db: Tx | PrismaService, base: BookingContext, excludeAppointmentId?: string): Promise<BookingContext> {
    const resIds = base.resources.map((r) => r.id);
    const midnight = DateTime.fromISO(base.date, { zone: base.branch.timezone }).startOf('day');
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
            AND (${excludeAppointmentId ?? null}::uuid IS NULL OR ar.appointment_id <> ${excludeAppointmentId ?? null}::uuid)
          ORDER BY ar.start_at`
      : [];
    const dayStart = midnight.toMillis();
    const dayEnd = midnight.plus({ days: 1 }).toMillis();
    const resources = base.resources.map((r) => {
      const busy = busyRows.filter((b) => b.resource_id === r.id).map((b) => ({ start: b.start_at.getTime(), end: b.end_at.getTime() }));
      const loadMinutes = busy.reduce((sum, b) => sum + Math.max(0, Math.min(b.end, dayEnd) - Math.max(b.start, dayStart)) / 60_000, 0);
      return { ...r, busy, loadMinutes };
    });
    return { ...base, resources };
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
