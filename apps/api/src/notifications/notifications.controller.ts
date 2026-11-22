import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Actor, Public, RequirePermission, SuperadminOnly, Tenant } from '../common/decorators';
import type { ActorContext, TenantContext } from '../common/request-context';
import { PrismaService } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { NotificationDispatcher } from './dispatcher.service';
import { NotificationService } from './notification.service';
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

/**
 * Раздел «Интеграции» кабинета владельца (§18.3). Доступы к WhatsApp, SMS и переводу подключаются
 * на уровне платформы. Владелец видит их состояние, свои включения каналов и результаты доставки
 * за 7 дней. Секреты не возвращаются.
 */
@ApiTags('organizations')
@Controller('organizations/:orgId/integrations')
export class OrgIntegrationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Get()
  @RequirePermission('integrations.manage')
  @ApiOperation({ summary: 'Состояние интеграций организации (без секретов)' })
  async status(@Tenant() t: TenantContext) {
    const c = getConfig();
    const enabled = this.notifications.enabledChannels();
    const settings = await this.notifications.orgNotificationSettings(this.prisma, t.organizationId);
    const since = new Date(Date.now() - 7 * 86400_000);
    const [rows, branches] = await Promise.all([
      this.prisma.notificationOutbox.groupBy({
        by: ['channel', 'status'],
        where: { organizationId: t.organizationId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.branch.findMany({
        where: { organizationId: t.organizationId, archivedAt: null },
        select: { id: true, name: true, mapEnabled: true, mapUrl: true, latitude: true, longitude: true, address: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const delivery = (channel: string) => {
      const by = Object.fromEntries(rows.filter((r) => r.channel === channel).map((r) => [r.status, r._count._all]));
      const sent = (by.sent ?? 0) + (by.delivered ?? 0) + (by.read ?? 0);
      return { sent, delivered: (by.delivered ?? 0) + (by.read ?? 0), read: by.read ?? 0, failed: by.dead ?? 0, pending: (by.pending ?? 0) + (by.failed ?? 0) + (by.sending ?? 0) };
    };
    const waConnected = enabled.includes('whatsapp') && !!(c.WHATSAPP_PHONE_NUMBER_ID && c.WHATSAPP_ACCESS_TOKEN);
    return {
      whatsapp: {
        platformConnected: waConnected,
        enabledForOrg: settings.whatsappEnabled,
        inboundAutoReply: waConnected && !!c.WHATSAPP_APP_SECRET,
        reactivationEnabled: settings.reactivationEnabled,
        last7Days: delivery('whatsapp'),
      },
      sms: { platformConnected: enabled.includes('sms') && !!c.SMS_API_KEY, enabledForOrg: settings.smsEnabled, last7Days: delivery('sms') },
      email: { available: false },
      translation: { provider: 'google', autoAvailable: !!c.GOOGLE_TRANSLATE_API_KEY },
      map: {
        provider: '2gis',
        branches: branches.map((b) => ({
          id: b.id,
          name: b.name,
          mapEnabled: b.mapEnabled,
          hasCoordinates: b.latitude !== null && b.longitude !== null,
          hasMapUrl: !!b.mapUrl,
          hasAddress: !!b.address,
        })),
      },
      testMode: enabled.includes('dev_inbox'),
    };
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

  /**
   * «Тестовый телефон» вместо WhatsApp на время разработки: без phone — последние сообщения всем номерам.
   * В production недоступно (и канал dev_inbox там запрещён).
   */
  @Get('inbox')
  inbox(@Query('phone') phone?: string) {
    if (getConfig().APP_ENV === 'production') throw AppError.notFound();
    if (!phone) return this.prisma.devInboxMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const p = normalizePhone(phone);
    if (!p) throw AppError.badRequest('VALIDATION_ERROR', 'Неверный номер');
    return this.prisma.devInboxMessage.findMany({ where: { recipient: p }, orderBy: { createdAt: 'desc' }, take: 20 });
  }
}
