import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { getConfig } from './config/config';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/exception.filter';
import { httpLoggerOptions } from './common/logging';
import { AuthModule } from './auth/auth.module';
import { AuthGuard, CsrfGuard, PermissionGuard, RateLimitGuard, SubscriptionGuard, TenantGuard } from './auth/guards';
import { HealthController } from './health.controller';
import { DomainModule } from './domain.module';

@Module({
  imports: [
    // Путь без query и с маскированием токенов ссылок (/public/manage/:token и т. п.), заголовки не пишутся.
    LoggerModule.forRoot({ pinoHttp: httpLoggerOptions(getConfig().APP_ENV === 'test' ? 'silent' : getConfig().LOG_LEVEL) }),
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
