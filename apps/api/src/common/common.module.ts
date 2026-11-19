import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit.service';
import { RateLimitService } from './rate-limit.service';
import { IdempotencyService } from './idempotency.service';
import { SystemSettingsService } from './system-settings.service';

@Global()
@Module({
  providers: [PrismaService, AuditService, RateLimitService, IdempotencyService, SystemSettingsService],
  exports: [PrismaService, AuditService, RateLimitService, IdempotencyService, SystemSettingsService],
})
export class CommonModule {}
