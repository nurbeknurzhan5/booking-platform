import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { z } from 'zod';
import {
  calculateVisitPrice,
  canTransition,
  NO_SHOW_CORRECTION_WINDOW_HOURS,
  resolvePublicAvailability,
  resolveServicePrice,
  computeSubscriptionStatus,
  validatePromoRules,
  type AppointmentStatus,
  type PromoCodeInput,
  type SaleOffer,
  type StatusActor,
  CreateHoldSchema,
  ManualAppointmentSchema,
} from '@booking/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AppError, isExclusionViolation, isTransientTxError } from '../common/errors';
import { randomToken, sha256 } from '../common/crypto';
import { OtpService } from '../auth/otp.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../common/audit.service';
import { getConfig } from '../config/config';
import { AvailabilityService, type BookingContext } from './availability.service';
import type { RequestItem, SlotAssignment } from './engine';
import type { ActorContext } from '../common/request-context';
import type { Prisma } from '../generated/prisma/client';

type CreateHoldInput = z.infer<typeof CreateHoldSchema>;
type ManualInput = z.infer<typeof ManualAppointmentSchema>;

const CONSENT_TEXT_VERSION = '2026-11-v1';
const MAX_CONFLICT_RETRIES = 3;

const APPOINTMENT_INCLUDE = {
  items: { orderBy: { position: 'asc' as const } },
  branch: { select: { id: true, name: true, slug: true, address: true, phone: true, timezone: true, organizationId: true } },
  client: { select: { id: true, name: true, phone: true } },
  hold: { select: { expiresAt: true, releasedAt: true, extensionCount: true } },
  review: { select: { id: true, rating: true } },
} satisfies Prisma.AppointmentInclude;

type AppointmentFull = Prisma.AppointmentGetPayload<{ include: typeof APPOINTMENT_INCLUDE }>;
type SaleRow = Prisma.PromotionGetPayload<object>;

interface PricedPlan {
  assignment: SlotAssignment;
  items: Array<{
    position: number;
    serviceId: string;
    serviceName: string;
    specialistId: string | null;
    specialistName: string | null;
    startAt: Date;
    endAt: Date;
    durationMinutes: number;
    bufferBefore: number;
    bufferAfter: number;
    basePrice: number;
    saleDiscount: number;
    salePromotionId: string | null;
    promoDiscount: number;
    finalPrice: number;
    resources: Array<{ resourceId: string; startAt: Date; endAt: Date }>;
  }>;
  baseTotal: number;
  saleDiscountTotal: number;
  promoDiscountTotal: number;
  totalPrice: number;
  promotionId: string | null;
  promoCode: string | null;
}

/**
 * Ядро бронирования (§8). Проверка доступности и создание резерва — одна транзакция;
 * двойное бронирование исключено EXCLUDE-ограничением в БД.
 */
