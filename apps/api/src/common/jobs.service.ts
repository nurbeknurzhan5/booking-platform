import { Injectable } from '@nestjs/common';
import { hostname } from 'node:os';
import { PrismaService, type Tx } from './prisma.service';
import type { Job, Prisma } from '../generated/prisma/client';

/** Очередь фоновых задач на PostgreSQL (FOR UPDATE SKIP LOCKED), утверждённое решение D-01. */
@Injectable()
export class JobsService {
  private readonly workerId = `${hostname()}:${process.pid}`;

  constructor(private readonly prisma: PrismaService) {}

  /** Постановка задачи; при совпадении dedupeKey повторная постановка игнорируется. */
  async enqueue(queue: string, payload: Prisma.InputJsonValue, opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {}, tx?: Tx) {
    const db = tx ?? this.prisma;
    if (opts.dedupeKey) {
      await db.job.upsert({
        where: { dedupeKey: opts.dedupeKey },
        create: { queue, payload, dedupeKey: opts.dedupeKey, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 5 },
        update: {},
      });
      return;
    }
    await db.job.create({ data: { queue, payload, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 5 } });
  }

  async claim(queue: string, limit: number): Promise<Job[]> {
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE jobs SET status = 'running', locked_at = now(), locked_by = ${this.workerId}, attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM jobs WHERE queue = ${queue} AND status IN ('pending', 'failed') AND run_at <= now()
        ORDER BY run_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
      ) RETURNING id`;
    if (!ids.length) return [];
    return this.prisma.job.findMany({ where: { id: { in: ids.map((r) => r.id) } } });
  }

  async complete(id: string): Promise<void> {
    await this.prisma.job.update({ where: { id }, data: { status: 'done', finishedAt: new Date(), lockedAt: null, lockedBy: null } });
  }

  async fail(job: Job, error: string, retryable = true): Promise<void> {
    const dead = !retryable || job.attempts >= job.maxAttempts;
    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: dead ? 'dead' : 'failed',
        lastError: error.slice(0, 1000),
        runAt: new Date(Date.now() + Math.min(60_000 * 2 ** job.attempts, 3600_000)),
        lockedAt: null,
        lockedBy: null,
      },
    });
  }
}
