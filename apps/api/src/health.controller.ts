import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators';
import { PrismaService } from './common/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Проверка работоспособности (API + БД + очередь)' })
  async health() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const [queue] = await this.prisma.$queryRaw<Array<{ pending: bigint; dead: bigint }>>`
      SELECT count(*) FILTER (WHERE status IN ('pending','failed')) AS pending,
             count(*) FILTER (WHERE status = 'dead') AS dead
      FROM notification_outbox`;
    return {
      status: 'ok',
      db: { latencyMs: Date.now() - started },
      notifications: { pending: Number(queue?.pending ?? 0), dead: Number(queue?.dead ?? 0) },
      time: new Date().toISOString(),
    };
  }
}