@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly otp: OtpService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  // =====================================================================
  // Публичный контекст филиала
  // =====================================================================

  /** Филиал по постоянной ссылке + итоговая доступность записи (§2.4). */
  async publicBranch(slug: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { slug, archivedAt: null, organization: { archivedAt: null } },
      include: { page: true, organization: { include: { subscription: true } } },
    });
    if (!branch || !branch.page) throw AppError.notFound('Страница');
    const subscriptionStatus = computeSubscriptionStatus(branch.organization.subscription ?? null, new Date());
    const availability = resolvePublicAvailability({
      subscriptionStatus,
      pageStatus: branch.page.status,
      moderationBlocked: branch.page.moderationBlocked,
      hasPublication: !!branch.page.publishedPublicationId,
    });
    return { branch, availability, subscriptionStatus };
  }

  async assertPublicBookingAllowed(slug: string) {
    const r = await this.publicBranch(slug);
    if (!r.availability.visible) throw AppError.notFound('Страница');
    const settings = await this.prisma.bookingSettings.findUnique({ where: { branchId: r.branch.id } });
    if (!r.availability.bookingEnabled || settings?.onlineBookingEnabled === false) {
      throw new AppError('BOOKING_DISABLED', HttpStatus.FORBIDDEN, 'Онлайн-запись в этом филиале сейчас недоступна', {
        reason: r.availability.reason ?? 'online_booking_disabled',
      });
    }
    return r.branch;
  }

  // =====================================================================
  // Слоты
  // =====================================================================

  async searchSlots(branchId: string, date: string, items: RequestItem[], audience: 'public' | 'staff', excludeAppointmentId?: string) {
    const ctx = await this.availability.loadContext(this.prisma, branchId, date, items, { audience, excludeAppointmentId });
    this.assertSpecialistsValid(ctx, items);
    const slots = this.availability.slots(ctx, items, audience);
    return {
      date,
      timezone: ctx.branch.timezone,
      slots: slots.map((s) => ({
        startAt: new Date(s.start).toISOString(),
        endAt: new Date(s.end).toISOString(),
        items: s.items.map((i) => ({
          serviceId: i.serviceId,
          specialistId: i.specialistId,
          specialistName: i.specialistId ? (ctx.specialistNames.get(i.specialistId) ?? null) : null,
          startAt: new Date(i.start).toISOString(),
          endAt: new Date(i.end).toISOString(),
        })),
      })),
    };
  }

  assertSpecialistsValid(ctx: BookingContext, items: RequestItem[]) {
    for (const it of items) {
      if (it.specialistId && !ctx.resources.some((r) => r.specialistId === it.specialistId && r.serviceIds.has(it.serviceId))) {
        throw AppError.badRequest('VALIDATION_ERROR', 'Выбранный специалист не оказывает эту услугу в филиале');
      }
    }
  }

  // =====================================================================
  // Цена
  // =====================================================================

  private async activeSales(db: Tx | PrismaService, organizationId: string, branchId: string, now: Date) {
    const rows = await db.promotion.findMany({
      where: {
        organizationId,
        kind: 'sale',
        isActive: true,
        archivedAt: null,
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
    });
    return rows.filter((p) => p.allBranches || p.branchIds.includes(branchId));
  }

  /** Расчёт цены визита по назначению (snapshot, §5, §12). */
  private async priceAssignment(
    db: Tx | PrismaService,
    ctx: BookingContext,
    assignment: SlotAssignment,
    promo: { code?: string; clientId?: string | null; lock: boolean },
    now: Date,
    preloadedSales?: SaleRow[],
  ): Promise<PricedPlan> {
    const sales = preloadedSales ?? (await this.activeSales(db, ctx.branch.organizationId, ctx.branch.id, now));
    const priceItems = assignment.items.map((it) => {
      const svc = ctx.services.find((s) => s.id === it.serviceId)!;
      const basePrice = resolveServicePrice({
        servicePrice: svc.basePrice,
        branchPrice: svc.branchPrice,
        specialistPrice: it.specialistId ? (ctx.specialistPrices.get(`${it.specialistId}:${it.serviceId}`) ?? null) : null,
        specialistPricingEnabled: ctx.settings.specialistPricingEnabled,
      });
      const itemSales: SaleOffer[] = sales
        .filter((s) => s.allServices || s.serviceIds.includes(it.serviceId))
        .map((s) => ({ promotionId: s.id, discountType: s.discountType, value: s.discountValue }));
      return { key: String(it.position), serviceId: it.serviceId, basePrice, sales: itemSales };
    });

    let promoInput: PromoCodeInput | null = null;
    let promotionId: string | null = null;
    if (promo.code) {
      const code = promo.code.trim().toUpperCase();
      const found = await db.promotion.findFirst({
        where: { organizationId: ctx.branch.organizationId, code, kind: 'promo_code', archivedAt: null },
      });
      if (!found) throw AppError.badRequest('PROMO_INVALID', 'Промокод не найден', { reason: 'PROMO_NOT_FOUND' });
      if (promo.lock) {
        // Сериализация лимитов использования промокода.
        await db.$queryRaw`SELECT id FROM promotions WHERE id = ${found.id}::uuid FOR UPDATE`;
      }
      // Последовательно: внутри транзакции одно соединение.
      const usedTotal = await db.promotionRedemption.count({ where: { promotionId: found.id, status: { in: ['reserved', 'applied'] } } });
      const usedByClient = promo.clientId
        ? await db.promotionRedemption.count({ where: { promotionId: found.id, clientId: promo.clientId, status: { in: ['reserved', 'applied'] } } })
        : 0;
      const err = validatePromoRules(
        {
          isActive: found.isActive,
          startsAt: found.startsAt,
          endsAt: found.endsAt,
          branchIds: found.allBranches ? null : found.branchIds,
          usageLimit: found.usageLimit,
          perClientLimit: found.perClientLimit,
        },
        { now, branchId: ctx.branch.id, usedTotal, usedByClient },
      );
      if (err) throw AppError.badRequest('PROMO_INVALID', 'Промокод недействителен', { reason: err });
      promoInput = {
        promotionId: found.id,
        code,
        discountType: found.discountType,
        value: found.discountValue,
        minAmount: found.minAmount,
        serviceIds: found.allServices ? null : found.serviceIds,
      };
      promotionId = found.id;
    }

    const price = calculateVisitPrice(priceItems, promoInput);
    if (promoInput && price.promoError) {
      throw AppError.badRequest('PROMO_INVALID', 'Промокод неприменим к выбранным услугам', { reason: price.promoError, minAmount: promoInput.minAmount });
    }

    return {
      assignment,
      items: assignment.items.map((it) => {
        const svc = ctx.services.find((s) => s.id === it.serviceId)!;
        const p = price.items.find((x) => x.key === String(it.position))!;
        const resIds = [...(it.specialistResourceId ? [it.specialistResourceId] : []), ...it.resourceIds];
        return {
          position: it.position,
          serviceId: it.serviceId,
          serviceName: svc.name,
          specialistId: it.specialistId,
          specialistName: it.specialistId ? (ctx.specialistNames.get(it.specialistId) ?? null) : null,
          startAt: new Date(it.start),
          endAt: new Date(it.end),
          durationMinutes: svc.durationMinutes,
          bufferBefore: svc.bufferBeforeMinutes,
          bufferAfter: svc.bufferAfterMinutes,
          basePrice: p.basePrice,
          saleDiscount: p.saleDiscount,
          salePromotionId: p.salePromotionId,
          promoDiscount: p.promoDiscount,
          finalPrice: p.finalPrice,
          resources: resIds.map((resourceId) => ({ resourceId, startAt: new Date(it.occupancy.start), endAt: new Date(it.occupancy.end) })),
        };
      }),
      baseTotal: price.baseTotal,
      saleDiscountTotal: price.saleDiscountTotal,
      promoDiscountTotal: price.promoDiscountTotal,
      totalPrice: price.total,
      promotionId,
      promoCode: promoInput?.code ?? null,
    };
  }

  /** Предварительный расчёт стоимости и длительности (без резерва). */
  async quote(branchId: string, items: RequestItem[], promoCode: string | undefined, audience: 'public' | 'staff') {
    const today = AvailabilityService.localDate(new Date(), (await this.prisma.branch.findUniqueOrThrow({ where: { id: branchId } })).timezone);
    const ctx = await this.availability.loadContext(this.prisma, branchId, today, items, { audience });
    this.assertSpecialistsValid(ctx, items);
    // Для расчёта используем «виртуальное» назначение без проверки занятости.
    let cursor = 0;
    const virtual: SlotAssignment = {
      start: 0,
      end: 0,
      items: items.map((it, idx) => {
        const svc = ctx.services.find((s) => s.id === it.serviceId)!;
        const start = ctx.settings.multiServiceMode === 'parallel' ? 0 : cursor;
        const end = start + svc.durationMinutes * 60_000;
        cursor = end + (svc.bufferAfterMinutes ?? 0) * 60_000;
        return { position: idx, serviceId: it.serviceId, start, end, occupancy: { start, end }, specialistId: it.specialistId ?? null, specialistResourceId: null, resourceIds: [] };
      }),
    };
    virtual.end = Math.max(...virtual.items.map((i) => i.end));
    const priced = await this.priceAssignment(this.prisma, ctx, virtual, { code: promoCode, lock: false }, new Date());
    return {
      durationMinutes: Math.round(virtual.end / 60_000),
      baseTotal: priced.baseTotal,
      saleDiscountTotal: priced.saleDiscountTotal,
      promoDiscountTotal: priced.promoDiscountTotal,
      totalPrice: priced.totalPrice,
      currency: 'KZT',
      items: priced.items.map((i) => ({ serviceId: i.serviceId, serviceName: i.serviceName, basePrice: i.basePrice, finalPrice: i.finalPrice })),
    };
  }

  // =====================================================================
  // Общие части транзакций
  // =====================================================================

  async lockClientKey(tx: Tx, organizationId: string, phone: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`client:${organizationId}:${phone}`}, 0))`;
  }

  /**
   * Сериализация бронирований филиала: движок видит зафиксированное состояние, автоподбор детерминирован,
   * исключены взаимоблокировки параллельных вставок в EXCLUDE-индекс. Порядок блокировок: клиент → филиал.
   * EXCLUDE-ограничение остаётся последней линией защиты.
   */
  private async lockBranch(tx: Tx, branchId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking-branch:${branchId}`}, 0))`;
  }

  async findOrCreateClient(tx: Tx, organizationId: string, phone: string, name: string, locale: string) {
    const existing = await tx.client.findFirst({ where: { organizationId, phone, mergedIntoId: null } });
    if (existing) return existing;
    const user = await tx.user.findUnique({ where: { phone }, select: { id: true, phoneVerifiedAt: true } });
    return tx.client.create({
      data: { organizationId, phone, name, locale, userId: user?.phoneVerifiedAt ? user.id : null },
    });
  }

  /** Лимиты клиента (§8.9): количество активных записей и пересечения по времени. */
  private async assertClientLimits(
    tx: Tx,
    clientId: string,
    settings: BookingContext['settings'],
    start: Date,
    end: Date,
    opts: { excludeAppointmentId?: string; skip: boolean },
  ) {
    if (opts.skip) return;
    const now = new Date();
    const active = await tx.appointment.findMany({
      where: {
        clientId,
        ...(opts.excludeAppointmentId ? { id: { not: opts.excludeAppointmentId } } : {}),
        OR: [
          { status: 'confirmed', endAt: { gt: now } },
          { status: 'pending_otp', hold: { releasedAt: null, expiresAt: { gt: now } } },
        ],
      },
      select: { id: true, startAt: true, endAt: true },
    });
    if (active.length > 0 && !settings.allowRebookWithActive) {
      throw AppError.unprocessable('CLIENT_ACTIVE_LIMIT', 'У вас уже есть активная запись в этом филиале');
    }
    if (active.length >= settings.maxActiveAppointmentsPerClient) {
      throw AppError.unprocessable('CLIENT_ACTIVE_LIMIT', `Достигнут лимит активных записей (${settings.maxActiveAppointmentsPerClient})`);
    }
    if (active.some((a) => a.startAt < end && start < a.endAt)) {
      throw AppError.unprocessable('CLIENT_OVERLAP', 'У вас уже есть запись на это время');
    }
  }

  private async insertPlan(tx: Tx, organizationId: string, appointmentId: string, plan: PricedPlan) {
    for (const it of plan.items) {
      const item = await tx.appointmentItem.create({
        data: {
          organizationId,
          appointmentId,
          serviceId: it.serviceId,
          specialistId: it.specialistId,
          position: it.position,
          startAt: it.startAt,
          endAt: it.endAt,
          durationMinutes: it.durationMinutes,
          bufferBeforeMinutes: it.bufferBefore,
          bufferAfterMinutes: it.bufferAfter,
          serviceNameSnapshot: it.serviceName,
          specialistNameSnapshot: it.specialistName,
          basePrice: it.basePrice,
          saleDiscount: it.saleDiscount,
          salePromotionId: it.salePromotionId,
          promoDiscount: it.promoDiscount,
          finalPrice: it.finalPrice,
        },
      });
      // Атомарное назначение всех ресурсов (§6.1): при пересечении — 23P01 и откат всей транзакции.
      await tx.appointmentResource.createMany({
        data: it.resources.map((r) => ({ organizationId, appointmentId, appointmentItemId: item.id, resourceId: r.resourceId, startAt: r.startAt, endAt: r.endAt })),
      });
    }
  }

  private async history(tx: Tx, organizationId: string, appointmentId: string, from: AppointmentStatus | null, to: AppointmentStatus, actor: ActorContext, reason?: string) {
    await tx.appointmentStatusHistory.create({
      data: {
        organizationId,
        appointmentId,
        fromStatus: from,
        toStatus: to,
        actorType: actor.actorType,
        actorUserId: actor.userId,
        reason,
      },
    });
  }

  private async withConflictRetry<T>(fn: () => Promise<T>, retryable: boolean): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (isExclusionViolation(e)) {
          if (retryable && attempt < MAX_CONFLICT_RETRIES) continue; // при автоподборе пробуем другого исполнителя
          throw AppError.slotUnavailable();
        }
        if (isTransientTxError(e)) {
          // Взаимоблокировка / конфликт сериализации: транзакция откатилась целиком — безопасно повторить.
          if (attempt < MAX_CONFLICT_RETRIES + 2) continue;
          throw AppError.slotUnavailable();
        }
        throw e;
      }
    }
  }

  private notificationParams(a: { startAt: Date; locale: string; totalPrice: number }, branch: { name: string; timezone: string }, extra: Record<string, string>) {
    const dt = DateTime.fromJSDate(a.startAt, { zone: branch.timezone }).setLocale(a.locale === 'kk' ? 'kk' : a.locale === 'en' ? 'en' : 'ru');
    return {
      branchName: branch.name,
      date: dt.toFormat('d MMMM yyyy'),
      time: dt.toFormat('HH:mm'),
      total: a.totalPrice.toLocaleString('ru-RU'),
      ...extra,
    };
  }

  private manageUrl(token: string, locale: string) {
    return `${getConfig().PUBLIC_BASE_URL}/${locale}/manage/${token}`;
  }

  /**
   * Освободившееся время для листа ожидания (§9). Фиксируется в транзакции отмены/переноса,
   * подбор клиентов и рассылку предложений выполняет воркер (WaitlistService.processReleases).
   */
  private async recordFreedSlot(
    tx: Tx,
    a: { id: string; organizationId: string; branchId: string; startAt: Date; endAt: Date },
    resourceIds: string[],
    waitlistEnabled: boolean,
  ) {
    if (!waitlistEnabled || a.startAt.getTime() <= Date.now() || resourceIds.length === 0) return;
    await tx.waitlistRelease.create({
      data: { organizationId: a.organizationId, branchId: a.branchId, sourceAppointmentId: a.id, startAt: a.startAt, endAt: a.endAt, resourceIds: [...new Set(resourceIds)] },
    });
  }

  private async activeResourceIds(tx: Tx, appointmentId: string): Promise<string[]> {
    const rows = await tx.appointmentResource.findMany({ where: { appointmentId, isActive: true }, select: { resourceId: true } });
    return rows.map((r) => r.resourceId);
  }

  /**
   * Запись по предложению из листа ожидания (§9) — сразу confirmed: ссылка с секретным токеном пришла
   * на номер клиента, владение номером подтверждено так же, как для ссылки управления (D-11).
   * `guard` выполняется под блокировками клиента и филиала и проверяет, что предложение ещё действует;
   * `onBooked` в той же транзакции закрывает остальные предложения. Двойное назначение исключают
   * сериализация филиала, EXCLUDE-ограничение и уникальный индекс принятого предложения.
   */
  async createFromWaitlist(
    args: { branchId: string; clientId: string; startAt: Date; items: RequestItem[]; locale: string; ip: string | null },
    guard: (tx: Tx) => Promise<void>,
    onBooked: (tx: Tx, appointmentId: string) => Promise<void>,
  ) {
    const branch = await this.prisma.branch.findFirst({ where: { id: args.branchId, archivedAt: null } });
    if (!branch) throw AppError.notFound('Филиал');
    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: args.clientId } });
    const date = AvailabilityService.localDate(args.startAt, branch.timezone);
    const autoAssign = args.items.some((i) => !i.specialistId);
    const manageToken = randomToken(32);
    const [base, sales] = await Promise.all([
      this.availability.loadStatic(this.prisma, branch.id, date, args.items, { audience: 'public' }),
      this.activeSales(this.prisma, branch.organizationId, branch.id, new Date()),
    ]);
    const appointment = await this.withConflictRetry(
      () =>
        this.prisma.$transaction(async (tx) => {
          const organizationId = branch.organizationId;
          await this.lockClientKey(tx, organizationId, client.phone);
          await this.lockBranch(tx, branch.id);
          await guard(tx);
          await this.releaseExpiredHolds(tx, { organizationId });
          const ctx = await this.availability.withOccupancy(tx, base);
          const assignment = this.availability.assignmentAt(ctx, args.items, args.startAt, 'public');
          if (!assignment) throw AppError.slotUnavailable();
          await this.assertClientLimits(tx, client.id, ctx.settings, new Date(assignment.start), new Date(assignment.end), { skip: false });
          const plan = await this.priceAssignment(tx, ctx, assignment, { clientId: client.id, lock: false }, new Date(), sales);
          const appt = await tx.appointment.create({
            data: {
              organizationId,
              branchId: branch.id,
              clientId: client.id,
              status: 'confirmed',
              confirmedAt: new Date(),
              startAt: new Date(assignment.start),
              endAt: new Date(assignment.end),
              timezone: branch.timezone,
              source: 'waitlist',
              locale: args.locale,
              baseTotal: plan.baseTotal,
              saleDiscountTotal: plan.saleDiscountTotal,
              promoDiscountTotal: plan.promoDiscountTotal,
              totalPrice: plan.totalPrice,
              manageTokenHash: sha256(manageToken),
            },
          });
          await this.insertPlan(tx, organizationId, appt.id, plan);
          await this.history(tx, organizationId, appt.id, null, 'confirmed', { userId: null, actorType: 'client', ip: args.ip, userAgent: null }, 'Запись из листа ожидания');
          const full = await tx.appointment.findUniqueOrThrow({ where: { id: appt.id }, include: APPOINTMENT_INCLUDE });
          await this.notifications.enqueue(tx, {
            organizationId,
            type: 'appointment_confirmed',
            eventKey: `appointment:${appt.id}:confirmed`,
            recipient: client.phone,
            locale: full.locale,
            params: this.notificationParams(full, full.branch, {
              clientName: client.name,
              services: full.items.map((i) => i.serviceNameSnapshot).join(', '),
              manageUrl: this.manageUrl(manageToken, full.locale),
            }),
            appointmentId: appt.id,
            clientId: client.id,
          });
          await onBooked(tx, appt.id);
          return this.toView(full, ctx.settings);
        }),
      autoAssign,
    );
    return { appointment, manageToken };
  }

  // =====================================================================
  // Временный резерв (§8.1, §8.3, §8.4)
  // =====================================================================

  async createHold(slug: string, input: CreateHoldInput, ip: string) {
    const branch = await this.assertPublicBookingAllowed(slug);
    if (input.formElapsedMs !== undefined && input.formElapsedMs < 1500) {
      throw AppError.badRequest('VALIDATION_ERROR', 'Форма заполнена слишком быстро. Попробуйте ещё раз.');
    }
    await this.otp.assertCanSend(input.client.phone, 'booking', ip);
    const startAt = new Date(input.startAt);
    const date = AvailabilityService.localDate(startAt, branch.timezone);
    const autoAssign = input.items.some((i) => !i.specialistId);
    const organizationId = branch.organizationId;
    // Каталог, расписания и акции — до транзакции и параллельно (см. AvailabilityService.loadStatic).
    const [base, sales] = await Promise.all([
      this.availability.loadStatic(this.prisma, branch.id, date, input.items, { audience: 'public' }),
      this.activeSales(this.prisma, organizationId, branch.id, new Date()),
    ]);
    this.assertSpecialistsValid(base, input.items);

    const created = await this.withConflictRetry(
      () =>
        this.prisma.$transaction(async (tx) => {
          await this.lockClientKey(tx, organizationId, input.client.phone);
          // Под блокировкой клиента, но до блокировки филиала: от слота не зависит.
          const client = await this.findOrCreateClient(tx, organizationId, input.client.phone, input.client.name, input.locale);
          const consents: Array<[string, boolean]> = [
            ['personal_data', true],
            ['notifications', input.consents.notifications],
            ['whatsapp', input.consents.whatsapp],
          ];
          await tx.clientConsent.createMany({
            data: consents.map(([consentType, granted]) => ({
              organizationId,
              clientId: client.id,
              phone: input.client.phone,
              consentType,
              granted,
              textVersion: CONSENT_TEXT_VERSION,
              source: 'booking_form',
              ip,
            })),
          });

          // Под блокировкой филиала — только занятость, проверки и вставки.
          await this.lockBranch(tx, branch.id);
          await this.releaseExpiredHolds(tx, { organizationId });
          const ctx = await this.availability.withOccupancy(tx, base);
          const assignment = this.availability.assignmentAt(ctx, input.items, startAt, 'public');
          if (!assignment) throw AppError.slotUnavailable();
          await this.assertClientLimits(tx, client.id, ctx.settings, new Date(assignment.start), new Date(assignment.end), { skip: false });
          const now = new Date();
          const plan = await this.priceAssignment(tx, ctx, assignment, { code: input.promoCode, clientId: client.id, lock: true }, now, sales);

          const appointment = await tx.appointment.create({
            data: {
              organizationId,
              branchId: branch.id,
              clientId: client.id,
              status: 'pending_otp',
              startAt: new Date(assignment.start),
              endAt: new Date(assignment.end),
              timezone: branch.timezone,
              source: 'online',
              locale: input.locale,
              comment: input.comment,
              baseTotal: plan.baseTotal,
              saleDiscountTotal: plan.saleDiscountTotal,
              promoDiscountTotal: plan.promoDiscountTotal,
              totalPrice: plan.totalPrice,
              promoCode: plan.promoCode,
              promotionId: plan.promotionId,
              visitorSession: input.visitorSession,
              utm: (input.utm as Prisma.InputJsonValue) ?? undefined,
            },
          });
          await this.insertPlan(tx, organizationId, appointment.id, plan);
          await this.history(tx, organizationId, appointment.id, null, 'pending_otp', { userId: null, actorType: 'client', ip, userAgent: null });

          const holdToken = randomToken(32);
          const hold = await tx.bookingHold.create({
            data: {
              organizationId,
              appointmentId: appointment.id,
              tokenHash: sha256(holdToken),
              phone: input.client.phone,
              expiresAt: new Date(now.getTime() + ctx.settings.holdMinutes * 60_000),
              ip,
            },
          });
          if (plan.promotionId) {
            await tx.promotionRedemption.create({
              data: { organizationId, promotionId: plan.promotionId, appointmentId: appointment.id, clientId: client.id, discountAmount: plan.promoDiscountTotal, status: 'reserved' },
            });
          }

          // Новая запись: прежних кодов по ней нет, инвалидировать нечего.
          const issued = await this.otp.issue(tx, { phone: input.client.phone, purpose: 'booking', appointmentId: appointment.id, ip, fresh: true });
          await this.notifications.enqueue(tx, {
            organizationId,
            type: 'otp',
            eventKey: `otp:${issued.otpId}`,
            recipient: input.client.phone,
            locale: input.locale,
            params: { code: issued.code, minutes: String(Math.round((issued.expiresAt.getTime() - Date.now()) / 60_000)) },
            sensitive: true,
            expiresAt: issued.expiresAt,
            appointmentId: appointment.id,
            clientId: client.id,
          });
          return { appointmentId: appointment.id, holdToken, holdExpiresAt: hold.expiresAt, otpExpiresAt: issued.expiresAt };
        }),
      autoAssign,
    );
    // Представление читается после фиксации — вне блокировки филиала.
    const full = await this.prisma.appointment.findUniqueOrThrow({ where: { id: created.appointmentId }, include: APPOINTMENT_INCLUDE });
    return {
      appointmentId: created.appointmentId,
      holdToken: created.holdToken,
      holdExpiresAt: created.holdExpiresAt.toISOString(),
      otpExpiresAt: created.otpExpiresAt.toISOString(),
      appointment: this.toView(full, base.settings),
    };
  }

  private async loadHold(appointmentId: string, holdToken: string) {
    const hold = await this.prisma.bookingHold.findUnique({ where: { appointmentId }, include: { appointment: true } });
    if (!hold || hold.tokenHash !== sha256(holdToken)) throw AppError.notFound('Резерв');
    return hold;
  }

  /** Подтверждение OTP → confirmed (§8.1 п.10–13). */
  async confirmHold(appointmentId: string, holdToken: string, code: string, ip: string) {
    const hold = await this.loadHold(appointmentId, holdToken);
    if (hold.releasedAt) {
      if (hold.releaseReason === 'confirmed') throw AppError.conflict('Запись уже подтверждена');
      throw AppError.badRequest('HOLD_EXPIRED', 'Время резерва истекло. Выберите время заново.');
    }
    if (hold.expiresAt.getTime() <= Date.now()) {
      await this.prisma.$transaction((tx) => this.releaseExpiredHolds(tx, { appointmentId }));
      throw AppError.badRequest('HOLD_EXPIRED', 'Время резерва истекло. Выберите время заново.');
    }
    await this.otp.verify({ phone: hold.phone, purpose: 'booking', code, appointmentId });

    const manageToken = randomToken(32);
    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ released_at: Date | null; expires_at: Date }>>`
        SELECT released_at, expires_at FROM booking_holds WHERE appointment_id = ${appointmentId}::uuid FOR UPDATE`;
      const h = locked[0];
      if (!h || h.released_at || h.expires_at.getTime() <= Date.now()) {
        throw AppError.badRequest('HOLD_EXPIRED', 'Время резерва истекло. Выберите время заново.');
      }
      const appt = await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: 'confirmed', confirmedAt: new Date(), manageTokenHash: sha256(manageToken) },
        include: APPOINTMENT_INCLUDE,
      });
      await tx.bookingHold.update({ where: { appointmentId }, data: { releasedAt: new Date(), releaseReason: 'confirmed' } });
      await this.history(tx, appt.organizationId, appointmentId, 'pending_otp', 'confirmed', { userId: null, actorType: 'system', ip, userAgent: null }, 'OTP подтверждён');
      await tx.promotionRedemption.updateMany({ where: { appointmentId, status: 'reserved' }, data: { status: 'applied' } });
      // Привязка к платформенному профилю, если номер уже зарегистрирован (§10).
      const user = await tx.user.findUnique({ where: { phone: hold.phone }, select: { id: true } });
      if (user) await tx.client.updateMany({ where: { id: appt.clientId, userId: null }, data: { userId: user.id } });

      await this.notifications.enqueue(tx, {
        organizationId: appt.organizationId,
        type: 'appointment_confirmed',
        eventKey: `appointment:${appointmentId}:confirmed`,
        recipient: hold.phone,
        locale: appt.locale,
        params: this.notificationParams(appt, appt.branch, {
          clientName: appt.client.name,
          services: appt.items.map((i) => i.serviceNameSnapshot).join(', '),
          manageUrl: this.manageUrl(manageToken, appt.locale),
        }),
        appointmentId,
        clientId: appt.clientId,
      });
      await tx.analyticsEvent.create({
        data: {
          organizationId: appt.organizationId,
          branchId: appt.branchId,
          type: 'booking_completed',
          visitorHash: sha256(`appt:${appt.visitorSession ?? appointmentId}`),
          sessionId: appt.visitorSession,
          appointmentId,
          serviceIds: appt.items.map((i) => i.serviceId),
          ...this.utmColumns(appt.utm),
        },
      });
      const settings = await tx.bookingSettings.findUniqueOrThrow({ where: { branchId: appt.branchId } });
      return this.toView(appt, settings);
    });
    return { appointment: result, manageToken };
  }

  private utmColumns(utm: Prisma.JsonValue | null) {
    const u = (utm ?? {}) as Record<string, string | undefined>;
    return { utmSource: u.source ?? null, utmMedium: u.medium ?? null, utmCampaign: u.campaign ?? null, utmTerm: u.term ?? null, utmContent: u.content ?? null };
  }

  async resendOtp(appointmentId: string, holdToken: string, ip: string) {
    const hold = await this.loadHold(appointmentId, holdToken);
    if (hold.releasedAt || hold.expiresAt.getTime() <= Date.now()) throw AppError.badRequest('HOLD_EXPIRED', 'Время резерва истекло');
    await this.otp.assertCanSend(hold.phone, 'booking', ip);
    const issued = await this.prisma.$transaction(async (tx) => {
      const i = await this.otp.issue(tx, { phone: hold.phone, purpose: 'booking', appointmentId, ip });
      await this.notifications.enqueue(tx, {
        organizationId: hold.organizationId,
        type: 'otp',
        eventKey: `otp:${i.otpId}`,
        recipient: hold.phone,
        locale: hold.appointment.locale,
        params: { code: i.code, minutes: String(Math.round((i.expiresAt.getTime() - Date.now()) / 60_000)) },
        sensitive: true,
        expiresAt: i.expiresAt,
        appointmentId,
      });
      return i;
    });
    return { otpExpiresAt: issued.expiresAt.toISOString() };
  }

  /** Продление резерва (D-16): один раз, если разрешено владельцем. */
  async extendHold(appointmentId: string, holdToken: string) {
    const hold = await this.loadHold(appointmentId, holdToken);
    if (hold.releasedAt || hold.expiresAt.getTime() <= Date.now()) throw AppError.badRequest('HOLD_EXPIRED', 'Время резерва истекло');
    const settings = await this.prisma.bookingSettings.findUniqueOrThrow({ where: { branchId: hold.appointment.branchId } });
    if (!settings.holdExtensionAllowed || hold.extensionCount >= 1) {
      throw AppError.unprocessable('HOLD_EXTENSION_NOT_ALLOWED', 'Продление резерва недоступно');
    }
    const r = await this.prisma.bookingHold.updateMany({
      where: { appointmentId, releasedAt: null, extensionCount: hold.extensionCount, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date(Date.now() + settings.holdMinutes * 60_000), extensionCount: { increment: 1 } },
    });
    if (r.count !== 1) throw AppError.unprocessable('HOLD_EXTENSION_NOT_ALLOWED', 'Продление резерва недоступно');
    const h = await this.prisma.bookingHold.findUniqueOrThrow({ where: { appointmentId } });
    return { holdExpiresAt: h.expiresAt.toISOString() };
  }

  /** Клиент отказался от резерва — слот освобождается сразу. */
  async abandonHold(appointmentId: string, holdToken: string, ip: string) {
    await this.loadHold(appointmentId, holdToken);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.bookingHold.updateMany({ where: { appointmentId, releasedAt: null }, data: { releasedAt: new Date(), releaseReason: 'abandoned' } });
      if (r.count === 0) return;
      const a = await tx.appointment.update({ where: { id: appointmentId }, data: { status: 'cancelled_by_client', cancelledAt: new Date() } });
      await tx.appointmentResource.updateMany({ where: { appointmentId }, data: { isActive: false } });
      await tx.promotionRedemption.updateMany({ where: { appointmentId }, data: { status: 'released' } });
      await tx.otpCode.updateMany({ where: { appointmentId, consumedAt: null }, data: { invalidatedAt: new Date() } });
      await this.history(tx, a.organizationId, appointmentId, 'pending_otp', 'cancelled_by_client', { userId: null, actorType: 'client', ip, userAgent: null }, 'Резерв отменён клиентом');
    });
  }

  /**
   * Освобождение истёкших резервов (§8.3): запись → expired_otp, ресурсы освобождаются.
   * Вызывается фоновым воркером и внутри транзакций бронирования. SKIP LOCKED — без конкуренции воркеров.
   */
  async releaseExpiredHolds(tx: Tx, scope: { organizationId?: string; appointmentId?: string } = {}, limit = 200): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ appointment_id: string; organization_id: string }>>`
      WITH expired AS (
        SELECT id FROM booking_holds
        WHERE released_at IS NULL AND expires_at <= now()
          AND (${scope.organizationId ?? null}::uuid IS NULL OR organization_id = ${scope.organizationId ?? null}::uuid)
          AND (${scope.appointmentId ?? null}::uuid IS NULL OR appointment_id = ${scope.appointmentId ?? null}::uuid)
        ORDER BY expires_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE booking_holds h SET released_at = now(), release_reason = 'expired', updated_at = now()
      FROM expired WHERE h.id = expired.id
      RETURNING h.appointment_id, h.organization_id`;
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.appointment_id);
    await tx.appointmentResource.updateMany({ where: { appointmentId: { in: ids } }, data: { isActive: false } });
    await tx.appointment.updateMany({ where: { id: { in: ids }, status: 'pending_otp' }, data: { status: 'expired_otp' } });
    await tx.promotionRedemption.updateMany({ where: { appointmentId: { in: ids } }, data: { status: 'released' } });
    await tx.otpCode.updateMany({ where: { appointmentId: { in: ids }, consumedAt: null }, data: { invalidatedAt: new Date() } });
    await tx.appointmentStatusHistory.createMany({
      data: rows.map((r) => ({
        organizationId: r.organization_id,
        appointmentId: r.appointment_id,
        fromStatus: 'pending_otp' as const,
        toStatus: 'expired_otp' as const,
        actorType: 'system',
        reason: 'Истёк срок подтверждения OTP',
      })),
    });
    return rows.length;
  }

  // =====================================================================
  // Ручная запись администратором (§3.2)
  // =====================================================================

  async createManual(organizationId: string, input: ManualInput, actor: ActorContext) {
    const branch = await this.prisma.branch.findFirst({ where: { id: input.branchId, organizationId, archivedAt: null } });
    if (!branch) throw AppError.notFound('Филиал');
    const startAt = new Date(input.startAt);
    const date = AvailabilityService.localDate(startAt, branch.timezone);
    const autoAssign = input.items.some((i) => !i.specialistId);
    const [base, sales] = await Promise.all([
      this.availability.loadStatic(this.prisma, branch.id, date, input.items, { audience: 'staff' }),
      this.activeSales(this.prisma, organizationId, branch.id, new Date()),
    ]);
    this.assertSpecialistsValid(base, input.items);
    return this.withConflictRetry(
      () =>
        this.prisma.$transaction(async (tx) => {
          await this.lockClientKey(tx, organizationId, input.client.phone);
          const client = await this.findOrCreateClient(tx, organizationId, input.client.phone, input.client.name, 'ru');
          await this.lockBranch(tx, branch.id);
          await this.releaseExpiredHolds(tx, { organizationId });
          const ctx = await this.availability.withOccupancy(tx, base);
          const assignment = this.availability.assignmentAt(ctx, input.items, startAt, 'staff');
          if (!assignment) throw AppError.slotUnavailable();
          const skipLimits = input.overrideClientLimits && ctx.settings.adminCanOverrideClientLimits;
          await this.assertClientLimits(tx, client.id, ctx.settings, new Date(assignment.start), new Date(assignment.end), { skip: skipLimits });
          const plan = await this.priceAssignment(tx, ctx, assignment, { code: input.promoCode, clientId: client.id, lock: true }, new Date(), sales);
          const manageToken = randomToken(32);
          const appt = await tx.appointment.create({
            data: {
              organizationId,
              branchId: branch.id,
              clientId: client.id,
              status: 'confirmed',
              confirmedAt: new Date(),
              startAt: new Date(assignment.start),
              endAt: new Date(assignment.end),
              timezone: branch.timezone,
              source: 'admin',
              locale: client.locale,
              comment: input.comment,
              baseTotal: plan.baseTotal,
              saleDiscountTotal: plan.saleDiscountTotal,
              promoDiscountTotal: plan.promoDiscountTotal,
              totalPrice: plan.totalPrice,
              promoCode: plan.promoCode,
              promotionId: plan.promotionId,
              createdByUserId: actor.userId,
              manageTokenHash: sha256(manageToken),
            },
          });
          await this.insertPlan(tx, organizationId, appt.id, plan);
          await this.history(tx, organizationId, appt.id, null, 'confirmed', actor, 'Создана администратором');
          if (plan.promotionId) {
            await tx.promotionRedemption.create({
              data: { organizationId, promotionId: plan.promotionId, appointmentId: appt.id, clientId: client.id, discountAmount: plan.promoDiscountTotal, status: 'applied' },
            });
          }
          const full = await tx.appointment.findUniqueOrThrow({ where: { id: appt.id }, include: APPOINTMENT_INCLUDE });
          if (input.notifyClient) {
            await this.notifications.enqueue(tx, {
              organizationId,
              type: 'appointment_confirmed',
              eventKey: `appointment:${appt.id}:confirmed`,
              recipient: client.phone,
              locale: full.locale,
              params: this.notificationParams(full, full.branch, {
                clientName: client.name,
                services: full.items.map((i) => i.serviceNameSnapshot).join(', '),
                manageUrl: this.manageUrl(manageToken, full.locale),
              }),
              appointmentId: appt.id,
              clientId: client.id,
            });
          }
          await this.audit.log(actor, 'appointment.created_manual', 'appointment', appt.id, { after: { startAt: appt.startAt, clientId: client.id }, organizationId }, tx);
          return this.toView(full, ctx.settings);
        }),
      autoAssign,
    );
  }

  // =====================================================================
  // Перенос (§8.5)
  // =====================================================================

  async reschedule(
    appointmentId: string,
    input: { startAt: string; items?: RequestItem[] },
    actor: ActorContext,
    who: StatusActor,
  ) {
    const existing = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: APPOINTMENT_INCLUDE });
    if (!existing) throw AppError.notFound('Запись');
    if (existing.status !== 'confirmed') throw AppError.unprocessable('INVALID_STATUS_TRANSITION', 'Перенести можно только подтверждённую запись');
    const settings = await this.prisma.bookingSettings.findUniqueOrThrow({ where: { branchId: existing.branchId } });
    if (who === 'client' && Date.now() > existing.startAt.getTime() - settings.rescheduleDeadlineMinutes * 60_000) {
      throw AppError.unprocessable('RESCHEDULE_DEADLINE_PASSED', 'Срок самостоятельного переноса истёк. Свяжитесь с филиалом.');
    }
    const items: RequestItem[] =
      input.items ?? existing.items.map((i) => ({ serviceId: i.serviceId, specialistId: i.specialistId }));
    const oldServices = existing.items.map((i) => i.serviceId).join(',');
    if (items.map((i) => i.serviceId).join(',') !== oldServices) {
      throw AppError.badRequest('VALIDATION_ERROR', 'При переносе нельзя менять состав услуг — создайте новую запись');
    }
    const startAt = new Date(input.startAt);
    const date = AvailabilityService.localDate(startAt, existing.branch.timezone);
    const audience = who === 'client' ? 'public' : 'staff';
    const autoAssign = items.some((i) => !i.specialistId);
    const base = await this.availability.loadStatic(this.prisma, existing.branchId, date, items, { audience: 'staff' });
    this.assertSpecialistsValid(base, items);

    return this.withConflictRetry(
      () =>
        this.prisma.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM appointments WHERE id = ${appointmentId}::uuid FOR UPDATE`;
          if (locked[0]?.status !== 'confirmed') throw AppError.unprocessable('INVALID_STATUS_TRANSITION', 'Запись больше не активна');
          await this.lockBranch(tx, existing.branchId);
          await this.releaseExpiredHolds(tx, { organizationId: existing.organizationId });
          const ctx = await this.availability.withOccupancy(tx, base, appointmentId);
          const assignment = this.availability.assignmentAt(ctx, items, startAt, audience);
          if (!assignment) throw AppError.slotUnavailable();
          await this.assertClientLimits(tx, existing.clientId, ctx.settings, new Date(assignment.start), new Date(assignment.end), {
            excludeAppointmentId: appointmentId,
            skip: who !== 'client',
          });

          // Старые строки деактивируются и новые вставляются в одной транзакции:
          // если новое время занято (23P01), откатывается всё и старая запись остаётся без изменений.
          const freedResourceIds = await this.activeResourceIds(tx, appointmentId);
          await tx.appointmentResource.updateMany({ where: { appointmentId, isActive: true }, data: { isActive: false } });
          for (const it of assignment.items) {
            const old = existing.items.find((o) => o.position === it.position)!;
            await tx.appointmentItem.update({
              where: { id: old.id },
              data: {
                startAt: new Date(it.start),
                endAt: new Date(it.end),
                specialistId: it.specialistId,
                specialistNameSnapshot: it.specialistId ? (ctx.specialistNames.get(it.specialistId) ?? null) : null,
              },
            });
            const resIds = [...(it.specialistResourceId ? [it.specialistResourceId] : []), ...it.resourceIds];
            await tx.appointmentResource.createMany({
              data: resIds.map((resourceId) => ({
                organizationId: existing.organizationId,
                appointmentId,
                appointmentItemId: old.id,
                resourceId,
                startAt: new Date(it.occupancy.start),
                endAt: new Date(it.occupancy.end),
              })),
            });
          }
          const updated = await tx.appointment.update({
            where: { id: appointmentId },
            data: { startAt: new Date(assignment.start), endAt: new Date(assignment.end), rescheduleCount: { increment: 1 }, reminderSentAt: null },
            include: APPOINTMENT_INCLUDE,
          });
          const rs = await tx.appointmentReschedule.create({
            data: {
              organizationId: existing.organizationId,
              appointmentId,
              oldStartAt: existing.startAt,
              oldEndAt: existing.endAt,
              newStartAt: updated.startAt,
              newEndAt: updated.endAt,
              oldItems: existing.items.map((i) => ({ serviceId: i.serviceId, specialistId: i.specialistId, startAt: i.startAt.toISOString() })),
              newItems: updated.items.map((i) => ({ serviceId: i.serviceId, specialistId: i.specialistId, startAt: i.startAt.toISOString() })),
              actorType: actor.actorType,
              actorUserId: actor.userId,
            },
          });
          await this.recordFreedSlot(tx, existing, freedResourceIds, ctx.settings.waitlistEnabled);
          await this.notifications.cancelPending(tx, appointmentId, ['appointment_reminder']);
          await this.notifications.enqueue(tx, {
            organizationId: existing.organizationId,
            type: 'appointment_rescheduled',
            eventKey: `appointment:${appointmentId}:rescheduled:${rs.id}`,
            recipient: existing.client.phone,
            locale: updated.locale,
            params: this.notificationParams(updated, updated.branch, { clientName: updated.client.name, manageUrl: `${getConfig().PUBLIC_BASE_URL}/${updated.locale}/cabinet` }),
            appointmentId,
            clientId: existing.clientId,
          });
          if (who !== 'client') {
            await this.audit.log(actor, 'appointment.rescheduled', 'appointment', appointmentId, {
              before: { startAt: existing.startAt },
              after: { startAt: updated.startAt },
              organizationId: existing.organizationId,
            }, tx);
          }
          return this.toView(updated, ctx.settings);
        }),
      autoAssign,
    );
  }

  // =====================================================================
  // Отмена и смена статуса (§8.2, §8.6)
  // =====================================================================

  async cancel(appointmentId: string, actor: ActorContext, who: 'client' | 'admin', reason?: string) {
    const a = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: APPOINTMENT_INCLUDE });
    if (!a) throw AppError.notFound('Запись');
    const to: AppointmentStatus = who === 'client' ? 'cancelled_by_client' : 'cancelled_by_admin';
    if (!canTransition(a.status, to, who)) throw AppError.unprocessable('INVALID_STATUS_TRANSITION', 'Эту запись нельзя отменить');
    const settings = await this.prisma.bookingSettings.findUniqueOrThrow({ where: { branchId: a.branchId } });
    if (who === 'client' && a.status === 'confirmed') {
      const deadline = a.startAt.getTime() - settings.cancelDeadlineMinutes * 60_000;
      if (Date.now() > deadline && !settings.allowLateCancelException) {
        throw AppError.unprocessable('CANCEL_DEADLINE_PASSED', 'Срок самостоятельной отмены истёк. Свяжитесь с филиалом.');
      }
    }
    if (who === 'admin' && !reason) throw AppError.badRequest('VALIDATION_ERROR', 'Укажите причину отмены');

    return this.prisma.$transaction(async (tx) => {
      const r = await tx.appointment.updateMany({
        where: { id: appointmentId, status: a.status },
        data: { status: to, cancelledAt: new Date(), cancelReason: reason ?? null },
      });
      if (r.count !== 1) throw AppError.conflict('Статус записи изменился, обновите страницу');
      const freedResourceIds = await this.activeResourceIds(tx, appointmentId);
      await tx.appointmentResource.updateMany({ where: { appointmentId }, data: { isActive: false } });
      await tx.bookingHold.updateMany({ where: { appointmentId, releasedAt: null }, data: { releasedAt: new Date(), releaseReason: 'abandoned' } });
      await tx.promotionRedemption.updateMany({ where: { appointmentId }, data: { status: 'released' } });
      await this.history(tx, a.organizationId, appointmentId, a.status, to, actor, reason);
      await this.notifications.cancelPending(tx, appointmentId, ['appointment_reminder', 'otp']);
      if (a.status === 'confirmed') {
        await this.recordFreedSlot(tx, a, freedResourceIds, settings.waitlistEnabled);
        await this.notifications.enqueue(tx, {
          organizationId: a.organizationId,
          type: 'appointment_cancelled',
          eventKey: `appointment:${appointmentId}:cancelled`,
          recipient: a.client.phone,
          locale: a.locale,
          params: this.notificationParams(a, a.branch, { clientName: a.client.name }),
          appointmentId,
          clientId: a.clientId,
        });
        await tx.analyticsEvent.create({
          data: {
            organizationId: a.organizationId,
            branchId: a.branchId,
            type: 'booking_cancelled',
            visitorHash: sha256(`appt:${a.visitorSession ?? appointmentId}`),
            appointmentId,
            serviceIds: a.items.map((i) => i.serviceId),
          },
        });
      }
      if (who === 'admin') {
        await this.audit.log(actor, 'appointment.cancelled', 'appointment', appointmentId, { before: { status: a.status }, after: { status: to, reason }, organizationId: a.organizationId }, tx);
      }
      const updated = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: APPOINTMENT_INCLUDE });
      return this.toView(updated, settings);
    });
  }

  /** Выполнено / неявка (администратор). */
  async setOutcome(appointmentId: string, status: 'completed' | 'no_show', actor: ActorContext, reason?: string) {
    const a = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: APPOINTMENT_INCLUDE });
    if (!a) throw AppError.notFound('Запись');
    if (!canTransition(a.status, status, 'admin')) throw AppError.unprocessable('INVALID_STATUS_TRANSITION', 'Недопустимая смена статуса');
    if (a.startAt.getTime() > Date.now()) throw AppError.unprocessable('INVALID_STATUS_TRANSITION', 'Визит ещё не начался');
    if (a.status === 'no_show') {
      const last = await this.prisma.appointmentStatusHistory.findFirst({ where: { appointmentId, toStatus: 'no_show' }, orderBy: { createdAt: 'desc' } });
      if (last && Date.now() - last.createdAt.getTime() > NO_SHOW_CORRECTION_WINDOW_HOURS * 3600_000) {
        throw AppError.unprocessable('INVALID_STATUS_TRANSITION', 'Исправление неявки возможно в течение 24 часов');
      }
    }
    const settings = await this.prisma.bookingSettings.findUniqueOrThrow({ where: { branchId: a.branchId } });
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.appointment.updateMany({
        where: { id: appointmentId, status: a.status },
        data: { status, completedAt: status === 'completed' ? new Date() : null },
      });
      if (r.count !== 1) throw AppError.conflict('Статус записи изменился, обновите страницу');
      await this.history(tx, a.organizationId, appointmentId, a.status, status, actor, reason);
      if (status === 'completed') {
        const params = { branchName: a.branch.name, clientName: a.client.name };
        await this.notifications.enqueue(tx, {
          organizationId: a.organizationId,
          type: 'appointment_completed',
          eventKey: `appointment:${appointmentId}:completed`,
          recipient: a.client.phone,
          locale: a.locale,
          params,
          appointmentId,
          clientId: a.clientId,
        });
        await this.notifications.enqueue(tx, {
          organizationId: a.organizationId,
          type: 'review_request',
          eventKey: `appointment:${appointmentId}:review_request`,
          recipient: a.client.phone,
          locale: a.locale,
          params: { ...params, reviewUrl: `${getConfig().PUBLIC_BASE_URL}/${a.locale}/cabinet` },
          appointmentId,
          clientId: a.clientId,
        });
      }
      await this.audit.log(actor, `appointment.${status}`, 'appointment', appointmentId, { before: { status: a.status }, after: { status }, organizationId: a.organizationId }, tx);
      const updated = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: APPOINTMENT_INCLUDE });
      return this.toView(updated, settings);
    });
  }

  // =====================================================================
  // Чтение
  // =====================================================================

  async findByManageToken(token: string) {
    if (!token || token.length > 100) throw AppError.notFound('Запись');
    const a = await this.prisma.appointment.findUnique({ where: { manageTokenHash: sha256(token) }, include: APPOINTMENT_INCLUDE });
    if (!a) throw AppError.notFound('Запись');
    const settings = await this.prisma.bookingSettings.findUniqueOrThrow({ where: { branchId: a.branchId } });
    return { raw: a, view: this.toView(a, settings) };
  }

  async getFull(appointmentId: string) {
    return this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { ...APPOINTMENT_INCLUDE, statusHistory: { orderBy: { createdAt: 'asc' } }, reschedules: { orderBy: { createdAt: 'asc' } } },
    });
  }

  toView(a: AppointmentFull, settings: { cancelDeadlineMinutes: number; rescheduleDeadlineMinutes: number; allowLateCancelException: boolean }) {
    const now = Date.now();
    const cancelDeadline = new Date(a.startAt.getTime() - settings.cancelDeadlineMinutes * 60_000);
    const rescheduleDeadline = new Date(a.startAt.getTime() - settings.rescheduleDeadlineMinutes * 60_000);
    const active = a.status === 'confirmed';
    return {
      id: a.id,
      status: a.status,
      source: a.source,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      timezone: a.timezone,
      locale: a.locale,
      comment: a.comment,
      branch: { id: a.branch.id, name: a.branch.name, slug: a.branch.slug, address: a.branch.address, phone: a.branch.phone },
      client: { id: a.client.id, name: a.client.name, phone: a.client.phone },
      items: a.items.map((i) => ({
        id: i.id,
        serviceId: i.serviceId,
        serviceName: i.serviceNameSnapshot,
        specialistId: i.specialistId,
        specialistName: i.specialistNameSnapshot,
        startAt: i.startAt.toISOString(),
        endAt: i.endAt.toISOString(),
        durationMinutes: i.durationMinutes,
        basePrice: i.basePrice,
        saleDiscount: i.saleDiscount,
        promoDiscount: i.promoDiscount,
        finalPrice: i.finalPrice,
      })),
      price: {
        currency: a.currency,
        baseTotal: a.baseTotal,
        saleDiscountTotal: a.saleDiscountTotal,
        promoDiscountTotal: a.promoDiscountTotal,
        total: a.totalPrice,
        promoCode: a.promoCode,
      },
      hold: a.hold && !a.hold.releasedAt ? { expiresAt: a.hold.expiresAt.toISOString(), extensionCount: a.hold.extensionCount } : null,
      cancelDeadline: cancelDeadline.toISOString(),
      rescheduleDeadline: rescheduleDeadline.toISOString(),
      canCancel: active && (now <= cancelDeadline.getTime() || settings.allowLateCancelException),
      canReschedule: active && now <= rescheduleDeadline.getTime(),
      canReview: a.status === 'completed' && !a.review && now - a.endAt.getTime() < 30 * 86400_000,
      review: a.review,
      rescheduleCount: a.rescheduleCount,
      createdAt: a.createdAt.toISOString(),
    };
  }
}
