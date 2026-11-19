import { Injectable } from '@nestjs/common';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationSettingsSchema,
  type NotificationChannel,
  type NotificationType,
} from '@booking/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { encrypt } from '../common/crypto';
import { getConfig } from '../config/config';
import { SystemSettingsService } from '../common/system-settings.service';
import type { Prisma } from '../generated/prisma/client';

export interface EnqueueArgs {
  organizationId: string | null;
  type: NotificationType;
  /** Ключ события: одинаковый ключ — одно событие, без дублей (§15.2). */
  eventKey: string;
  recipient: string;
  locale: string;
  params: Record<string, string>;
  appointmentId?: string | null;
  clientId?: string | null;
  /** Параметры содержат секрет (OTP) — шифруются и стираются после отправки. */
  sensitive?: boolean;
  /** Не отправлять после этого момента (например, OTP после истечения). */
  expiresAt?: Date;
  /** Явный канал (используется для fallback). */
  forceChannel?: NotificationChannel;
}

export interface ConsentState {
  notifications: boolean;
  whatsapp: boolean;
}

/**
 * Постановка уведомлений в Outbox. Вызывается в транзакции бизнес-операции,
 * поэтому событие и сообщения фиксируются атомарно вместе с изменением данных.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
  ) {}

  enabledChannels(): NotificationChannel[] {
    const cfg = getConfig();
    const list = cfg.NOTIFICATION_CHANNELS.filter((c): c is NotificationChannel =>
      ['whatsapp', 'sms', 'email', 'dev_inbox'].includes(c),
    );
    return cfg.APP_ENV === 'production' ? list.filter((c) => c !== 'dev_inbox') : list;
  }

  /** Выбор канала по типу сообщения, настройкам организации и согласиям клиента. */
  selectChannel(
    type: NotificationType,
    orgSettings: { whatsappEnabled: boolean; smsEnabled: boolean },
    consent: ConsentState,
  ): NotificationChannel | null {
    const enabled = this.enabledChannels();
    if (enabled.includes('dev_inbox')) return 'dev_inbox';
    if (type === 'otp') {
      const order = getConfig().OTP_CHANNELS.length ? getConfig().OTP_CHANNELS : ['whatsapp', 'sms'];
      return (order.find((c) => enabled.includes(c as NotificationChannel)) as NotificationChannel | undefined) ?? null;
    }
    if (!consent.notifications) return null;
    if (enabled.includes('whatsapp') && orgSettings.whatsappEnabled && consent.whatsapp) return 'whatsapp';
    if (enabled.includes('sms') && orgSettings.smsEnabled) return 'sms';
    return null;
  }

  async orgNotificationSettings(tx: Tx, organizationId: string | null) {
    if (!organizationId) return DEFAULT_NOTIFICATION_SETTINGS;
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { notificationSettings: true } });
    const parsed = NotificationSettingsSchema.safeParse({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...((org?.notificationSettings as object) ?? {}),
    });
    return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_SETTINGS;
  }

  /** Текущие согласия по номеру (последняя запись по типу). */
  async consentFor(tx: Tx, phone: string, organizationId: string | null): Promise<ConsentState> {
    const rows = await tx.clientConsent.findMany({
      where: { phone, consentType: { in: ['notifications', 'whatsapp'] }, OR: [{ organizationId }, { organizationId: null }] },
      orderBy: { createdAt: 'desc' },
      select: { consentType: true, granted: true },
    });
    const latest = (t: string) => rows.find((r) => r.consentType === t)?.granted;
    return { notifications: latest('notifications') ?? true, whatsapp: latest('whatsapp') ?? true };
  }

  /**
   * Создаёт событие и сообщение. Повторный вызов с тем же eventKey ничего не создаёт.
   * Возвращает id сообщения или null (канал недоступен / дубль).
   */
  async enqueue(tx: Tx, args: EnqueueArgs): Promise<string | null> {
    const orgSettings = await this.orgNotificationSettings(tx, args.organizationId);
    if (args.type === 'appointment_reminder' && !orgSettings.reminderEnabled) return null;
    if (args.type === 'review_request' && !orgSettings.reviewRequestEnabled) return null;
    const consent = args.type === 'otp' ? { notifications: true, whatsapp: true } : await this.consentFor(tx, args.recipient, args.organizationId);
    const channel = args.forceChannel ?? this.selectChannel(args.type, orgSettings, consent);
    if (!channel) return null;

    const event = await tx.notificationEvent.upsert({
      where: { dedupeKey: args.eventKey },
      create: {
        organizationId: args.organizationId,
        type: args.type,
        dedupeKey: args.eventKey,
        appointmentId: args.appointmentId ?? null,
      },
      update: {},
    });

    const dedupeKey = `${args.eventKey}:${channel}:${args.recipient}`;
    const existing = await tx.notificationOutbox.findUnique({ where: { dedupeKey }, select: { id: true } });
    if (existing) return null;

    const s = await this.settings.get();
    const payload: Prisma.InputJsonValue = args.sensitive
      ? { enc: encrypt(getConfig().ENCRYPTION_KEY, JSON.stringify(args.params)) }
      : args.params;
    const row = await tx.notificationOutbox.create({
      data: {
        organizationId: args.organizationId,
        eventId: event.id,
        appointmentId: args.appointmentId ?? null,
        clientId: args.clientId ?? null,
        type: args.type,
        channel,
        recipient: args.recipient,
        locale: args.locale,
        payload,
        payloadEncrypted: !!args.sensitive,
        dedupeKey,
        maxAttempts: args.type === 'otp' ? 3 : s.notificationMaxAttempts,
        expiresAt: args.expiresAt ?? null,
      },
    });
    return row.id;
  }

  /** Отменить неотправленные сообщения записи (например, напоминание после отмены). */
  async cancelPending(tx: Tx, appointmentId: string, types: NotificationType[]): Promise<void> {
    await tx.notificationOutbox.updateMany({
      where: { appointmentId, type: { in: types }, status: { in: ['pending', 'failed'] } },
      data: { status: 'cancelled' },
    });
  }
}
