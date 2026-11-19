import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { AnalyticsEventSchema, AnalyticsQuerySchema } from '@booking/shared';
import { Public, RateLimit, RequirePermission, Tenant } from '../common/decorators';
import { clientIp, type AppRequest, type TenantContext } from '../common/request-context';
import { AnalyticsService } from './analytics.service';
import { allowedBranches } from '../common/tenant-access';
import { AppError } from '../common/errors';

class EventDto extends createZodDto(AnalyticsEventSchema) {}
class QueryDto extends createZodDto(AnalyticsQuerySchema) {}

@ApiTags('analytics')
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Public()
  @Post('public/analytics/events')
  @HttpCode(204)
  @RateLimit({ name: 'analytics', limit: 120, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Событие аналитики публичной страницы (просмотр, клик, начало записи)' })
  async event(@Body() body: EventDto, @Req() req: AppRequest) {
    if (body.type === 'booking_completed' || body.type === 'booking_cancelled') {
      // Эти события фиксирует сервер при подтверждении/отмене — не доверяем клиенту.
      return;
    }
    await this.analytics.record(body, {
      ip: clientIp(req),
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 500),
      user: req.user,
      host: req.headers.host,
    });
  }

  @Get('organizations/:orgId/analytics')
  @RequirePermission('analytics.view')
  @ApiOperation({ summary: 'Аналитика: просмотры, уникальные, клики, конверсия, UTM-источники, популярные услуги и специалисты' })
  report(@Tenant() t: TenantContext, @Query() q: QueryDto) {
    const allowed = allowedBranches(t, 'analytics.view');
    if (q.branchId && allowed && !allowed.includes(q.branchId)) throw AppError.forbidden();
    const branchIds = q.branchId ? [q.branchId] : allowed;
    return this.analytics.report(t.organizationId, branchIds, q);
  }
}
