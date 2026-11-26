import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ErrorRequestHandler, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { AppError, isExclusionViolation, isUniqueViolation, pgErrorCode } from './errors';
import type { AppRequest } from './request-context';
import { redactUrlPath } from './logging';

/** Ошибка разбора тела запроса (body-parser / raw-body, http-errors): статус 4xx и тип вида «entity.too.large». */
interface BodyParserError {
  status: number;
  type: string;
  limit?: number;
}

export function isBodyParserError(e: unknown): e is BodyParserError {
  if (!e || typeof e !== 'object' || e instanceof HttpException || e instanceof AppError) return false;
  const { status, type } = e as { status?: unknown; type?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && typeof type === 'string';
}

/**
 * Express-обработчик сразу после body-parser. Nest превращает SyntaxError парсера в BadRequestException
 * с текстом парсера («Unterminated string in JSON…»), теряя тип ошибки. Здесь ошибка тела заменяется обычной
 * Error с теми же status/type/limit — дальше её разбирает AllExceptionsFilter (bodyParserResponse).
 */
export const bodyParserErrorHandler: ErrorRequestHandler = (err: unknown, _req, _res, next) => {
  if (!isBodyParserError(err)) return next(err);
  next(Object.assign(new Error('Request body rejected'), { status: err.status, type: err.type, limit: err.limit }));
};

type ErrorResponse = { status: number; body: { error: { code: string; message: string; details?: unknown } }; headers?: Record<string, string> };

/** Ответ на ошибку тела запроса: понятные коды и сообщения вместо 500 и текста парсера. */
function bodyParserResponse(e: BodyParserError): ErrorResponse {
  const err = (status: number, code: string, message: string, details?: unknown): ErrorResponse => ({ status, body: { error: { code, message, details } } });
  switch (e.type) {
    case 'entity.too.large': {
      const mb = e.limit ? Math.round((e.limit / 1024 / 1024) * 10) / 10 : null;
      return err(HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', mb ? `Слишком большой запрос: не более ${mb} МБ` : 'Слишком большой запрос');
    }
    case 'entity.parse.failed':
      return err(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Некорректный JSON в теле запроса');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return err(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_MEDIA_TYPE', 'Неподдерживаемая кодировка тела запроса: используйте UTF-8 без сжатия');
    case 'request.aborted':
      return err(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Запрос прерван до получения всего тела');
    case 'request.size.invalid':
      return err(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Размер тела запроса не совпадает с Content-Length');
    case 'parameters.too.many':
      return err(HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', 'Слишком много параметров в теле запроса');
    default:
      return err(e.status, 'VALIDATION_ERROR', 'Некорректное тело запроса');
  }
}

/** Единая обработка ошибок (ТЗ §19.2). Внутренние детали не раскрываются клиенту. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AppRequest>();

    const { status, body, headers } = this.map(exception);
    if (isBodyParserError(exception)) {
      // Ошибка клиента, а не сервера: без стека и без уровня error, чтобы не засорять журнал.
      this.logger.warn({ path: redactUrlPath(req.originalUrl ?? req.url), type: exception.type, status, requestId: req.requestId }, 'Rejected request body');
    } else if (status >= 500) {
      this.logger.error({ err: exception, path: redactUrlPath(req.originalUrl ?? req.url), requestId: req.requestId }, 'Unhandled error');
       
      if (process.env.DEBUG_ERRORS === '1') console.error(exception);
    }
    if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.status(status).json(body);
  }

  private map(exception: unknown): ErrorResponse {
    if (isBodyParserError(exception)) return bodyParserResponse(exception);
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
