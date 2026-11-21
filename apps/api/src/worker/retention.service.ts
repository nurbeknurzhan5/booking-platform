import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

/**
 * Сроки хранения технических журналов (ТЗ §22, правила обработки ПД `content/legal/processing.md` §2).
 * Сроки — предложение разработчика до проверки юристом; меняются здесь.
 * Обезличивание карточек клиентов по сроку бездействия автоматически НЕ выполняется:
 * это необратимо и требует утверждённого срока. Сейчас — вручную владельцем.
 */
export const RETENTION_DAYS = {
  /** Журнал уведомлений: сообщения, попытки, статусы доставки, события. */
  notifications: 365,
  /** Сырые аналитические события (без ПД). Дневные агрегаты хранятся бессрочно. */
  analyticsEvents: 730,
  /** Канал dev_inbox (только dev/test). */
  devInbox: 7,
} as const;

const BATCH = 5000;

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Удаление порциями: без долгих блокировок больших таблиц. Возвращает число удалённых строк по журналам. */
  async run(now = new Date()): Promise<Record<string, number>> {
    const before = (days: number) => new Date(now.getTime() - days * 86400_000);
    const nBefore = before(RETENTION_DAYS.notifications);
    const result = {
      notificationOutbox: await this.drain(() =>
        // Только завершённые сообщения: неотправленные и отправляемые не трогаем (попытки удаляются каскадно).
        this.prisma.$executeRaw`
          DELETE FROM notification_outbox WHERE id IN (
            SELECT id FROM notification_outbox
            WHERE created_at < ${nBefore} AND status IN ('sent', 'delivered', 'read', 'dead', 'cancelled')
            LIMIT ${BATCH})`,
      ),
      whatsappStatuses: await this.drain(() =>
        this.prisma.$executeRaw`
          DELETE FROM whatsapp_message_statuses WHERE id IN (
            SELECT id FROM whatsapp_message_statuses WHERE created_at < ${nBefore} LIMIT ${BATCH})`,
      ),
      notificationEvents: await this.drain(() =>
        this.prisma.$executeRaw`
          DELETE FROM notification_events WHERE id IN (
            SELECT e.id FROM notification_events e
            WHERE e.created_at < ${nBefore}
              -- ключ реактивации хранится дольше: по нему действует правило «одно сообщение на период без визитов» (D-34)
              AND e.type <> 'reactivation'
              AND NOT EXISTS (SELECT 1 FROM notification_outbox o WHERE o.event_id = e.id)
            LIMIT ${BATCH})`,
      ),
      analyticsEvents: await this.drain(() =>
        this.prisma.$executeRaw`
          DELETE FROM analytics_events WHERE id IN (
            SELECT id FROM analytics_events WHERE occurred_at < ${before(RETENTION_DAYS.analyticsEvents)} LIMIT ${BATCH})`,
      ),
      devInbox: (await this.prisma.devInboxMessage.deleteMany({ where: { createdAt: { lt: before(RETENTION_DAYS.devInbox) } } })).count,
    };
    const total = Object.values(result).reduce((s, n) => s + n, 0);
    if (total) this.logger.log({ ...result }, 'Retention cleanup');
    return result;
  }

  private async drain(step: () => Promise<number>, maxBatches = 200): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
      const n = await step();
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }
}
