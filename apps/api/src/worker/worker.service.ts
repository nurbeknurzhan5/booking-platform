import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { NotificationDispatcher } from '../notifications/dispatcher.service';
import { BookingService } from '../booking/booking.service';
import { RemindersService } from '../booking/reminders.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { RateLimitService } from '../common/rate-limit.service';
import { IdempotencyService } from '../common/idempotency.service';
import { SessionService } from '../auth/session.service';
import { OtpService } from '../auth/otp.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { TranslationService } from '../pages/translation.service';

interface Task {
  name: string;
  intervalMs: number;
  /** Задача-одиночка: выполняется только одним экземпляром воркера (pg advisory lock). */
  singleton: boolean;
  run: () => Promise<unknown>;
}

/**
 * Фоновый воркер (отдельный процесс): outbox, освобождение резервов, статусы подписок,
 * напоминания, аналитика, автоперевод, очистка. Надёжность: задачи идемпотентны,
 * параллельные экземпляры безопасны (SKIP LOCKED / advisory locks).
 */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Worker');
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcher,
    private readonly booking: BookingService,
    private readonly reminders: RemindersService,
    private readonly subscriptions: SubscriptionsService,
    private readonly rateLimit: RateLimitService,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: SessionService,
    private readonly otp: OtpService,
    private readonly analytics: AnalyticsService,
    private readonly translations: TranslationService,
  ) {}

  tasks(): Task[] {
    return [
      { name: 'outbox', intervalMs: 2_000, singleton: false, run: async () => (await this.dispatcher.reclaimStuck(), this.dispatcher.drain(500)) },
      { name: 'holds', intervalMs: 15_000, singleton: false, run: () => this.prisma.$transaction((tx) => this.booking.releaseExpiredHolds(tx, {}, 500)) },
      { name: 'reminders', intervalMs: 60_000, singleton: true, run: () => this.reminders.enqueueDue() },
      { name: 'subscriptions', intervalMs: 5 * 60_000, singleton: true, run: () => this.subscriptions.refreshStatuses() },
      { name: 'analytics', intervalMs: 10 * 60_000, singleton: true, run: () => this.analytics.aggregateRecent() },
      { name: 'translations', intervalMs: 30_000, singleton: true, run: () => this.translations.processQueue() },
      {
        name: 'cleanup',
        intervalMs: 60 * 60_000,
        singleton: true,
        run: async () => {
          await this.rateLimit.cleanup();
          await this.idempotency.cleanup();
          await this.sessions.cleanupExpired();
          await this.otp.cleanup();
        },
      },
    ];
  }

  onApplicationBootstrap(): void {
    if (process.env.WORKER_DISABLED === 'true') return;
    for (const task of this.tasks()) {
      const tick = () => void this.runTask(task);
      tick();
      this.timers.push(setInterval(tick, task.intervalMs));
    }
    this.logger.log('Worker started');
  }

  async runTask(task: Task): Promise<void> {
    if (this.stopping || this.running.has(task.name)) return;
    this.running.add(task.name);
    try {
      if (task.singleton) {
        // Транзакционная блокировка держится на одном соединении пула всё время выполнения задачи
        // и снимается автоматически при завершении транзакции (в т.ч. при сбое процесса).
        const key = `worker:${task.name}`;
        await this.prisma.$transaction(
          async (tx) => {
            const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
            if (!rows[0]?.locked) return;
            await task.run();
          },
          { timeout: 15 * 60_000, maxWait: 10_000 },
        );
      } else {
        await task.run();
      }
    } catch (e) {
      this.logger.error({ err: e, task: task.name }, 'Worker task failed');
    } finally {
      this.running.delete(task.name);
    }
  }

  onApplicationShutdown(): void {
    this.stopping = true;
    for (const t of this.timers) clearInterval(t);
  }
}
