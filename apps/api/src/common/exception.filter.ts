import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { AppError, isExclusionViolation, isUniqueViolation, pgErrorCode } from './errors';
import type { AppRequest } from './request-context';

/** Единая обработка ошибок (ТЗ §19.2). Внутренние детали не раскрываются клиенту. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AppRequest>();

    const { status, body, headers } = this.map(exception);
    if (status >= 500) {
      this.logger.error({ err: exception, path: req.path, requestId: req.requestId }, 'Unhandled error');
    }
    if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.status(status).json(body);
  }

  private map(exception: unknown): {
    status: number;
    body: { error: { code: string; message: string; details?: unknown } };
    headers?: Record<string, string>;
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: { error: { code: exception.code, message: exception.message, details: exception.details } },
        headers: exception.headers,
      };
    }
    if (exception instanceof ZodValidationException) {
      const zerr = exception.getZodError() as { issues?: Array<{ path: PropertyKey[]; message: string; code: string }> };
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Некорректные данные запроса',
            details: (zerr.issues ?? []).map((i) => ({ path: i.path.map(String).join('.'), message: i.message, code: i.code })),
          },
        },
      };
    }
    if (isExclusionViolation(exception)) {
      const e = AppError.slotUnavailable();
      return { status: e.status, body: { error: { code: e.code, message: e.message } } };
    }
    if (isUniqueViolation(exception)) {
      return { status: HttpStatus.CONFLICT, body: { error: { code: 'CONFLICT', message: 'Запись с такими данными уже существует' } } };
    }
    const prismaCode = (exception as { code?: string })?.code;
    if (prismaCode === 'P2025') {
      return { status: HttpStatus.NOT_FOUND, body: { error: { code: 'NOT_FOUND', message: 'Ресурс не найден' } } };
    }
    if (prismaCode === 'P2003' || pgErrorCode(exception) === '23503') {
      return { status: HttpStatus.BAD_REQUEST, body: { error: { code: 'VALIDATION_ERROR', message: 'Ссылка на несуществующий объект' } } };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 413 ? 'FILE_TOO_LARGE' : 'VALIDATION_ERROR';
      const resp = exception.getResponse();
      const message = typeof resp === 'string' ? resp : ((resp as { message?: string }).message ?? exception.message);
      return { status, body: { error: { code, message: Array.isArray(message) ? message.join('; ') : String(message) } } };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' } },
    };
  }
}
