import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AppError } from './errors';
import type { ErrorCode } from '@booking/shared';

export interface RateLimitResult {
  count: number;
  allowed: boolean;
  retryAfterSec: number;
}

/**
 * Rate limit на PostgreSQL (утверждённое решение D-01): атомарный upsert фиксированного окна.
 * Интерфейс позволяет заменить хранилище на Redis без изменения вызывающего кода.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const rows = await this.prisma.$queryRaw<Array<{ count: number; expires_at: Date }>>`
      INSERT INTO rate_limit_buckets (key, count, expires_at)
      VALUES (${key}, 1, now() + make_interval(secs => ${windowSec}))
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limit_buckets.expires_at <= now() THEN 1 ELSE rate_limit_buckets.count + 1 END,
        expires_at = CASE WHEN rate_limit_buckets.expires_at <= now()
                          THEN now() + make_interval(secs => ${windowSec})
                          ELSE rate_limit_buckets.expires_at END
      RETURNING count, expires_at`;
    const row = rows[0]!;
    const retryAfterSec = Math.max(0, (row.expires_at.getTime() - Date.now()) / 1000);
    return { count: row.count, allowed: row.count <= limit, retryAfterSec };
  }

  async consume(key: string, limit: number, windowSec: number, code: ErrorCode = 'RATE_LIMITED'): Promise<void> {
    const r = await this.hit(key, limit, windowSec);
    if (!r.allowed) throw AppError.rateLimited(r.retryAfterSec, code);
  }

  async cleanup(): Promise<number> {
    return this.prisma.$executeRaw`DELETE FROM rate_limit_buckets WHERE expires_at < now()`;
  }
}
