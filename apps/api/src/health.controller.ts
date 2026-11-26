import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators';
import { PrismaService } from './common/prisma.service';

/** Статистика очереди уведомлений пересчитывается не чаще раза в это время (публичный эндпоинт мониторинга). */
export const QUEUE_STATS_TTL_MS = 30_000;

interface QueueStats {
  pending: number;
  dead: number;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  private queueStats: { value: QueueStats; at: number } | null = null;
  private queueStatsLoading: Promise<QueueStats> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Проверка работоспособности (API + БД; размер очереди уведомлений — с кешем 30 с)' })
  async health() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - started;
    return {
      status: 'ok',
      db: { latencyMs },
      notifications: await this.cachedQueueStats(),
      time: new Date().toISOString(),
    };
  }

  /**
   * count(*) по notification_outbox — полный проход по таблице; публичный health вызывается часто
   * (оркестратор, мониторинг, кто угодно извне), поэтому результат кешируется, а параллельные вызовы
   * ждут один общий запрос.
   */
  private async cachedQueueStats(): Promise<QueueStats> {
    if (this.queueStats && Date.now() - this.queueStats.at < QUEUE_STATS_TTL_MS) return this.queueStats.value;
    this.queueStatsLoading ??= this.loadQueueStats().finally(() => {
      this.queueStatsLoading = null;
    });
    return this.queueStatsLoading;
  }

  private async loadQueueStats(): Promise<QueueStats> {
    const [queue] = await this.prisma.$queryRaw<Array<{ pending: bigint; dead: bigint }>>`
      SELECT count(*) FILTER (WHERE status IN ('pending','failed')) AS pending,
             count(*) FILTER (WHERE status = 'dead') AS dead
      FROM notification_outbox`;
    const value = { pending: Number(queue?.pending ?? 0), dead: Number(queue?.dead ?? 0) };
    this.queueStats = { value, at: Date.now() };
    return value;
  }
}
