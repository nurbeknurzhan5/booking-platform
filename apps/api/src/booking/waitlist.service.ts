import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { z } from 'zod';
import {
  JoinWaitlistSchema,
  StaffWaitlistCreateSchema,
  type WaitlistEntryStatus,
} from '@booking/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { randomToken, sha256 } from '../common/crypto';
import { OtpService } from '../auth/otp.service';
import { NotificationService } from '../notifications/notification.service';
import { AuditService } from '../common/audit.service';
import { getConfig } from '../config/config';
import { AvailabilityService, type BookingContext } from './availability.service';
import { BookingService } from './booking.service';
import { verifiedUserIdByPhone } from './client-scope';
import type { RequestItem, SlotAssignment } from './engine';
import type { ActorContext } from '../common/request-context';
import type { Branch, BookingSettings, Prisma, WaitlistEntry } from '../generated/prisma/client';

type JoinInput = z.infer<typeof JoinWaitlistSchema>;
type StaffCreateInput = z.infer<typeof StaffWaitlistCreateSchema>;

const CONSENT_TEXT_VERSION = '2026-11-v1';
/** Активных заявок (waiting/offered) на одного клиента в организации. */
export const MAX_ACTIVE_WAITLIST_ENTRIES = 3;
/** Максимальная ширина диапазона дат заявки. */
const MAX_RANGE_DAYS = 60;
/** Сколько заявок просматривать при подборе на одно освободившееся время. */
const CANDIDATE_SCAN_LIMIT = 100;
/** Неподтверждённые заявки (без OTP) удаляются через сутки. */
const PENDING_OTP_TTL_MS = 24 * 3600_000;
const ACTIVE: WaitlistEntryStatus[] = ['waiting', 'offered'];

const ENTRY_INCLUDE = {
  client: { select: { id: true, name: true, phone: true } },
  branch: { select: { id: true, name: true, slug: true, timezone: true } },
} satisfies Prisma.WaitlistEntryInclude;
type EntryFull = Prisma.WaitlistEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

interface Candidate {
  entry: WaitlistEntry & { client: { id: string; name: string; phone: string } };
  slot: SlotAssignment;
}

/**
 * Лист ожидания (§9). Освободившееся время (отмена/перенос) фиксируется в waitlist_releases;
 * воркер подбирает подходящие заявки и одновременно отправляет предложения первым N клиентам.
 * У предложения есть срок; первый подтвердивший получает слот, остальные предложения аннулируются;
 * по истечении срока — следующим в очереди или слот остаётся в общей записи (настройка владельца).
 *
 * Порядок блокировок: клиент → филиал (advisory) → waitlist_releases → waitlist_offers → waitlist_entries.
 */
