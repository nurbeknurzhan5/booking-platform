import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { randomUUID } from 'node:crypto';
import { getConfig } from './config/config';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/exception.filter';
import { AuthModule } from './auth/auth.module';
import { AuthGuard, CsrfGuard, PermissionGuard, RateLimitGuard, SubscriptionGuard, TenantGuard } from './auth/guards';
import { HealthController } from './health.controller';
import { DomainModule } from './domain.module';

export const pinoRedactPaths = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'req.headers["x-mfa-code"]',
  'res.headers["set-cookie"]',
];

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: getConfig().APP_ENV === 'test' ? 'silent' : getConfig().LOG_LEVEL,
        redact: { paths: pinoRedactPaths, censor: '[REDACTED]' },
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID();
          res.setHeader('X-Request-Id', id);
          return id;
        },
        // Логируем только путь без query (в query могут быть токены ссылок управления).
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, path: req.url.split('?')[0] }),
        },
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      },
    }),
    CommonModule,
    AuthModule,
    DomainModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Порядок важен: аутентификация → CSRF → rate limit → tenant → RBAC → подписка.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
  ],
})
export class AppModule {}
