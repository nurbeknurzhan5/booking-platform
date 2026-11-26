import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  BookingSettingsSchema,
  BranchInputSchema,
  CreateStaffUserSchema,
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationSettingsSchema,
  ResetUserPasswordSchema,
  UpdateBranchSchema,
  UpdateOrganizationSchema,
  UpdateStaffAccessSchema,
} from '@booking/shared';
import { Actor, AnyMember, RateLimit, RequirePermission, Tenant } from '../common/decorators';
import type { ActorContext, TenantContext } from '../common/request-context';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { BranchesService } from './branches.service';
import { StaffService } from './staff.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import type { Prisma } from '../generated/prisma/client';

class UpdateOrgDto extends createZodDto(UpdateOrganizationSchema) {}
class BranchDto extends createZodDto(BranchInputSchema) {}
class UpdateBranchDto extends createZodDto(UpdateBranchSchema) {}
class BookingSettingsDto extends createZodDto(BookingSettingsSchema) {}
class NotificationSettingsDto extends createZodDto(NotificationSettingsSchema) {}
class CreateStaffDto extends createZodDto(CreateStaffUserSchema) {}
class UpdateAccessDto extends createZodDto(UpdateStaffAccessSchema) {}
class ResetStaffPasswordDto extends createZodDto(ResetUserPasswordSchema.pick({ temporaryPassword: true })) {}

