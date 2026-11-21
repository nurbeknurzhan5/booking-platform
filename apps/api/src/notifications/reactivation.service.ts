import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { computeSubscriptionStatus, REACTIVATION_COOLDOWN_DAYS } from '@booking/shared';
import { PrismaService } from '../common/prisma.service';
import { getConfig } from '../config/config';
import { BookingService } from '../booking/booking.service';
import { NotificationService } from './notification.service';

/** Отправка только в дневное время по часовому поясу филиала. */
export const REACTIVATION_SEND_HOURS = { from: 10, to: 20 } as const;

interface Candidate {
  client_id: string;
  appointment_id: string;
  branch_id: string;
  phone: string;
  name: string;
  locale: string;
}

/**
 * Реактивация клиентов (ТЗ §15.1 «согласованные реактивационные сообщения», решение D-34 — автоматически).
 * Клиент получает одно сообщение через N дней (настройка организации, не меньше 30) после последнего
 * завершённого визита, если:
 * - у него нет будущих записей в организации;
 * - последнее решение по согласию на рекламу (в организации или на платформе) — «да», и есть согласия на уведомления и WhatsApp;
 * - за последние 30 дней этому номеру не отправлялась реактивация;
 * - по этому визиту реактивация ещё не отправлялась (ключ события), т.е. одно сообщение на период без визитов;
 * - филиал последнего визита принимает онлайн-запись (иначе ссылка бесполезна);
 * - подписка организации активна или в льготном периоде;
 * - по времени филиала сейчас 10:00–20:00.
 * Отписка — ответом «СТОП» (WhatsAppInboundService) или в кабинете клиента.
 */
@Injectable()
export class ReactivationService {
  private readonly logger = new Logger(ReactivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly booking: BookingService,
  ) {}

  async enqueueDue(now = new Date(), limitPerOrg = 200): Promise<number> {
    const orgs = await this.prisma.organization.findMany({
      where: { archivedAt: null, notificationSettings: { path: ['reactivationEnabled'], equals: true } },
      include: { subscription: true },
    });
    let total = 0;
    for (const org of orgs) {
      const status = computeSubscriptionStatus(org.subscription ?? null, now);
      if (status !== 'active' && status !== 'grace_period') continue;
      const settings = await this.notifications.orgNotificationSettings(this.prisma, org.id);
      if (!settings.reactivationEnabled || !settings.whatsappEnabled) continue;
      total += await this.processOrg(org.id, settings.reactivationDays, now, limitPerOrg);
    }
    return total;
  }

  private async processOrg(organizationId: string, days: number, now: Date, limit: number): Promise<number> {
    const candidates = await this.prisma.$queryRaw<Candidate[]>`
      WITH last_visit AS (
        SELECT DISTINCT ON (a.client_id) a.client_id, a.id AS appointment_id, a.branch_id, a.end_at
        FROM appointments a
        WHERE a.organization_id = ${organizationId}::uuid AND a.status = 'completed'
        ORDER BY a.client_id, a.end_at DESC
      )
      SELECT lv.client_id, lv.appointment_id, lv.branch_id, c.phone, c.name, c.locale
      FROM last_visit lv
      JOIN clients c ON c.id = lv.client_id
      WHERE lv.end_at <= ${now}::timestamptz - make_interval(days => ${days}::int)
        AND c.merged_into_id IS NULL AND c.anonymized_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM appointments f
          WHERE f.client_id = c.id AND f.status IN ('confirmed', 'pending_otp') AND f.start_at > ${now}::timestamptz)
        AND NOT EXISTS (
          SELECT 1 FROM notification_events e
          WHERE e.dedupe_key = 'reactivation:' || c.id::text || ':' || lv.appointment_id::text)
        AND NOT EXISTS (
          SELECT 1 FROM notification_outbox o
          WHERE o.recipient = c.phone AND o.type = 'reactivation'
            AND o.created_at > ${now}::timestamptz - make_interval(days => ${REACTIVATION_COOLDOWN_DAYS}::int))
        AND (
          SELECT cc.granted FROM client_consents cc
          WHERE cc.phone = c.phone AND cc.consent_type = 'marketing'
            AND (cc.organization_id = ${organizationId}::uuid OR cc.organization_id IS NULL)
          ORDER BY cc.created_at DESC LIMIT 1
        ) IS TRUE
      ORDER BY lv.end_at
      LIMIT ${limit}`;
    if (candidates.length === 0) return 0;

    const branchIds = [...new Set(candidates.map((c) => c.branch_id))];
    const branches = await this.prisma.branch.findMany({ where: { id: { in: branchIds }, archivedAt: null }, include: { bookingSettings: true } });
    const bookable = new Map<string, { name: string; slug: string; timezone: string }>();
    for (const b of branches) {
      if (b.bookingSettings?.onlineBookingEnabled === false) continue;
      const pub = await this.booking.publicBranch(b.slug).catch(() => null);
      if (pub?.availability.visible && pub.availability.bookingEnabled) bookable.set(b.id, { name: b.name, slug: b.slug, timezone: b.timezone });
    }

    let n = 0;
    for (const c of candidates) {
      const branch = bookable.get(c.branch_id);
      if (!branch) continue;
      const hour = DateTime.fromJSDate(now, { zone: branch.timezone }).hour;
      if (hour < REACTIVATION_SEND_HOURS.from || hour >= REACTIVATION_SEND_HOURS.to) continue;
      const locale = ['ru', 'kk', 'en'].includes(c.locale) ? c.locale : 'ru';
      const url = new URL(`${getConfig().PUBLIC_BASE_URL}/${locale}/b/${branch.slug}`);
      url.searchParams.set('utm_source', 'whatsapp');
      url.searchParams.set('utm_medium', 'message');
      url.searchParams.set('utm_campaign', 'reactivation');
      const id = await this.prisma.$transaction((tx) =>
        this.notifications.enqueue(tx, {
          organizationId,
          type: 'reactivation',
          eventKey: `reactivation:${c.client_id}:${c.appointment_id}`,
          recipient: c.phone,
          locale,
          params: { clientName: c.name, branchName: branch.name, bookingUrl: url.toString() },
          clientId: c.client_id,
        }),
      );
      if (id) n++;
    }
    if (n) this.logger.log({ organizationId, queued: n }, 'Reactivation messages queued');
    return n;
  }
}