@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly availability: AvailabilityService,
    private readonly otp: OtpService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  // =====================================================================
  // Общие части
  // =====================================================================

  static requestItems(serviceIds: string[], specialistId: string | null): RequestItem[] {
    return serviceIds.map((serviceId) => ({ serviceId, specialistId }));
  }

  private settingsFor(db: Tx | PrismaService, branch: Branch): Promise<BookingSettings> {
    // Без гонки первой вставки (параллельные запросы к новому филиалу не дают 500).
    return this.availability.ensureSettings(db, branch);
  }

  /** Проверка заявки: даты в горизонте записи, услуги доступны в филиале, специалист оказывает все услуги. */
  private async validateRequest(branch: Branch, settings: BookingSettings, items: RequestItem[], dateFrom: string, dateTo: string, audience: 'public' | 'staff') {
    const today = AvailabilityService.localDate(new Date(), branch.timezone);
    const horizon = DateTime.fromISO(today).plus({ days: audience === 'public' ? settings.maxHorizonDays : 365 }).toISODate()!;
    if (dateFrom < today) throw AppError.badRequest('VALIDATION_ERROR', 'Дата начала уже прошла');
    if (dateTo > horizon) throw AppError.badRequest('BOOKING_TOO_FAR', 'Дата за пределами горизонта записи');
    if (DateTime.fromISO(dateTo).diff(DateTime.fromISO(dateFrom), 'days').days > MAX_RANGE_DAYS) {
      throw AppError.badRequest('VALIDATION_ERROR', `Диапазон дат — не больше ${MAX_RANGE_DAYS} дней`);
    }
    const ctx = await this.availability.loadContext(this.prisma, branch.id, dateFrom, items, { audience });
    this.booking.assertSpecialistsValid(ctx, items);
  }

  private async assertEntryLimit(tx: Tx | PrismaService, clientId: string, branchId: string, serviceIds: string[], specialistId: string | null) {
    const active = await tx.waitlistEntry.findMany({ where: { clientId, status: { in: ACTIVE } }, select: { branchId: true, serviceIds: true, specialistId: true } });
    const key = [...serviceIds].sort().join(',');
    if (active.some((e) => e.branchId === branchId && [...e.serviceIds].sort().join(',') === key && e.specialistId === specialistId)) {
      throw AppError.unprocessable('WAITLIST_LIMIT', 'Вы уже в листе ожидания на эти услуги');
    }
    if (active.length >= MAX_ACTIVE_WAITLIST_ENTRIES) {
      throw AppError.unprocessable('WAITLIST_LIMIT', `Можно ожидать не больше ${MAX_ACTIVE_WAITLIST_ENTRIES} записей одновременно`);
    }
  }

  private offerUrl(token: string, locale: string) {
    return `${getConfig().PUBLIC_BASE_URL}/${locale}/waitlist/${token}`;
  }

  async entryViews(entries: EntryFull[]) {
    const serviceIds = [...new Set(entries.flatMap((e) => e.serviceIds))];
    const specialistIds = [...new Set(entries.map((e) => e.specialistId).filter((x): x is string => !!x))];
    const [services, specialists] = await Promise.all([
      serviceIds.length ? this.prisma.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true, durationMinutes: true } }) : [],
      specialistIds.length ? this.prisma.specialist.findMany({ where: { id: { in: specialistIds } }, select: { id: true, name: true } }) : [],
    ]);
    return entries.map((e) => ({
      id: e.id,
      status: e.status,
      source: e.source,
      priority: e.priority,
      locale: e.locale,
      dateFrom: e.dateFrom.toISOString().slice(0, 10),
      dateTo: e.dateTo.toISOString().slice(0, 10),
      services: e.serviceIds.map((id) => services.find((s) => s.id === id) ?? { id, name: '—', durationMinutes: 0 }),
      specialist: e.specialistId ? (specialists.find((s) => s.id === e.specialistId) ?? { id: e.specialistId, name: '—' }) : null,
      branch: e.branch,
      client: e.client,
      offeredAt: e.offeredAt?.toISOString() ?? null,
      offerExpiresAt: e.offerExpiresAt?.toISOString() ?? null,
      appointmentId: e.appointmentId,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  private async entryView(id: string) {
    const e = await this.prisma.waitlistEntry.findUniqueOrThrow({ where: { id }, include: ENTRY_INCLUDE });
    return (await this.entryViews([e]))[0]!;
  }

  // =====================================================================
  // Постановка в лист ожидания (клиент, с OTP)
  // =====================================================================

  async join(slug: string, input: JoinInput, ip: string) {
    if (input.formElapsedMs !== undefined && input.formElapsedMs < 1500) {
      throw AppError.badRequest('VALIDATION_ERROR', 'Форма заполнена слишком быстро. Попробуйте ещё раз.');
    }
    const branch = await this.booking.assertPublicBookingAllowed(slug);
    const settings = await this.settingsFor(this.prisma, branch);
    if (!settings.waitlistEnabled) throw new AppError('WAITLIST_DISABLED', HttpStatus.FORBIDDEN, 'Лист ожидания в этом филиале не ведётся');
    const serviceIds = [...new Set(input.items.map((i) => i.serviceId))];
    const specialistId = input.specialistId ?? null;
    await this.validateRequest(branch, settings, WaitlistService.requestItems(serviceIds, specialistId), input.dateFrom, input.dateTo, 'public');
    const phone = input.client.phone;
    // Понятная ошибка о дубле/лимите — до расхода лимита отправки кодов; в транзакции проверка повторяется.
    const known = await this.prisma.client.findFirst({ where: { organizationId: branch.organizationId, phone, mergedIntoId: null }, select: { id: true } });
    if (known) await this.assertEntryLimit(this.prisma, known.id, branch.id, serviceIds, specialistId);
    await this.otp.assertCanSend(phone, 'waitlist', ip);
    const token = randomToken(32);

    return this.prisma.$transaction(async (tx) => {
      const organizationId = branch.organizationId;
      await this.booking.lockClientKey(tx, organizationId, phone);
      const client = await this.booking.findOrCreateClient(tx, organizationId, phone, input.client.name, input.locale);
      await this.assertEntryLimit(tx, client.id, branch.id, serviceIds, specialistId);
      // Повторная попытка без подтверждения заменяет прежнюю неподтверждённую заявку.
      await tx.waitlistEntry.deleteMany({ where: { clientId: client.id, branchId: branch.id, status: 'pending_otp' } });
      const entry = await tx.waitlistEntry.create({
        data: {
          organizationId,
          branchId: branch.id,
          clientId: client.id,
          serviceIds,
          specialistId,
          dateFrom: new Date(`${input.dateFrom}T00:00:00Z`),
          dateTo: new Date(`${input.dateTo}T00:00:00Z`),
          status: 'pending_otp',
          locale: input.locale,
          source: 'online',
          tokenHash: sha256(token),
        },
      });
      const consents: Array<[string, boolean]> = [
        ['personal_data', true],
        ['notifications', input.consents.notifications],
        ['whatsapp', input.consents.whatsapp],
      ];
      await tx.clientConsent.createMany({
        data: consents.map(([consentType, granted]) => ({
          organizationId,
          clientId: client.id,
          phone,
          consentType,
          granted,
          textVersion: CONSENT_TEXT_VERSION,
          source: 'waitlist_form',
          ip,
        })),
      });
      const issued = await this.otp.issue(tx, { phone, purpose: 'waitlist', ip });
      await this.notifications.enqueue(tx, {
        organizationId,
        type: 'otp',
        eventKey: `otp:${issued.otpId}`,
        recipient: phone,
        locale: input.locale,
        params: { code: issued.code, minutes: String(Math.round((issued.expiresAt.getTime() - Date.now()) / 60_000)) },
        sensitive: true,
        expiresAt: issued.expiresAt,
        clientId: client.id,
      });
      return { entryId: entry.id, token, otpExpiresAt: issued.expiresAt.toISOString() };
    });
  }

  private async loadByToken(entryId: string, token: string) {
    const e = await this.prisma.waitlistEntry.findUnique({ where: { id: entryId }, include: { client: true } });
    if (!e || !e.tokenHash || e.tokenHash !== sha256(token)) throw AppError.notFound('Заявка');
    return e;
  }

  async confirmJoin(entryId: string, token: string, code: string) {
    const e = await this.loadByToken(entryId, token);
    if (e.status !== 'pending_otp') {
      if (ACTIVE.includes(e.status as WaitlistEntryStatus)) return this.entryView(e.id);
      throw AppError.unprocessable('INVALID_STATUS_TRANSITION', 'Заявка больше не активна');
    }
    await this.otp.verify({ phone: e.client.phone, purpose: 'waitlist', code });
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.waitlistEntry.updateMany({ where: { id: e.id, status: 'pending_otp' }, data: { status: 'waiting' } });
      if (r.count !== 1) throw AppError.conflict('Заявка изменилась, обновите страницу');
      // Привязка к профилю — только к профилю с подтверждённым номером (номер сотрудника задаётся без кода).
      const userId = await verifiedUserIdByPhone(tx, e.client.phone);
      if (userId) await tx.client.updateMany({ where: { id: e.clientId, userId: null }, data: { userId } });
    });
    return this.entryView(e.id);
  }

  async resendJoinOtp(entryId: string, token: string, ip: string) {
    const e = await this.loadByToken(entryId, token);
    if (e.status !== 'pending_otp') throw AppError.unprocessable('INVALID_STATUS_TRANSITION', 'Заявка уже подтверждена');
    await this.otp.assertCanSend(e.client.phone, 'waitlist', ip);
    const issued = await this.prisma.$transaction(async (tx) => {
      const i = await this.otp.issue(tx, { phone: e.client.phone, purpose: 'waitlist', ip });
      await this.notifications.enqueue(tx, {
        organizationId: e.organizationId,
        type: 'otp',
        eventKey: `otp:${i.otpId}`,
        recipient: e.client.phone,
        locale: e.locale,
        params: { code: i.code, minutes: String(Math.round((i.expiresAt.getTime() - Date.now()) / 60_000)) },
        sensitive: true,
        expiresAt: i.expiresAt,
        clientId: e.clientId,
      });
      return i;
    });
    return { otpExpiresAt: issued.expiresAt.toISOString() };
  }

  async cancelByToken(entryId: string, token: string, actor: ActorContext) {
    const e = await this.loadByToken(entryId, token);
    return this.cancelEntry(e.id, actor);
  }

  // =====================================================================
  // Администратор филиала
  // =====================================================================

  async createByStaff(organizationId: string, input: StaffCreateInput, actor: ActorContext) {
    const branch = await this.prisma.branch.findFirst({ where: { id: input.branchId, organizationId, archivedAt: null } });
    if (!branch) throw AppError.notFound('Филиал');
    const settings = await this.settingsFor(this.prisma, branch);
    if (!settings.waitlistEnabled) throw new AppError('WAITLIST_DISABLED', HttpStatus.FORBIDDEN, 'Лист ожидания в этом филиале выключен (настройки записи)');
    const serviceIds = [...new Set(input.items.map((i) => i.serviceId))];
    const specialistId = input.specialistId ?? null;
    await this.validateRequest(branch, settings, WaitlistService.requestItems(serviceIds, specialistId), input.dateFrom, input.dateTo, 'staff');
    const id = await this.prisma.$transaction(async (tx) => {
      await this.booking.lockClientKey(tx, organizationId, input.client.phone);
      const client = await this.booking.findOrCreateClient(tx, organizationId, input.client.phone, input.client.name, 'ru');
      await this.assertEntryLimit(tx, client.id, branch.id, serviceIds, specialistId);
      const entry = await tx.waitlistEntry.create({
        data: {
          organizationId,
          branchId: branch.id,
          clientId: client.id,
          serviceIds,
          specialistId,
          dateFrom: new Date(`${input.dateFrom}T00:00:00Z`),
          dateTo: new Date(`${input.dateTo}T00:00:00Z`),
          status: 'waiting',
          priority: input.priority,
          locale: client.locale,
          source: 'admin',
        },
      });
      await this.audit.log(actor, 'waitlist.created', 'waitlist_entry', entry.id, { after: { clientId: client.id, serviceIds, dateFrom: input.dateFrom, dateTo: input.dateTo }, organizationId }, tx);
      return entry.id;
    });
    return this.entryView(id);
  }

  async updatePriority(entryId: string, priority: number, actor: ActorContext) {
    const before = await this.prisma.waitlistEntry.findUniqueOrThrow({ where: { id: entryId } });
    await this.prisma.waitlistEntry.update({ where: { id: entryId }, data: { priority } });
    await this.audit.log(actor, 'waitlist.priority_changed', 'waitlist_entry', entryId, { before: { priority: before.priority }, after: { priority }, organizationId: before.organizationId });
    return this.entryView(entryId);
  }

  /** Выход из листа ожидания: заявка и её действующее предложение аннулируются. */
  async cancelEntry(entryId: string, actor: ActorContext) {
    const e = await this.prisma.waitlistEntry.findUnique({ where: { id: entryId } });
    if (!e) throw AppError.notFound('Заявка');
    if (!['pending_otp', 'waiting', 'offered'].includes(e.status)) {
      throw AppError.unprocessable('INVALID_STATUS_TRANSITION', 'Заявка уже не активна');
    }
    await this.prisma.$transaction(async (tx) => {
      const pending = await tx.waitlistOffer.findMany({ where: { entryId, status: 'pending' }, select: { id: true, releaseId: true } });
      for (const releaseId of [...new Set(pending.map((o) => o.releaseId))].sort()) {
        await tx.$queryRaw`SELECT id FROM waitlist_releases WHERE id = ${releaseId}::uuid FOR UPDATE`;
      }
      await tx.waitlistOffer.updateMany({ where: { entryId, status: 'pending' }, data: { status: 'cancelled', respondedAt: new Date() } });
      const r = await tx.waitlistEntry.updateMany({
        where: { id: entryId, status: { in: ['pending_otp', 'waiting', 'offered'] } },
        data: { status: 'cancelled', cancelledAt: new Date(), offeredAt: null, offerExpiresAt: null },
      });
      if (r.count !== 1) throw AppError.conflict('Заявка изменилась, обновите страницу');
      for (const releaseId of new Set(pending.map((o) => o.releaseId))) await this.closeRoundIfSettled(tx, releaseId);
      if (actor.actorType === 'user' || actor.actorType === 'superadmin') {
        await this.audit.log(actor, 'waitlist.cancelled', 'waitlist_entry', entryId, { before: { status: e.status }, organizationId: e.organizationId }, tx);
      }
    });
    return this.entryView(entryId);
  }

  // =====================================================================
  // Предложения (воркер)
  // =====================================================================

  /** Один проход воркера: истёкшие раунды → новые раунды → истёкшие заявки → очистка. */
  async processReleases(now = new Date()): Promise<{ offers: number }> {
    const expiredRounds = await this.prisma.waitlistRelease.findMany({
      where: { status: 'offering', roundExpiresAt: { lte: now } },
      orderBy: { roundExpiresAt: 'asc' },
      take: 50,
      select: { id: true },
    });
    for (const r of expiredRounds) await this.finishRound(r.id, now);

    let offers = 0;
    const pending = await this.prisma.waitlistRelease.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 50, select: { id: true } });
    for (const r of pending) {
      try {
        offers += await this.offerRound(r.id, now);
      } catch (e) {
        this.logger.error({ err: e, releaseId: r.id }, 'Waitlist round failed');
      }
    }

    // Заявки, у которых прошёл последний день (по часовому поясу филиала).
    await this.prisma.$executeRaw`
      UPDATE waitlist_entries e SET status = 'expired', updated_at = now()
      FROM branches b
      WHERE b.id = e.branch_id AND e.status = 'waiting' AND e.date_to < (now() AT TIME ZONE b.timezone)::date`;
    await this.prisma.waitlistEntry.deleteMany({ where: { status: 'pending_otp', createdAt: { lt: new Date(now.getTime() - PENDING_OTP_TTL_MS) } } });
    return { offers };
  }

  /**
   * Подходящий клиенту слот, который стал возможен именно благодаря освобождению: использует хотя бы
   * один из освободившихся ресурсов в освободившееся время. Из подходящих — ближайший к началу.
   */
  static pickSlot(slots: SlotAssignment[], release: { startAt: Date; endAt: Date; resourceIds: string[] }): SlotAssignment | null {
    const s0 = release.startAt.getTime();
    const e0 = release.endAt.getTime();
    const freed = new Set(release.resourceIds);
    const usesFreed = (s: SlotAssignment) =>
      s.items.some(
        (i) =>
          i.occupancy.start < e0 &&
          s0 < i.occupancy.end &&
          ((i.specialistResourceId !== null && freed.has(i.specialistResourceId)) || i.resourceIds.some((r) => freed.has(r))),
      );
    const fitting = slots.filter(usesFreed);
    if (!fitting.length) return null;
    return fitting.reduce((best, s) => (Math.abs(s.start - s0) < Math.abs(best.start - s0) ? s : best));
  }

  /** Раунд предложений: первые N подходящих заявок получают предложение одновременно. */
  async offerRound(releaseId: string, now = new Date()): Promise<number> {
    const release = await this.prisma.waitlistRelease.findUnique({ where: { id: releaseId }, include: { branch: true } });
    if (!release || release.status !== 'pending') return 0;
    const branch = release.branch;
    const settings = await this.settingsFor(this.prisma, branch);
    const close = (reason: string) =>
      this.prisma.waitlistRelease.updateMany({ where: { id: releaseId, status: 'pending' }, data: { status: 'closed', closedReason: reason, roundExpiresAt: null } });
    if (!settings.waitlistEnabled || branch.archivedAt) {
      await close('disabled');
      return 0;
    }
    if (release.startAt.getTime() <= now.getTime() + settings.minLeadMinutes * 60_000) {
      await close('too_late');
      return 0;
    }

    const date = AvailabilityService.localDate(release.startAt, branch.timezone);
    const day = new Date(`${date}T00:00:00Z`);
    const entries = await this.prisma.waitlistEntry.findMany({
      where: {
        branchId: branch.id,
        status: 'waiting',
        dateFrom: { lte: day },
        dateTo: { gte: day },
        ...(release.offeredEntryIds.length ? { id: { notIn: release.offeredEntryIds } } : {}),
      },
      orderBy: settings.waitlistPriority === 'priority' ? [{ priority: 'desc' }, { createdAt: 'asc' }] : [{ createdAt: 'asc' }],
      take: CANDIDATE_SCAN_LIMIT,
      include: { client: { select: { id: true, name: true, phone: true } } },
    });

    // Свободные слоты по набору услуг/специалисту считаются один раз (вне транзакции, по зафиксированному состоянию).
    const slotCache = new Map<string, SlotAssignment[] | null>();
    const chosen: Candidate[] = [];
    for (const entry of entries) {
      if (chosen.length >= settings.waitlistRecipients) break;
      if (chosen.some((c) => c.entry.clientId === entry.clientId)) continue;
      const items = WaitlistService.requestItems(entry.serviceIds, entry.specialistId);
      const key = `${[...entry.serviceIds].sort().join(',')}|${entry.specialistId ?? '*'}`;
      if (!slotCache.has(key)) {
        // Услуга больше недоступна онлайн — заявка не подходит (null).
        const ctx: BookingContext | null = await this.availability
          .loadContext(this.prisma, branch.id, date, items, { audience: 'public', now })
          .catch(() => null);
        slotCache.set(key, ctx ? this.availability.slots(ctx, items, 'public', now) : null);
      }
      const slots = slotCache.get(key);
      const slot = slots ? WaitlistService.pickSlot(slots, release) : null;
      if (!slot) continue;
      const overlap = await this.prisma.appointment.count({
        where: { clientId: entry.clientId, status: 'confirmed', startAt: { lt: new Date(slot.end) }, endAt: { gt: new Date(slot.start) } },
      });
      if (overlap) continue;
      chosen.push({ entry, slot });
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string; round: number }>>`SELECT status, round FROM waitlist_releases WHERE id = ${releaseId}::uuid FOR UPDATE`;
      if (locked[0]?.status !== 'pending') return 0;
      const round = locked[0].round + 1;
      const expiresAt = new Date(now.getTime() + settings.waitlistOfferMinutes * 60_000);
      const offered: string[] = [];
      for (const c of chosen) {
        const r = await tx.waitlistEntry.updateMany({
          where: { id: c.entry.id, status: 'waiting' },
          data: { status: 'offered', offeredAt: now, offerExpiresAt: expiresAt },
        });
        if (r.count !== 1) continue; // заявку отменили, пока шёл подбор
        const token = randomToken(32);
        const offer = await tx.waitlistOffer.create({
          data: {
            organizationId: release.organizationId,
            releaseId,
            entryId: c.entry.id,
            round,
            tokenHash: sha256(token),
            startAt: new Date(c.slot.start),
            endAt: new Date(c.slot.end),
            expiresAt,
          },
        });
        const dt = DateTime.fromMillis(c.slot.start, { zone: branch.timezone }).setLocale(c.entry.locale === 'kk' ? 'kk' : c.entry.locale === 'en' ? 'en' : 'ru');
        await this.notifications.enqueue(tx, {
          organizationId: release.organizationId,
          type: 'waitlist_offer',
          eventKey: `waitlist:offer:${offer.id}`,
          recipient: c.entry.client.phone,
          locale: c.entry.locale,
          params: { branchName: branch.name, date: dt.toFormat('d MMMM yyyy'), time: dt.toFormat('HH:mm'), offerUrl: this.offerUrl(token, c.entry.locale) },
          // Ссылка даёт право записаться — параметры шифруются и стираются после отправки.
          sensitive: true,
          expiresAt,
          clientId: c.entry.clientId,
        });
        offered.push(c.entry.id);
      }
      if (!offered.length) {
        await tx.waitlistRelease.update({ where: { id: releaseId }, data: { status: 'closed', closedReason: release.round === 0 ? 'no_candidates' : 'queue_exhausted', roundExpiresAt: null } });
        return 0;
      }
      await tx.waitlistRelease.update({
        where: { id: releaseId },
        data: { status: 'offering', round, roundExpiresAt: expiresAt, offeredEntryIds: { push: offered } },
      });
      return offered.length;
    });
  }

  /** Истёк срок раунда: неотвеченные предложения истекают, заявки возвращаются в очередь. */
  async finishRound(releaseId: string, now = new Date()) {
    const release = await this.prisma.waitlistRelease.findUnique({ where: { id: releaseId }, include: { branch: true } });
    if (!release) return;
    const settings = await this.settingsFor(this.prisma, release.branch);
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string; round_expires_at: Date | null }>>`
        SELECT status, round_expires_at FROM waitlist_releases WHERE id = ${releaseId}::uuid FOR UPDATE`;
      const l = locked[0];
      if (!l || l.status !== 'offering' || !l.round_expires_at || l.round_expires_at.getTime() > now.getTime()) return;
      const pending = await tx.waitlistOffer.findMany({ where: { releaseId, status: 'pending' }, select: { id: true, entryId: true } });
      if (pending.length) {
        await tx.waitlistOffer.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: 'expired' } });
        await tx.waitlistEntry.updateMany({
          where: { id: { in: pending.map((p) => p.entryId) }, status: 'offered' },
          data: { status: 'waiting', offeredAt: null, offerExpiresAt: null },
        });
      }
      const next = settings.waitlistEnabled && settings.waitlistAfterExpiry === 'offer_next';
      await tx.waitlistRelease.update({
        where: { id: releaseId },
        data: next ? { status: 'pending', roundExpiresAt: null } : { status: 'closed', closedReason: 'expired', roundExpiresAt: null },
      });
    });
  }

  /** Все предложения раунда отклонены или стали неактуальны — не ждать срока, перейти к следующему шагу. */
  private async closeRoundIfSettled(tx: Tx, releaseId: string) {
    const left = await tx.waitlistOffer.count({ where: { releaseId, status: 'pending' } });
    if (left === 0) await tx.waitlistRelease.updateMany({ where: { id: releaseId, status: 'offering' }, data: { roundExpiresAt: new Date() } });
  }

  // =====================================================================
  // Ответ клиента на предложение
  // =====================================================================

  private async loadOffer(token: string) {
    if (!token || token.length > 100) throw AppError.notFound('Предложение');
    const offer = await this.prisma.waitlistOffer.findUnique({
      where: { tokenHash: sha256(token) },
      include: { entry: { include: ENTRY_INCLUDE }, release: true },
    });
    if (!offer) throw AppError.notFound('Предложение');
    return offer;
  }

  async getOffer(token: string) {
    const offer = await this.loadOffer(token);
    const [entry] = await this.entryViews([offer.entry]);
    const status = offer.status === 'pending' && offer.expiresAt.getTime() <= Date.now() ? 'expired' : offer.status;
    // Ориентировочная стоимость по текущим ценам (итог фиксируется в snapshot при записи).
    const totalPrice: number | null = await this.booking
      .quote(offer.release.branchId, WaitlistService.requestItems(offer.entry.serviceIds, offer.entry.specialistId), undefined, 'public')
      .then((q) => q.totalPrice)
      .catch(() => null);
    return {
      status,
      startAt: offer.startAt.toISOString(),
      endAt: offer.endAt.toISOString(),
      expiresAt: offer.expiresAt.toISOString(),
      locale: offer.entry.locale,
      branch: entry!.branch,
      services: entry!.services,
      specialist: entry!.specialist,
      totalPrice,
      currency: 'KZT',
    };
  }

  private static closed(message = 'Это время уже занято другим клиентом из листа ожидания') {
    return new AppError('WAITLIST_OFFER_CLOSED', HttpStatus.CONFLICT, message);
  }
  private static expired() {
    return new AppError('WAITLIST_OFFER_EXPIRED', HttpStatus.GONE, 'Срок действия предложения истёк');
  }

  /** Блокировка раунда и предложения (в этом порядке) и проверка, что предложение ещё действует. */
  private async lockOffer(tx: Tx, offerId: string, releaseId: string) {
    const rel = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM waitlist_releases WHERE id = ${releaseId}::uuid FOR UPDATE`;
    const of = await tx.$queryRaw<Array<{ status: string; expires_at: Date }>>`SELECT status, expires_at FROM waitlist_offers WHERE id = ${offerId}::uuid FOR UPDATE`;
    const o = of[0];
    if (!o) throw AppError.notFound('Предложение');
    if (o.status === 'accepted') throw WaitlistService.closed('Вы уже записаны по этому предложению');
    if (o.status !== 'pending') throw WaitlistService.closed();
    if (o.expires_at.getTime() <= Date.now()) throw WaitlistService.expired();
    if (rel[0]?.status !== 'offering') throw WaitlistService.closed();
  }

  async acceptOffer(token: string, ip: string | null) {
    const offer = await this.loadOffer(token);
    if (offer.status === 'accepted') throw WaitlistService.closed('Вы уже записаны по этому предложению');
    if (offer.status !== 'pending') throw WaitlistService.closed();
    if (offer.expiresAt.getTime() <= Date.now()) throw WaitlistService.expired();
    const entry = offer.entry;
    try {
      return await this.booking.createFromWaitlist(
        {
          branchId: offer.release.branchId,
          clientId: entry.clientId,
          startAt: offer.startAt,
          items: WaitlistService.requestItems(entry.serviceIds, entry.specialistId),
          locale: entry.locale,
          ip,
        },
        (tx) => this.lockOffer(tx, offer.id, offer.releaseId),
        async (tx, appointmentId) => {
          const now = new Date();
          await tx.waitlistOffer.update({ where: { id: offer.id }, data: { status: 'accepted', respondedAt: now, appointmentId } });
          await tx.waitlistEntry.update({ where: { id: entry.id }, data: { status: 'booked', appointmentId, offeredAt: null, offerExpiresAt: null } });
          // Остальные предложения по этому времени аннулируются, их заявки возвращаются в очередь.
          const others = await tx.waitlistOffer.findMany({ where: { releaseId: offer.releaseId, status: 'pending' }, select: { id: true, entryId: true } });
          if (others.length) {
            await tx.waitlistOffer.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: 'cancelled' } });
            await tx.waitlistEntry.updateMany({
              where: { id: { in: others.map((o) => o.entryId) }, status: 'offered' },
              data: { status: 'waiting', offeredAt: null, offerExpiresAt: null },
            });
          }
          await tx.waitlistRelease.update({ where: { id: offer.releaseId }, data: { status: 'booked', roundExpiresAt: null } });
        },
      );
    } catch (e) {
      // Время заняли вне листа ожидания (общая онлайн-запись) или оно стало слишком близким.
      if (e instanceof AppError && (e.code === 'SLOT_UNAVAILABLE' || e.code === 'BOOKING_TOO_SOON')) await this.markLost(offer.id, offer.releaseId, entry.id);
      throw e;
    }
  }

  private async markLost(offerId: string, releaseId: string, entryId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM waitlist_releases WHERE id = ${releaseId}::uuid FOR UPDATE`;
      const r = await tx.waitlistOffer.updateMany({ where: { id: offerId, status: 'pending' }, data: { status: 'lost', respondedAt: new Date() } });
      if (r.count === 0) return;
      await tx.waitlistEntry.updateMany({ where: { id: entryId, status: 'offered' }, data: { status: 'waiting', offeredAt: null, offerExpiresAt: null } });
      await this.closeRoundIfSettled(tx, releaseId);
    });
  }

  /** Отказ от предложения; при leaveWaitlist — и выход из листа ожидания. */
  async declineOffer(token: string, leaveWaitlist: boolean) {
    const offer = await this.loadOffer(token);
    await this.prisma.$transaction(async (tx) => {
      await this.lockOffer(tx, offer.id, offer.releaseId).catch((e: unknown) => {
        // Истёкшее или закрытое предложение: отказ ничего не меняет, но выйти из очереди можно.
        if (!(e instanceof AppError) || !['WAITLIST_OFFER_CLOSED', 'WAITLIST_OFFER_EXPIRED'].includes(e.code)) throw e;
      });
      await tx.waitlistOffer.updateMany({ where: { id: offer.id, status: 'pending' }, data: { status: 'declined', respondedAt: new Date() } });
      await tx.waitlistEntry.updateMany({
        where: { id: offer.entryId, status: { in: leaveWaitlist ? ['waiting', 'offered'] : ['offered'] } },
        data: leaveWaitlist
          ? { status: 'cancelled', cancelledAt: new Date(), offeredAt: null, offerExpiresAt: null }
          : { status: 'waiting', offeredAt: null, offerExpiresAt: null },
      });
      await this.closeRoundIfSettled(tx, offer.releaseId);
    });
    return this.getOffer(token);
  }

  // =====================================================================
  // Списки
  // =====================================================================

  async list(where: Prisma.WaitlistEntryWhereInput, page: number, pageSize: number) {
    const [total, rows] = await Promise.all([
      this.prisma.waitlistEntry.count({ where }),
      this.prisma.waitlistEntry.findMany({
        where,
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: ENTRY_INCLUDE,
      }),
    ]);
    return { total, page, pageSize, items: await this.entryViews(rows) };
  }

  async listForClients(clientWhere: Prisma.ClientWhereInput) {
    const rows = await this.prisma.waitlistEntry.findMany({
      where: { client: clientWhere, status: { in: ['waiting', 'offered'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: ENTRY_INCLUDE,
    });
    return this.entryViews(rows);
  }
}
