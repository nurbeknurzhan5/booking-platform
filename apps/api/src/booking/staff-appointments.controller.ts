import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import type { Response } from 'express';
import {
  AdminStatusChangeSchema,
  AppointmentListQuerySchema,
  AvailabilitySearchSchema,
  ManualAppointmentSchema,
  QuoteSchema,
  RescheduleSchema,
  APPOINTMENT_STATUSES,
  zId,
} from '@booking/shared';
import { Actor, AllowInactiveSubscription, RequirePermission, Tenant } from '../common/decorators';
import type { ActorContext, TenantContext } from '../common/request-context';
import { PrismaService } from '../common/prisma.service';
import { IdempotencyService } from '../common/idempotency.service';
import { AppError } from '../common/errors';
import { assertBranchPermission, branchFilter } from '../common/tenant-access';
import { BookingService } from './booking.service';
import type { Prisma } from '../generated/prisma/client';

class ListQuery extends createZodDto(AppointmentListQuerySchema) {}
class ManualDto extends createZodDto(ManualAppointmentSchema) {}
class StatusDto extends createZodDto(AdminStatusChangeSchema) {}
class RescheduleDto extends createZodDto(RescheduleSchema) {}
class StaffSearchDto extends createZodDto(AvailabilitySearchSchema.extend({ branchId: zId, excludeAppointmentId: zId.optional() })) {}
class StaffQuoteDto extends createZodDto(QuoteSchema.extend({ branchId: zId })) {}

@ApiTags('appointments')
@Controller('organizations/:orgId')
export class StaffAppointmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly idem: IdempotencyService,
  ) {}

  private async load(t: TenantContext, id: string, permission: 'appointments.view' | 'appointments.manage') {
    const a = await this.prisma.appointment.findFirst({ where: { id, organizationId: t.organizationId }, select: { id: true, branchId: true } });
    if (!a) throw AppError.notFound('Запись');
    assertBranchPermission(t, permission, a.branchId);
    return a;
  }

  @Get('appointments')
  @RequirePermission('appointments.view')
  @ApiOperation({ summary: 'Записи (календарь/список) с фильтрами' })
  async list(@Tenant() t: TenantContext, @Query() q: ListQuery) {
    const statuses = q.status
      ?.split(',')
      .map((s) => s.trim())
      .filter((s): s is (typeof APPOINTMENT_STATUSES)[number] => (APPOINTMENT_STATUSES as readonly string[]).includes(s));
    const where: Prisma.AppointmentWhereInput = {
      organizationId: t.organizationId,
      ...branchFilter(t, 'appointments.view', q.branchId),
      ...(q.from || q.to ? { startAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
      ...(statuses?.length ? { status: { in: statuses } } : {}),
      ...(q.specialistId ? { items: { some: { specialistId: q.specialistId } } } : {}),
      ...(q.clientId ? { clientId: q.clientId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        orderBy: { startAt: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          items: { orderBy: { position: 'asc' }, select: { serviceId: true, serviceNameSnapshot: true, specialistId: true, specialistNameSnapshot: true, startAt: true, endAt: true, finalPrice: true } },
          client: { select: { id: true, name: true, phone: true } },
        },
      }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items: rows };
  }

  @Get('appointments/:id')
  @RequirePermission('appointments.view')
  @ApiOperation({ summary: 'Запись с историей статусов и переносов' })
  async get(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.load(t, id, 'appointments.view');
    return this.booking.getFull(id);
  }

  @Post('appointments')
  @RequirePermission('appointments.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Создать запись вручную (сразу confirmed)' })
  async create(
    @Tenant() t: TenantContext,
    @Body() body: ManualDto,
    @Actor() actor: ActorContext,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertBranchPermission(t, 'appointments.manage', body.branchId);
    const r = await this.idem.run(`manual:${t.organizationId}:${actor.userId}`, key, body, async () => ({
      status: 201,
      body: await this.booking.createManual(t.organizationId, body, actor),
    }));
    res.status(r.status);
    return r.body;
  }

  @Post('availability')
  @HttpCode(200)
  @RequirePermission('appointments.view')
  @AllowInactiveSubscription()
  @ApiOperation({ summary: 'Свободные слоты (для ручной записи и переноса администратором)' })
  async availability(@Tenant() t: TenantContext, @Body() body: StaffSearchDto) {
    assertBranchPermission(t, 'appointments.view', body.branchId);
    if (body.excludeAppointmentId) await this.load(t, body.excludeAppointmentId, 'appointments.view');
    return this.booking.searchSlots(body.branchId, body.date, body.items, 'staff', body.excludeAppointmentId);
  }

  @Post('quote')
  @HttpCode(200)
  @RequirePermission('appointments.view')
  @AllowInactiveSubscription()
  @ApiOperation({ summary: 'Расчёт стоимости' })
  async quote(@Tenant() t: TenantContext, @Body() body: StaffQuoteDto) {
    assertBranchPermission(t, 'appointments.view', body.branchId);
    return this.booking.quote(body.branchId, body.items, body.promoCode, 'staff');
  }

  @Post('appointments/:id/status')
  @RequirePermission('appointments.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Выполнено / неявка / отмена администратором (с причиной)' })
  async status(
    @Tenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StatusDto,
    @Actor() actor: ActorContext,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.load(t, id, 'appointments.manage');
    const r = await this.idem.run(`status:${id}`, key, body, async () => ({
      body:
        body.status === 'cancelled_by_admin'
          ? await this.booking.cancel(id, actor, 'admin', body.reason)
          : await this.booking.setOutcome(id, body.status, actor, body.reason),
    }));
    res.status(r.status);
    return r.body;
  }

  @Post('appointments/:id/reschedule')
  @RequirePermission('appointments.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Перенести запись' })
  async reschedule(
    @Tenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RescheduleDto,
    @Actor() actor: ActorContext,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.load(t, id, 'appointments.manage');
    const r = await this.idem.run(`reschedule:${id}`, key, body, async () => ({
      body: await this.booking.reschedule(id, body, actor, 'admin'),
    }));
    res.status(r.status);
    return r.body;
  }
}
