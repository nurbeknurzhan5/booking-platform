import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { maskPhone } from '@booking/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { getConfig } from '../config/config';
import { NotificationService } from './notification.service';

/** Входящее сообщение из webhook Cloud API (поле value.messages[]). */
export interface WaInboundMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}

export type InboundAction = 'auto_reply' | 'unsubscribe' | 'throttled' | 'ignored';

/** Слова отписки от рекламных сообщений (ru / kk / en), сравнение без регистра и знаков препинания. */
const STOP_WORDS = new Set(['стоп', 'stop', 'тоқтату', 'токтату', 'отписаться', 'отписка', 'unsubscribe']);
/** Служебные типы, на которые не отвечаем. */
const IGNORED_TYPES = new Set(['reaction', 'system', 'unsupported', 'ephemeral', 'request_welcome']);
/** Не больше одного автоответа на номер за этот интервал: защита от переписки двух автоответчиков. */
export const AUTO_REPLY_THROTTLE_MS = 5 * 60_000;
/** Окно обслуживания Meta: ответ обычным текстом возможен в течение 24 ч после сообщения клиента. */
const SERVICE_WINDOW_MS = 24 * 3600_000;
const SAFETY_MARGIN_MS = 5 * 60_000;
const MAX_LISTED = 3;
const CONSENT_TEXT_VERSION = '2026-11-v1';

const TEXTS = {
  ru: { header: 'Ваши ближайшие записи:', none: 'На этот номер нет предстоящих записей.', at: 'в', phone: 'тел.' },
  kk: { header: 'Сіздің жақын жазбаларыңыз:', none: 'Бұл нөмірге алдағы жазбалар жоқ.', at: '', phone: 'тел.' },
  en: { header: 'Your upcoming bookings:', none: 'There are no upcoming bookings for this number.', at: 'at', phone: 'tel.' },
} as const;
type Locale = keyof typeof TEXTS;

export function isStopWord(text: string): boolean {
  return STOP_WORDS.has(text.trim().toLowerCase().replace(/[.!,;:\s]+/g, ''));
}

/**
 * Входящие сообщения WhatsApp (ТЗ §15.1 «отвечать на вопросы о существующей записи», решение D-32 — только автоответ).
 * На любое сообщение клиент получает список ближайших записей на свой номер и ссылку на кабинет.
 * «СТОП» — отзыв согласия на рекламные сообщения (D-34). Номер отправителя подтверждён WhatsApp:
 * ответ уходит только на него. Создание записи через WhatsApp запрещено (§15.1) — его нет.
 */
