import { Injectable, Logger } from '@nestjs/common';
import { hostname } from 'node:os';
import type { NotificationChannel } from '@booking/shared';
import { PrismaService } from '../common/prisma.service';
import { decrypt } from '../common/crypto';
import { getConfig } from '../config/config';
import { ChannelError, DevInboxChannel, SmsChannel, WhatsAppChannel, type ChannelAdapter, type OutgoingMessage } from './channels';
import { NotificationService } from './notification.service';
import { maskPhone } from '@booking/shared';
import type { NotificationOutbox } from '../generated/prisma/client';

const STUCK_SENDING_MS = 5 * 60_000;

export function backoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 3600_000);
}

export function renderTemplate(body: string, params: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => params[k] ?? '');
}

/**
 * Отдельный процесс-отправитель (§15.2): забирает сообщения из Outbox через SKIP LOCKED,
 * отправляет через адаптер канала, повторяет с экспоненциальной задержкой, переводит в dead (DLQ).
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);
  private readonly workerId = getConfig().WORKER_ID ?? `${hostname()}:${process.pid}`;
  private readonly adapters: Map<NotificationChannel, ChannelAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    whatsapp: WhatsAppChannel,
    sms: SmsChannel,
    dev: DevInboxChannel,
  ) {
    this.adapters = new Map<NotificationChannel, ChannelAdapter>([
      ['whatsapp', whatsapp],
      ['sms', sms],
      ['dev_inbox', dev],
    ]);
  }

  /** Возврат «зависших» сообщений (воркер упал во время отправки). */
  async reclaimStuck(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE notification_outbox SET status = 'failed', locked_at = NULL, locked_by = NULL,
        last_error = 'reclaimed after worker timeout', updated_at = now()
      WHERE status = 'sending' AND locked_at < ${new Date(Date.now() - STUCK_SENDING_MS)}`;
  }

  private async claim(limit: number): Promise<NotificationOutbox[]> {
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE notification_outbox SET status = 'sending', locked_at = now(), locked_by = ${this.workerId},
        attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM notification_outbox
        WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (!ids.length) return [];
    return this.prisma.notificationOutbox.findMany({ where: { id: { in: ids.map((r) => r.id) } } });
  }

  async processBatch(limit = 25): Promise<number> {
    const rows = await this.claim(limit);
    for (const row of rows) await this.deliver(row);
    return rows.length;
  }

  /** Обработать все готовые сообщения (используется в тестах и при старте воркера). */
  async drain(max = 1000): Promise<number> {
    let total = 0;
    while (total < max) {
      const n = await this.processBatch();
      if (n === 0) break;
      total += n;
    }
    return total;
  }

  private async buildMessage(row: NotificationOutbox): Promise<OutgoingMessage> {
    const params = row.payloadEncrypted
      ? (JSON.parse(decrypt(getConfig().ENCRYPTION_KEY, (row.payload as { enc: string }).enc)) as Record<string, string>)
      : (row.payload as Record<string, string>);
    const tpl =
      (await this.prisma.notificationTemplate.findUnique({ where: { type_channel_locale: { type: row.type, channel: row.channel, locale: row.locale } } })) ??
      (await this.prisma.notificationTemplate.findUnique({ where: { type_channel_locale: { type: row.type, channel: row.channel, locale: 'ru' } } }));
    if (!tpl || !tpl.isActive) throw new ChannelError(`Нет активного шаблона ${row.type}/${row.channel}`, false, 'NO_TEMPLATE');
    return {
      recipient: row.recipient,
      type: row.type,
      locale: tpl.locale,
      params,
      text: renderTemplate(tpl.body, params),
      providerTemplateName: tpl.providerTemplateName,
      templateVariables: (tpl.variables as string[]) ?? [],
      category: tpl.category,
    };
  }

  private async deliver(row: NotificationOutbox): Promise<void> {
    const startedAt = new Date();
    const wipe = row.payloadEncrypted ? { payload: {} } : {};
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      await this.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: { status: 'cancelled', lastError: 'expired before delivery', lockedAt: null, lockedBy: null, ...wipe },
      });
      return;
    }
    const adapter = this.adapters.get(row.channel);
    try {
      if (!adapter) throw new ChannelError(`Канал ${row.channel} не поддерживается`, false, 'NO_ADAPTER');
      const msg = await this.buildMessage(row);
      const { providerMessageId } = await adapter.send(msg);
      await this.prisma.$transaction([
        this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: { status: 'sent', sentAt: new Date(), providerMessageId, lastError: null, lockedAt: null, lockedBy: null, ...wipe },
        }),
        this.prisma.notificationAttempt.create({
          data: { outboxId: row.id, attemptNo: row.attempts, startedAt, finishedAt: new Date(), success: true, providerMessageId },
        }),
      ]);
    } catch (e) {
      const err = e instanceof ChannelError ? e : new ChannelError((e as Error).message, true, 'INTERNAL');
      const dead = !err.retryable || row.attempts >= row.maxAttempts;
      if (dead && row.type === 'otp' && row.channel === 'whatsapp') await this.fallbackOtpToSms(row);
      // Текст ошибки не содержит параметров сообщения; номер в логах маскируется.
      this.logger.warn({ outboxId: row.id, channel: row.channel, to: maskPhone(row.recipient), code: err.code, dead }, 'Notification delivery failed');
      await this.prisma.$transaction([
        this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: {
            status: dead ? 'dead' : 'failed',
            nextAttemptAt: new Date(Date.now() + backoffMs(row.attempts)),
            lastError: `${err.code}: ${err.message}`.slice(0, 1000),
            lockedAt: null,
            lockedBy: null,
            ...(dead ? wipe : {}),
          },
        }),
        this.prisma.notificationAttempt.create({
          data: {
            outboxId: row.id,
            attemptNo: row.attempts,
            startedAt,
            finishedAt: new Date(),
            success: false,
            httpStatus: err.httpStatus,
            errorCode: err.code,
            errorMessage: err.message.slice(0, 1000),
          },
        }),
      ]);
    }
  }

  /**
   * OTP: если доставка через WhatsApp окончательно не удалась — резервный канал SMS (если подключён).
   * Зашифрованный payload копируется в новое сообщение до стирания исходного.
   */
  private async fallbackOtpToSms(row: NotificationOutbox) {
    if (!this.notifications.enabledChannels().includes('sms')) return;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return;
    await this.prisma.notificationOutbox
      .create({
        data: {
          organizationId: row.organizationId,
          eventId: row.eventId,
          appointmentId: row.appointmentId,
          clientId: row.clientId,
          type: row.type,
          channel: 'sms',
          recipient: row.recipient,
          locale: row.locale,
          payload: row.payload as object,
          payloadEncrypted: row.payloadEncrypted,
          dedupeKey: `${row.dedupeKey}:fallback:sms`,
          maxAttempts: 3,
          expiresAt: row.expiresAt,
        },
      })
      .catch(() => undefined); // уже создан (уникальный ключ) — повторная обработка без дублей
  }

  /** Ручной повтор сообщения из DLQ (суперадмин). */
  async retryDead(outboxId: string): Promise<boolean> {
    const r = await this.prisma.notificationOutbox.updateMany({
      where: { id: outboxId, status: 'dead', payloadEncrypted: false },
      data: { status: 'pending', nextAttemptAt: new Date(), maxAttempts: { increment: 1 }, lastError: null },
    });
    return r.count === 1;
  }
}
