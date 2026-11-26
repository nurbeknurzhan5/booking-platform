import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AppError, isUniqueViolation } from './errors';
import { stableHash } from './crypto';
import type { Prisma } from '../generated/prisma/client';

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/** Срок хранения ключа: столько же, сколько живёт строка до очистки воркером. */
export const IDEMPOTENCY_TTL_HOURS = 48;
/**
 * Ключ «в работе» дольше этого срока считается брошенным (процесс упал, не записав ответ):
 * повтор с тем же телом выполняется заново, а не получает 409 до очистки через 48 ч.
 */
export const IDEMPOTENCY_STALE_MS = 10 * 60_000;
const MAX_RESERVE_ATTEMPTS = 3;

/**
 * Идемпотентность операций создания/переноса/отмены (§21).
 * Первый запрос с ключом резервирует строку; повтор с тем же телом возвращает сохранённый ответ;
 * повтор с другим телом — 422 IDEMPOTENCY_KEY_REUSED; параллельный повтор — 409 IDEMPOTENCY_IN_PROGRESS.
 * Ошибочные ответы (4xx/5xx) не кэшируются: ключ освобождается, чтобы клиент мог повторить запрос.
 * Ключ просроченный (старше TTL, ещё не удалённый очисткой) считается свободным.
 * Область (scope) включает действующее лицо, чтобы ключи разных клиентов и сотрудников не пересекались.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

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
    const reserved = await this.reserve<T>(scope, key, requestHash);
    if ('replay' in reserved) return reserved.replay;

    let r: { status?: number; body: T };
    try {
      r = await handler();
    } catch (e) {
      await this.prisma.idempotencyKey.delete({ where: { id: reserved.rowId } }).catch(() => undefined);
      throw e;
    }
    const status = r.status ?? HttpStatus.OK;
    // Операция уже выполнена: сбой записи ответа не должен превращать успех в ошибку (и освобождать ключ —
    // иначе повтор выполнит операцию второй раз). Строка останется «в работе» и освободится как брошенная.
    await this.prisma.idempotencyKey
      .update({ where: { id: reserved.rowId }, data: { responseStatus: status, responseBody: r.body as Prisma.InputJsonValue, completedAt: new Date() } })
      .catch((e: unknown) => this.logger.error({ err: e, scope }, 'Idempotency response was not stored'));
    return { status, body: r.body, replayed: false };
  }

  /** Резерв строки ключа или сохранённый ответ для повтора. */
  private async reserve<T>(scope: string, key: string, requestHash: string): Promise<{ rowId: string } | { replay: IdempotentResult<T> }> {
    for (let attempt = 1; ; attempt++) {
      try {
        const row = await this.prisma.idempotencyKey.create({ data: { scope, key, requestHash } });
        return { rowId: row.id };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
      const retry = attempt < MAX_RESERVE_ATTEMPTS;
      const existing = await this.prisma.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
      if (!existing) {
        // строку только что освободили (ошибка первого запроса) — пробуем занять снова
        if (retry) continue;
        throw new AppError('IDEMPOTENCY_IN_PROGRESS', HttpStatus.CONFLICT, 'Повторите запрос');
      }
      const age = Date.now() - existing.createdAt.getTime();
      const expired = age > IDEMPOTENCY_TTL_HOURS * 3600_000;
      const abandoned = !existing.completedAt && age > IDEMPOTENCY_STALE_MS && existing.requestHash === requestHash;
      if ((expired || abandoned) && retry) {
        await this.prisma.idempotencyKey.deleteMany({ where: { id: existing.id, completedAt: existing.completedAt } });
        continue;
      }
      if (existing.requestHash !== requestHash) {
        throw AppError.unprocessable('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key уже использован для другого запроса');
      }
      if (!existing.completedAt) {
        throw new AppError('IDEMPOTENCY_IN_PROGRESS', HttpStatus.CONFLICT, 'Запрос с этим ключом ещё обрабатывается');
      }
      return { replay: { status: existing.responseStatus ?? 200, body: existing.responseBody as T, replayed: true } };
    }
  }

  async cleanup(olderThanHours = IDEMPOTENCY_TTL_HOURS): Promise<number> {
    const r = await this.prisma.idempotencyKey.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - olderThanHours * 3600_000) } },
    });
    return r.count;
  }
}
