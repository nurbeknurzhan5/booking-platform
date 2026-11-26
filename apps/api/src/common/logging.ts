import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';

/** Заголовки с секретами: в журнал не попадают, даже если сериализатор запроса будет расширен. */
export const pinoRedactPaths = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'req.headers["x-mfa-code"]',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
];

/**
 * Сегменты пути, за которыми следует секрет ссылки: управление записью (/public/manage/:token, в том числе
 * …/review), предложение из листа ожидания (/public/waitlist-offers/:token), подтверждение (/confirm/:token —
 * ссылки веб-приложения, на случай проксирования).
 */
const SECRET_PARENTS = new Set(['manage', 'waitlist-offers', 'confirm']);
export const REDACTED = '[REDACTED]';

/** Путь для журнала: без query-строки и с замаскированными секретными сегментами. */
export function redactUrlPath(url: string | undefined): string {
  const path = (url ?? '').split(/[?#]/, 1)[0] ?? '';
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (SECRET_PARENTS.has((parts[i - 1] ?? '').toLowerCase()) && parts[i]) parts[i] = REDACTED;
  }
  return parts.join('/');
}

/** Настройки HTTP-журнала (pino-http): в запросе только id, метод и очищенный путь — без заголовков и тела. */
export function httpLoggerOptions(level: string): Options {
  return {
    level,
    redact: { paths: pinoRedactPaths, censor: REDACTED },
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const id = (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, path: redactUrlPath(req.url) }),
    },
    autoLogging: { ignore: (req: IncomingMessage) => redactUrlPath(req.url) === '/api/v1/health' },
  };
}
