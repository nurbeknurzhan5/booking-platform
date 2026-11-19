import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AppError, isUniqueViolation } from './errors';
import { stableHash } from './crypto';
import type { Prisma } from '../generated/prisma/client';

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Идемпотентность операций создания/переноса/отмены (§21).
 * Первый запрос с ключом резервирует строку; повтор с тем же телом возвращает сохранённый ответ;
 * повтор с другим телом — 422 IDEMPOTENCY_KEY_REUSED; параллельный повтор — 409 IDEMPOTENCY_IN_PROGRESS.
 * Ошибочные ответы (4xx/5xx) не кэшируются: ключ освобождается, чтобы клиент мог повторить запрос.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    scope: string,
    key: string | undefined,
    request: unknown,
    handler: () => Promise<{ status?: number; body: T }>,
  ): Promise<IdempotentResult<T>> {
    if (!key) {
      const r = await handler();
      return { status: r.status ?? HttpStatus.OK, body: r.body, replayed: false };
    }
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
      throw AppError.badRequest('VALIDATION_ERROR', 'Некорректный Idempotency-Key (8–100 символов: буквы, цифры, _ и -)');
    }
    const requestHash = stableHash(request);
    let rowId: string;
    try {
      const row = await this.prisma.idempotencyKey.create({ data: { scope, key, requestHash } });
      rowId = row.id;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const existing = await this.prisma.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
      if (!existing) throw new AppError('IDEMPOTENCY_IN_PROGRESS', HttpStatus.CONFLICT, 'Повторите запрос');
      if (existing.requestHash !== requestHash) {
        throw AppError.unprocessable('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key уже использован для другого запроса');
      }
      if (!existing.completedAt) {
        throw new AppError('IDEMPOTENCY_IN_PROGRESS', HttpStatus.CONFLICT, 'Запрос с этим ключом ещё обрабатывается');
      }
      return { status: existing.responseStatus ?? 200, body: existing.responseBody as T, replayed: true };
    }

    try {
      const r = await handler();
      const status = r.status ?? HttpStatus.OK;
      await this.prisma.idempotencyKey.update({
        where: { id: rowId },
        data: { responseStatus: status, responseBody: r.body as Prisma.InputJsonValue, completedAt: new Date() },
      });
      return { status, body: r.body, replayed: false };
    } catch (e) {
      await this.prisma.idempotencyKey.delete({ where: { id: rowId } }).catch(() => undefined);
      throw e;
    }
  }

  async cleanup(olderThanHours = 48): Promise<number> {
    const r = await this.prisma.idempotencyKey.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - olderThanHours * 3600_000) } },
    });
    return r.count;
  }
}
