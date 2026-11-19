import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Actor, Public, RequirePermission, SuperadminOnly, Tenant } from '../common/decorators';
import type { ActorContext, TenantContext } from '../common/request-context';
import { PrismaService } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { NotificationDispatcher } from './dispatcher.service';
import { AuditService } from '../common/audit.service';
import { getConfig } from '../config/config';
import { normalizePhone } from '@booking/shared';
import type { NotificationStatus } from '../generated/prisma/client';

const OUTBOX_SELECT = {
  id: true,
  type: true,
  channel: true,
  recipient: true,
  status: true,
  attempts: true,
  maxAttempts: true,
  sentAt: true,
  deliveredAt: true,
  readAt: true,
  providerMessageId: true,
  lastError: true,
  appointmentId: true,
  createdAt: true,
} as const;

@ApiTags('notifications')
@Controller('organizations/:orgId/notifications')
export class OrgNotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('notifications.manage')
  @ApiOperation({ summary: 'Журнал уведомлений организации' })
  list(@Tenant() t: TenantContext, @Query('appointmentId') appointmentId?: string) {
    return this.prisma.notificationOutbox.findMany({
      where: { organizationId: t.organizationId, ...(appointmentId && /^[0-9a-f-]{36}$/i.test(appointmentId) ? { appointmentId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: OUTBOX_SELECT,
    });
  }
}

@ApiTags('admin')
@SuperadminOnly()
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcher,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Очередь сообщений (фильтр по статусу: dead — DLQ)' })
  list(@Query('status') status?: string) {
    const allowed = ['pending', 'sending', 'sent', 'delivered', 'read', 'failed', 'dead', 'cancelled'];
    return this.prisma.notificationOutbox.findMany({
      where: status && allowed.includes(status) ? { status: status as NotificationStatus } : {},
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { ...OUTBOX_SELECT, organizationId: true, attemptsLog: { orderBy: { attemptNo: 'asc' }, select: { attemptNo: true, success: true, errorCode: true, errorMessage: true, httpStatus: true, finishedAt: true } } },
    });
  }

  @Get('stats')
  async stats() {
    const rows = await this.prisma.notificationOutbox.groupBy({ by: ['status', 'channel'], _count: { _all: true } });
    return rows.map((r) => ({ status: r.status, channel: r.channel, count: r._count._all }));
  }

  @Post(':id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Повторить сообщение из DLQ' })
  async retry(@Param('id', ParseUUIDPipe) id: string, @Actor() actor: ActorContext) {
    const ok = await this.dispatcher.retryDead(id);
    if (!ok) throw AppError.unprocessable('VALIDATION_ERROR', 'Повтор невозможен (сообщение не в DLQ или содержит одноразовый код)');
    await this.audit.log(actor, 'notification.retried', 'notification', id);
    return { ok };
  }
}

/** Входящие dev_inbox (только dev/test) — получение OTP в тестовой среде (§26.3). */
@ApiTags('dev')
@Public()
@Controller('dev')
export class DevInboxController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('inbox')
  inbox(@Query('phone') phone: string) {
    if (getConfig().APP_ENV === 'production') throw AppError.notFound();
    const p = normalizePhone(phone ?? '');
    if (!p) throw AppError.badRequest('VALIDATION_ERROR', 'phone required');
    return this.prisma.devInboxMessage.findMany({ where: { recipient: p }, orderBy: { createdAt: 'desc' }, take: 20 });
  }
}
