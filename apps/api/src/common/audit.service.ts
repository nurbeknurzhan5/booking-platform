import { Injectable } from '@nestjs/common';
import { PrismaService, type Tx } from './prisma.service';
import type { ActorContext } from './request-context';
import { Prisma } from '../generated/prisma/client';

const REDACT_KEYS = new Set(['passwordHash', 'password', 'mfaSecretEnc', 'accessTokenEnc', 'secretEnc', 'codeHash', 'tokenHash', 'temporaryPassword']);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

/** Журнал аудита критических действий (§3.4, §22). Таблица append-only. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    actor: ActorContext,
    action: string,
    entityType: string,
    entityId: string | null,
    data: { before?: unknown; after?: unknown; organizationId?: string | null } = {},
    tx?: Tx,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        organizationId: data.organizationId ?? actor.organizationId ?? null,
        actorUserId: actor.userId,
        actorType: actor.actorType,
        action,
        entityType,
        entityId,
        before: data.before === undefined ? Prisma.DbNull : (redact(data.before) as Prisma.InputJsonValue),
        after: data.after === undefined ? Prisma.DbNull : (redact(data.after) as Prisma.InputJsonValue),
        ip: actor.ip,
        userAgent: actor.userAgent,
      },
    });
  }
}
