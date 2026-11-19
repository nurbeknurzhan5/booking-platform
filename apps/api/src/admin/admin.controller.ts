import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  AdminCreateUserSchema,
  AdminUpdateOrganizationSchema,
  BlockUserSchema,
  BranchInputSchema,
  CreateOrganizationSchema,
  PlanInputSchema,
  RecordPaymentSchema,
  SetSubscriptionSchema,
  SuspendOrganizationSchema,
  SystemSettingsSchema,
  UpdatePlanSchema,
} from '@booking/shared';
import { Actor, RequireStepUp, SuperadminOnly } from '../common/decorators';
import type { ActorContext } from '../common/request-context';
import { AdminOrganizationsService } from './admin-organizations.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { BranchesService } from '../organizations/branches.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { SessionService } from '../auth/session.service';
import { SystemSettingsService } from '../common/system-settings.service';
import { getConfig } from '../config/config';

class CreateOrgDto extends createZodDto(CreateOrganizationSchema) {}
class UpdateOrgDto extends createZodDto(AdminUpdateOrganizationSchema) {}
class SetSubDto extends createZodDto(SetSubscriptionSchema) {}
class PaymentDto extends createZodDto(RecordPaymentSchema) {}
class SuspendDto extends createZodDto(SuspendOrganizationSchema) {}
class PlanDto extends createZodDto(PlanInputSchema) {}
class UpdatePlanDto extends createZodDto(UpdatePlanSchema) {}
class OwnerDto extends createZodDto(AdminCreateUserSchema) {}
class BranchDto extends createZodDto(BranchInputSchema) {}
class BlockDto extends createZodDto(BlockUserSchema) {}
class SystemSettingsDto extends createZodDto(SystemSettingsSchema) {}