@ApiTags('organizations')
@Controller('organizations/:orgId')
export class OrganizationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branches: BranchesService,
    private readonly staff: StaffService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Get()
  @AnyMember()
  @ApiOperation({ summary: 'Профиль организации, статус подписки и права текущего пользователя' })
  async get(@Tenant() t: TenantContext) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: t.organizationId },
      include: { businessCategory: true },
    });
    return {
      id: org.id,
      name: org.name,
      description: org.description,
      businessCategory: org.businessCategory,
      contacts: org.contacts,
      defaultLocale: org.defaultLocale,
      subscriptionStatus: t.subscriptionStatus,
      access: { role: t.role, branchPermissions: t.grant.branchPermissions },
    };
  }

  @Patch()
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Изменить профиль организации' })
  async update(@Tenant() t: TenantContext, @Body() body: UpdateOrgDto, @Actor() actor: ActorContext) {
    const before = await this.prisma.organization.findUniqueOrThrow({ where: { id: t.organizationId } });
    const after = await this.prisma.organization.update({
      where: { id: t.organizationId },
      data: {
        name: body.name,
        description: body.description,
        contacts: body.contacts as Prisma.InputJsonValue | undefined,
        defaultLocale: body.defaultLocale,
      },
    });
    await this.audit.log(actor, 'organization.updated', 'organization', t.organizationId, { before, after });
    return after;
  }

  @Get('subscription')
  @RequirePermission('subscription.view')
  @ApiOperation({ summary: 'Подписка организации (только чтение для владельца)' })
  subscription(@Tenant() t: TenantContext) {
    return this.subscriptions.summary(t.organizationId);
  }

  @Get('notification-settings')
  @RequirePermission('notifications.manage')
  @ApiOperation({ summary: 'Настройки уведомлений организации' })
  async getNotificationSettings(@Tenant() t: TenantContext) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: t.organizationId } });
    return { ...DEFAULT_NOTIFICATION_SETTINGS, ...((org.notificationSettings as object) ?? {}) };
  }

  @Put('notification-settings')
  @RequirePermission('notifications.manage')
  @ApiOperation({ summary: 'Изменить настройки уведомлений' })
  async setNotificationSettings(@Tenant() t: TenantContext, @Body() body: NotificationSettingsDto, @Actor() actor: ActorContext) {
    await this.prisma.organization.update({ where: { id: t.organizationId }, data: { notificationSettings: { ...body } } });
    await this.audit.log(actor, 'notification_settings.updated', 'organization', t.organizationId, { after: body });
    return body;
  }

  // ---------- филиалы ----------
  @Get('branches')
  @AnyMember()
  @ApiOperation({ summary: 'Филиалы (для администратора — только назначенные)' })
  listBranches(@Tenant() t: TenantContext) {
    const ids = t.grant.role === 'OWNER' ? null : Object.keys(t.grant.branchPermissions);
    return this.branches.list(t.organizationId, ids);
  }

  @Post('branches')
  @RequirePermission('branches.manage')
  @ApiOperation({ summary: 'Создать филиал (в пределах лимита тарифа)' })
  createBranch(@Tenant() t: TenantContext, @Body() body: BranchDto, @Actor() actor: ActorContext) {
    return this.branches.create(t.organizationId, body, actor);
  }

  @Get('branches/:branchId')
  @AnyMember()
  @ApiOperation({ summary: 'Филиал' })
  getBranch(@Tenant() t: TenantContext, @Param('branchId') branchId: string) {
    return this.branches.get(t.organizationId, branchId);
  }

  @Patch('branches/:branchId')
  @RequirePermission('branch.settings.manage')
  @ApiOperation({ summary: 'Изменить филиал' })
  updateBranch(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Body() body: UpdateBranchDto, @Actor() actor: ActorContext) {
    return this.branches.update(t.organizationId, branchId, body, actor);
  }

  @Delete('branches/:branchId')
  @HttpCode(204)
  @RequirePermission('branches.manage')
  @ApiOperation({ summary: 'Архивировать филиал' })
  archiveBranch(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Actor() actor: ActorContext) {
    return this.branches.archive(t.organizationId, branchId, actor);
  }

  @Get('branches/:branchId/booking-settings')
  @RequirePermission('branch.settings.manage')
  @ApiOperation({ summary: 'Правила бронирования филиала' })
  getBookingSettings(@Tenant() t: TenantContext, @Param('branchId') branchId: string) {
    return this.branches.getBookingSettings(t.organizationId, branchId);
  }

  @Put('branches/:branchId/booking-settings')
  @RequirePermission('booking_settings.manage')
  @ApiOperation({ summary: 'Изменить правила бронирования (только владелец)' })
  setBookingSettings(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Body() body: BookingSettingsDto, @Actor() actor: ActorContext) {
    return this.branches.updateBookingSettings(t.organizationId, branchId, body, actor);
  }

  // ---------- сотрудники ----------
  @Get('users')
  @RequirePermission('users.manage')
  @ApiOperation({ summary: 'Сотрудники организации' })
  listStaff(@Tenant() t: TenantContext) {
    return this.staff.list(t.organizationId);
  }

  @Post('users')
  @RequirePermission('users.manage')
  @ApiOperation({ summary: 'Создать администратора филиала с временным паролем' })
  createStaff(@Tenant() t: TenantContext, @Body() body: CreateStaffDto, @Actor() actor: ActorContext) {
    return this.staff.create(t.organizationId, body, actor, { allowOwner: t.isSuperadmin });
  }

  @Post('users/:userId/reset-password')
  @HttpCode(204)
  @RequirePermission('users.manage')
  @RateLimit({ name: 'staff-reset-password', limit: 10, windowSec: 3600, by: 'user' })
  @ApiOperation({ summary: 'Восстановить доступ администратору филиала: временный пароль и смена при входе' })
  resetStaffPassword(@Tenant() t: TenantContext, @Param('userId', ParseUUIDPipe) userId: string, @Body() body: ResetStaffPasswordDto, @Actor() actor: ActorContext) {
    return this.staff.resetPassword(t.organizationId, userId, body.temporaryPassword, actor);
  }

  @Put('users/:userId/access')
  @RequirePermission('users.manage')
  @ApiOperation({ summary: 'Выдать/отозвать права администратора по филиалам' })
  updateAccess(@Tenant() t: TenantContext, @Param('userId', ParseUUIDPipe) userId: string, @Body() body: UpdateAccessDto, @Actor() actor: ActorContext) {
    return this.staff.updateAccess(t.organizationId, userId, body.branchAccess, actor);
  }

  @Delete('users/:userId')
  @HttpCode(204)
  @RequirePermission('users.manage')
  @ApiOperation({ summary: 'Отозвать доступ сотрудника' })
  revokeStaff(@Tenant() t: TenantContext, @Param('userId', ParseUUIDPipe) userId: string, @Actor() actor: ActorContext) {
    return this.staff.revoke(t.organizationId, userId, actor, { allowOwner: t.isSuperadmin });
  }

  // ---------- журнал действий ----------
  @Get('audit-logs')
  @RequirePermission('audit.view')
  @ApiOperation({ summary: 'Журнал действий организации' })
  auditLogs(@Tenant() t: TenantContext) {
    return this.prisma.auditLog.findMany({
      where: { organizationId: t.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorType: true,
        createdAt: true,
        before: true,
        after: true,
        actor: { select: { id: true, name: true } },
      },
    });
  }
}
