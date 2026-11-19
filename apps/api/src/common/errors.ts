import { HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@booking/shared';

/** Единое исключение приложения. Фильтр превращает его в { error: { code, message, details } }. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: HttpStatus,
    message: string,
    public readonly details?: unknown,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(what = 'Ресурс'): AppError {
    return new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `${what} не найден`);
  }
  static forbidden(message = 'Недостаточно прав'): AppError {
    return new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, message);
  }
  static unauthenticated(message = 'Требуется вход'): AppError {
    return new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, message);
  }
  static conflict(message: string, details?: unknown): AppError {
    return new AppError('CONFLICT', HttpStatus.CONFLICT, message, details);
  }
  static badRequest(code: ErrorCode, message: string, details?: unknown): AppError {
    return new AppError(code, HttpStatus.BAD_REQUEST, message, details);
  }
  static unprocessable(code: ErrorCode, message: string, details?: unknown): AppError {
    return new AppError(code, HttpStatus.UNPROCESSABLE_ENTITY, message, details);
  }
  static rateLimited(retryAfterSec: number, code: ErrorCode = 'RATE_LIMITED'): AppError {
    return new AppError(code, HttpStatus.TOO_MANY_REQUESTS, 'Слишком много запросов, попробуйте позже', { retryAfterSec }, {
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))),
    });
  }
  static slotUnavailable(): AppError {
    return new AppError('SLOT_UNAVAILABLE', HttpStatus.CONFLICT, 'Выбранное время уже недоступно. Выберите другое время.');
  }
}

function findDeep(err: unknown, key: string, depth = 0): unknown {
  if (!err || typeof err !== 'object' || depth > 6) return undefined;
  const e = err as Record<string, unknown>;
  if (e[key] !== undefined) return e[key];
  for (const k of ['cause', 'meta', 'driverAdapterError', 'error']) {
    const v = findDeep(e[k], key, depth + 1);
    if (v !== undefined) return v;
  }
  return undefined;
}

function messagesDeep(err: unknown, depth = 0): string {
  if (!err || typeof err !== 'object' || depth > 6) return '';
  const e = err as Record<string, unknown>;
  const own = [e.message, e.originalMessage].filter((m): m is string => typeof m === 'string').join(' ');
  return own + ' ' + ['cause', 'meta', 'driverAdapterError'].map((k) => messagesDeep(e[k], depth + 1)).join(' ');
}

/**
 * Код ошибки PostgreSQL (SQLSTATE) в цепочке ошибок Prisma/драйвера.
 * Приоритет — originalCode драйвера; код Prisma вида P2xxx не является SQLSTATE.
 */
export function pgErrorCode(err: unknown): string | null {
  const original = findDeep(err, 'originalCode');
  if (typeof original === 'string' && original) return original;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && !/^P\d{4}$/.test(code)) return code;
  const msg = messagesDeep(err);
  if (msg.includes('appointment_resources_no_overlap') || msg.includes('clients_active_phone_unique')) return '23P01';
  return null;
}

export function isExclusionViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23P01';
}

/** Взаимоблокировка (40P01) или конфликт сериализации (40001) — транзакцию можно повторить. */
export function isTransientTxError(err: unknown): boolean {
  if ((err as { code?: string })?.code === 'P2034') return true;
  const c = pgErrorCode(err);
  return c === '40P01' || c === '40001';
}

export function isUniqueViolation(err: unknown): boolean {
  const code = pgErrorCode(err);
  if (code === '23505') return true;
  return (err as { code?: string })?.code === 'P2002';
}