@ApiTags('admin')
@SuperadminOnly()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly orgs: AdminOrganizationsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly branches: BranchesService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  // ---------- организации ----------
  @Get('organizations')
  @ApiOperation({ summary: 'Список организаций' })
  list(@Query('search') search?: string) {
    return this.orgs.list(search?.slice(0, 100));
  }

  @Post('organizations')
  @ApiOperation({ summary: 'Создать организацию (+ владелец + подписка)' })
  create(@Body() body: CreateOrgDto, @Actor() actor: ActorContext) {
    return this.orgs.create(body, actor);
  }

  @Get('organizations/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgs.get(id);
  }

  @Patch('organizations/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateOrgDto, @Actor() actor: ActorContext) {
    return this.orgs.update(id, body, actor);
  }

  @Post('organizations/:id/owners')
  @ApiOperation({ summary: 'Назначить владельца' })
  addOwner(@Param('id', ParseUUIDPipe) id: string, @Body() body: OwnerDto, @Actor() actor: ActorContext) {
    return this.orgs.addOwner(id, body, actor);
  }

  @Post('organizations/:id/branches')
  @ApiOperation({ summary: 'Создать филиал организации' })
  createBranch(@Param('id', ParseUUIDPipe) id: string, @Body() body: BranchDto, @Actor() actor: ActorContext) {
    return this.branches.create(id, body, { ...actor, organizationId: id });
  }

  @Post('organizations/:id/suspend')
  @HttpCode(200)
  @RequireStepUp()
  @ApiOperation({ summary: 'Временно заблокировать организацию (требует X-MFA-Code)' })
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() body: SuspendDto, @Actor() actor: ActorContext) {
    return this.subscriptions.setSuspended(id, true, body.reason, { ...actor, organizationId: id });
  }

  @Post('organizations/:id/restore')
  @HttpCode(200)
  @RequireStepUp()
  @ApiOperation({ summary: 'Восстановить доступ организации (требует X-MFA-Code)' })
  restore(@Param('id', ParseUUIDPipe) id: string, @Body() body: SuspendDto, @Actor() actor: ActorContext) {
    return this.subscriptions.setSuspended(id, false, body.reason, { ...actor, organizationId: id });
  }

  // ---------- подписки и оплаты ----------
  @Put('organizations/:id/subscription')
  @RequireStepUp()
  @ApiOperation({ summary: 'Установить/изменить подписку (требует X-MFA-Code)' })
  setSubscription(@Param('id', ParseUUIDPipe) id: string, @Body() body: SetSubDto, @Actor() actor: ActorContext) {
    return this.subscriptions.set(id, body, { ...actor, organizationId: id });
  }

  @Post('organizations/:id/subscription/payments')
  @RequireStepUp()
  @ApiOperation({ summary: 'Зафиксировать оплату и (опционально) продлить подписку' })
  recordPayment(@Param('id', ParseUUIDPipe) id: string, @Body() body: PaymentDto, @Actor() actor: ActorContext) {
    return this.subscriptions.recordPayment(id, body, { ...actor, organizationId: id });
  }

  @Get('organizations/:id/subscription/history')
  subscriptionHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.history(id);
  }

  @Get('payments')
  @ApiOperation({ summary: 'Все оплаты' })
  payments() {
    return this.prisma.subscriptionPayment.findMany({
      orderBy: { paidAt: 'desc' },
      take: 500,
      include: { organization: { select: { id: true, name: true } } },
    });
  }

  // ---------- тарифы ----------
  @Get('plans')
  plans() {
    return this.prisma.plan.findMany({ orderBy: { monthlyPrice: 'asc' } });
  }

  @Post('plans')
  async createPlan(@Body() body: PlanDto, @Actor() actor: ActorContext) {
    const plan = await this.prisma.plan.create({ data: body });
    await this.audit.log(actor, 'plan.created', 'plan', plan.id, { after: plan });
    return plan;
  }

  @Patch('plans/:id')
  async updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePlanDto, @Actor() actor: ActorContext) {
    const before = await this.prisma.plan.findUnique({ where: { id } });
    if (!before) throw AppError.notFound('Тариф');
    const after = await this.prisma.plan.update({ where: { id }, data: body });
    await this.audit.log(actor, 'plan.updated', 'plan', id, { before, after });
    return after;
  }

  // ---------- пользователи ----------
  @Get('users')
  users(@Query('search') search?: string) {
    const s = search?.slice(0, 100);
    return this.prisma.user.findMany({
      where: s ? { OR: [{ email: { contains: s, mode: 'insensitive' } }, { phone: { contains: s } }, { name: { contains: s, mode: 'insensitive' } }] } : {},
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isSuperadmin: true,
        blockedAt: true,
        blockedReason: true,
        lastLoginAt: true,
        createdAt: true,
        orgRoles: { where: { revokedAt: null }, select: { organizationId: true, roleCode: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  @Post('users/:id/block')
  @HttpCode(204)
  @RequireStepUp()
  async block(@Param('id', ParseUUIDPipe) id: string, @Body() body: BlockDto, @Actor() actor: ActorContext) {
    if (id === actor.userId) throw AppError.badRequest('VALIDATION_ERROR', 'Нельзя заблокировать себя');
    await this.prisma.user.update({ where: { id }, data: { blockedAt: new Date(), blockedReason: body.reason } });
    await this.sessions.revokeAllForUser(id);
    await this.audit.log(actor, 'user.blocked', 'user', id, { after: { reason: body.reason } });
  }

  @Post('users/:id/unblock')
  @HttpCode(204)
  @RequireStepUp()
  async unblock(@Param('id', ParseUUIDPipe) id: string, @Body() body: BlockDto, @Actor() actor: ActorContext) {
    await this.prisma.user.update({ where: { id }, data: { blockedAt: null, blockedReason: null, failedLoginCount: 0, lockedUntil: null } });
    await this.audit.log(actor, 'user.unblocked', 'user', id, { after: { reason: body.reason } });
  }

  // ---------- аудит и настройки ----------
  @Get('audit-logs')
  auditLogs(@Query('organizationId') organizationId?: string, @Query('action') action?: string) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(organizationId && /^[0-9a-f-]{36}$/i.test(organizationId) ? { organizationId } : {}),
        ...(action ? { action: { startsWith: action.slice(0, 100) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
  }

  @Get('settings')
  settings() {
    return this.systemSettings.get();
  }

  @Put('settings')
  @RequireStepUp()
  async setSettings(@Body() body: SystemSettingsDto, @Actor() actor: ActorContext) {
    const before = await this.systemSettings.get();
    const after = await this.systemSettings.set(body, actor.userId);
    await this.audit.log(actor, 'system_settings.updated', 'system', null, { before, after });
    return after;
  }

  @Get('business-categories')
  categories() {
    return this.prisma.businessCategory.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Системная статистика платформы' })
  async stats() {
    const since = new Date(Date.now() - 30 * 86400_000);
    const [orgs, subs, branches, appts, apptByStatus, outbox, users] = await Promise.all([
      this.prisma.organization.count({ where: { archivedAt: null } }),
      this.prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.branch.count({ where: { archivedAt: null } }),
      this.prisma.appointment.count({ where: { createdAt: { gte: since } } }),
      this.prisma.appointment.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.notificationOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.user.count(),
    ]);
    const revenue = await this.prisma.subscriptionPayment.aggregate({ where: { paidAt: { gte: since } }, _sum: { amount: true } });
    return {
      organizations: orgs,
      subscriptions: Object.fromEntries(subs.map((s) => [s.status, s._count._all])),
      branches,
      users,
      appointmentsLast30Days: appts,
      appointmentsByStatus: Object.fromEntries(apptByStatus.map((s) => [s.status, s._count._all])),
      notificationQueue: Object.fromEntries(outbox.map((s) => [s.status, s._count._all])),
      paymentsLast30Days: revenue._sum.amount ?? 0,
    };
  }

  @Get('integrations')
  @ApiOperation({ summary: 'Состояние интеграций (без секретов)' })
  integrations() {
    const c = getConfig();
    return {
      notificationChannels: c.NOTIFICATION_CHANNELS,
      otpChannels: c.OTP_CHANNELS,
      whatsapp: { configured: !!(c.WHATSAPP_PHONE_NUMBER_ID && c.WHATSAPP_ACCESS_TOKEN), webhookSecretConfigured: !!c.WHATSAPP_APP_SECRET, apiVersion: c.WHATSAPP_API_VERSION },
      sms: { provider: c.SMS_PROVIDER, configured: !!c.SMS_API_KEY },
      translation: { provider: 'google', configured: !!c.GOOGLE_TRANSLATE_API_KEY },
      storage: { driver: c.STORAGE_DRIVER, s3Configured: !!(c.S3_BUCKET && c.S3_ACCESS_KEY_ID) },
      environment: c.APP_ENV,
    };
  }
}