@Injectable()
export class WhatsAppInboundService {
  private readonly logger = new Logger(WhatsAppInboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** Возвращает действие или null, если сообщение уже обработано (повторная доставка webhook). */
  async handle(m: WaInboundMessage, now = new Date()): Promise<InboundAction | null> {
    if (!m.id || !m.from) return null;
    const digits = m.from.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return null;
    const phone = `+${digits}`;
    const receivedAt = m.timestamp && /^\d+$/.test(m.timestamp) ? new Date(Number(m.timestamp) * 1000) : now;
    const type = (m.type ?? 'unknown').slice(0, 30);
    const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
    const windowEnds = receivedAt.getTime() + SERVICE_WINDOW_MS - SAFETY_MARGIN_MS;

    return this.prisma.$transaction(async (tx) => {
      // Сообщения одного номера обрабатываются по очереди (ограничение частоты ответов).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wa-inbound:${phone}`}, 0))`;
      if (await tx.whatsappInboundMessage.findUnique({ where: { providerMessageId: m.id! }, select: { id: true } })) return null;

      let action: InboundAction;
      if (IGNORED_TYPES.has(type) || windowEnds <= now.getTime()) action = 'ignored';
      else if (isStopWord(text)) action = 'unsubscribe';
      else {
        const recent = await tx.whatsappInboundMessage.count({
          where: { phone, action: 'auto_reply', createdAt: { gt: new Date(now.getTime() - AUTO_REPLY_THROTTLE_MS) } },
        });
        action = recent > 0 ? 'throttled' : 'auto_reply';
      }
      await tx.whatsappInboundMessage.create({ data: { providerMessageId: m.id!, phone, messageType: type, action, receivedAt } });

      const locale = await this.localeFor(tx, phone);
      const expiresAt = new Date(windowEnds);
      if (action === 'unsubscribe') {
        // Отзыв на уровне платформы (organization_id = NULL): последняя запись перекрывает согласия всех организаций.
        await tx.clientConsent.create({
          data: { phone, consentType: 'marketing', granted: false, textVersion: CONSENT_TEXT_VERSION, source: 'whatsapp_stop' },
        });
        await tx.notificationOutbox.updateMany({
          where: { recipient: phone, type: 'reactivation', status: { in: ['pending', 'failed'] } },
          data: { status: 'cancelled', lastError: 'marketing consent withdrawn' },
        });
        await this.notifications.enqueue(tx, {
          organizationId: null,
          type: 'marketing_unsubscribed',
          eventKey: `wa-inbound:${m.id}`,
          recipient: phone,
          locale,
          params: {},
          expiresAt,
        });
      } else if (action === 'auto_reply') {
        await this.notifications.enqueue(tx, {
          organizationId: null,
          type: 'whatsapp_auto_reply',
          eventKey: `wa-inbound:${m.id}`,
          recipient: phone,
          locale,
          params: { summary: await this.summary(tx, phone, locale, now), cabinetUrl: `${getConfig().PUBLIC_BASE_URL}/${locale}/cabinet` },
          // Сведения о записях: шифруются в outbox и стираются после отправки.
          sensitive: true,
          expiresAt,
        });
      }
      this.logger.log({ to: maskPhone(phone), type, action }, 'WhatsApp inbound message');
      return action;
    });
  }

  /** Язык ответа: язык последней активной карточки клиента с этим номером, иначе русский. */
  private async localeFor(tx: Tx, phone: string): Promise<Locale> {
    const c = await tx.client.findFirst({ where: { phone, mergedIntoId: null, anonymizedAt: null }, orderBy: { updatedAt: 'desc' }, select: { locale: true } });
    return c && c.locale in TEXTS ? (c.locale as Locale) : 'ru';
  }

  /** Ближайшие подтверждённые записи номера во всех организациях (номер подтверждён WhatsApp). */
  async summary(tx: Tx, phone: string, locale: Locale, now = new Date()): Promise<string> {
    const t = TEXTS[locale];
    const rows = await tx.appointment.findMany({
      where: { status: 'confirmed', startAt: { gt: now }, client: { phone, mergedIntoId: null, anonymizedAt: null } },
      orderBy: { startAt: 'asc' },
      take: MAX_LISTED,
      include: { branch: { select: { name: true, address: true, phone: true, timezone: true } }, items: { orderBy: { position: 'asc' }, select: { serviceNameSnapshot: true } } },
    });
    if (rows.length === 0) return t.none;
    const lines = rows.map((a) => {
      const dt = DateTime.fromJSDate(a.startAt, { zone: a.branch.timezone }).setLocale(locale);
      const when = [dt.toFormat('d MMMM'), t.at, dt.toFormat('HH:mm')].filter(Boolean).join(' ');
      const where = [`«${a.branch.name}»`, a.branch.address].filter(Boolean).join(', ');
      const services = a.items.map((i) => i.serviceNameSnapshot).join(', ');
      const phonePart = a.branch.phone ? `, ${t.phone} ${a.branch.phone}` : '';
      return `• ${when} — ${where}: ${services}${phonePart}`;
    });
    return `${t.header}\n${lines.join('\n')}`;
  }

  /** Срок хранения журнала входящих — 30 дней (текст сообщений не хранится). */
  async cleanup(): Promise<number> {
    const r = await this.prisma.whatsappInboundMessage.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86400_000) } } });
    return r.count;
  }
}
