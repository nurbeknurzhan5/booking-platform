import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { BlockList, isIP } from 'node:net';
import type { RequestHandler } from 'express';
import { AppModule } from './app.module';
import { bodyParserErrorHandler } from './common/exception.filter';
import { getConfig } from './config/config';

export const API_PREFIX = 'api/v1';
const DOCS_PATH = `/${API_PREFIX}/docs`;

/** Внутренние адреса, с которых может прийти запрос от доверенного прокси (Docker, localhost, частная сеть). */
const PROXY_NETWORKS = new BlockList();
for (const [net, prefix] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16]] as const) {
  PROXY_NETWORKS.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) PROXY_NETWORKS.addSubnet(net, prefix, 'ipv6');

export function isInternalAddress(addr: string): boolean {
  const a = addr.replace(/^::ffff:/i, '');
  const family = isIP(a);
  return family !== 0 && PROXY_NETWORKS.check(a, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Доверие X-Forwarded-For: не больше `hops` прокси и только с внутренних адресов. Числовой trust proxy
 * доверял бы любым `hops` записям: если внешний прокси дописывает адрес клиента к присланному клиентом
 * X-Forwarded-For (так делают многие балансировщики и туннели), подставленная клиентом запись становилась
 * req.ip — и ключом rate limit. Публичный адрес в цепочке — это клиент: левее него ничему не верим.
 */
export function trustProxy(hops: number): (addr: string, i: number) => boolean {
  return (addr, i) => i < hops && isInternalAddress(addr);
}

/** Строгая CSP для JSON-API; 'unsafe-inline' нужен только странице Swagger UI. */
function securityHeaders(): RequestHandler {
  const strict = helmet({
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  const docs = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  return (req, res, next) => (req.path === DOCS_PATH || req.path.startsWith(`${DOCS_PATH}/`) ? docs : strict)(req, res, next);
}

/** Swagger UI и OpenAPI JSON не публикуются в production (описание API — в docs/openapi.json). */
export function docsEnabled(appEnv: string): boolean {
  return appEnv !== 'production';
}

export async function createApp(): Promise<NestExpressApplication> {
  const cfg = getConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.set('trust proxy', trustProxy(cfg.TRUST_PROXY));
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  // Ошибки тела (больше 1 МБ, битый JSON, кодировка) → 413/400/415 в формате API, а не 500 или текст парсера.
  app.use(bodyParserErrorHandler);
  app.enableCors({ origin: cfg.WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  if (!docsEnabled(cfg.APP_ENV)) return app;
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Booking Platform API')
      .setDescription('REST API платформы онлайн-записи. Ошибки: { error: { code, message, details } }.')
      .setVersion('1.0')
      .addCookieAuth('bk_sid')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrf')
      .build(),
  );
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, cleanupOpenApiDoc(doc), { jsonDocumentUrl: `${API_PREFIX}/docs-json` });
  return app;
}
