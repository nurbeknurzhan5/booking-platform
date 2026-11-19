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

/** Ищет код ошибки PostgreSQL в цепочке ошибок Prisma/драйвера. */
export function pgErrorCode(err: unknown, depth = 0): string | null {
  if (!err || typeof err !== 'object' || depth > 6) return null;
  const e = err as Record<string, unknown>;
  for (const k of ['originalCode', 'code']) {
    const v = e[k];
    if (typeof v === 'string' && /^[0-9A-Z]{5}$/.test(v)) return v;
  }
  for (const k of ['cause', 'meta', 'driverAdapterError', 'error']) {
    const found = pgErrorCode(e[k], depth + 1);
    if (found) return found;
  }
  const msg = typeof e.message === 'string' ? e.message : '';
  if (msg.includes('appointment_resources_no_overlap') || msg.includes('exclusion constraint')) return '23P01';
  return null;
}

export function isExclusionViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23P01';
}

export function isUniqueViolation(err: unknown): boolean {
  const code = pgErrorCode(err);
  if (code === '23505') return true;
  return (err as { code?: string })?.code === 'P2002';
}
