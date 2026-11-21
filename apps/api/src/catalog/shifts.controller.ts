import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { ShiftCopySchema, ShiftDeleteSchema, ShiftFillSchema, ShiftRangeQuerySchema, ShiftUpsertSchema } from '@booking/shared';
import { Actor, AnyMember, RequirePermission, Tenant } from '../common/decorators';
import type { ActorContext, TenantContext } from '../common/request-context';
import { ShiftsService } from './shifts.service';

class ShiftDto extends createZodDto(ShiftUpsertSchema) {}
class ShiftDeleteDto extends createZodDto(ShiftDeleteSchema) {}
class ShiftRangeDto extends createZodDto(ShiftRangeQuerySchema) {}
class ShiftFillDto extends createZodDto(ShiftFillSchema) {}
class ShiftCopyDto extends createZodDto(ShiftCopySchema) {}

/** График смен специалистов филиала (задача 21). */
@ApiTags('schedules')
@Controller('organizations/:orgId/branches/:branchId/shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  @AnyMember()
  @ApiOperation({ summary: 'Смены специалистов за период (до 62 дней) и режим графика' })
  list(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Query() q: ShiftRangeDto) {
    return this.shifts.list(t, branchId, q.from, q.to);
  }

  @Get('status')
  @AnyMember()
  @ApiOperation({ summary: 'Заполнен ли график на завтра и записи вне смен' })
  status(@Tenant() t: TenantContext, @Param('branchId') branchId: string) {
    return this.shifts.status(t, branchId);
  }

  @Put()
  @RequirePermission('schedules.manage')
  @ApiOperation({ summary: 'Назначить или изменить смену; при записях вне новой смены — 409 SHIFT_CONFLICT со списком, если не force' })
  upsert(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Body() body: ShiftDto, @Actor() a: ActorContext) {
    return this.shifts.upsert(t, branchId, body, a);
  }

  @Post('remove')
  @HttpCode(200)
  @RequirePermission('schedules.manage')
  @ApiOperation({ summary: 'Снять специалиста со смены; при записях — 409 SHIFT_CONFLICT со списком, если не force' })
  remove(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Body() body: ShiftDeleteDto, @Actor() a: ActorContext) {
    return this.shifts.remove(t, branchId, body, a);
  }

  @Post('fill')
  @HttpCode(200)
  @RequirePermission('schedules.manage')
  @ApiOperation({ summary: 'Заполнить смены по недельному графику на период' })
  fill(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Body() body: ShiftFillDto, @Actor() a: ActorContext) {
    return this.shifts.fill(t, branchId, body, a);
  }

  @Post('copy')
  @HttpCode(200)
  @RequirePermission('schedules.manage')
  @ApiOperation({ summary: 'Скопировать смены дня на другие даты' })
  copy(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Body() body: ShiftCopyDto, @Actor() a: ActorContext) {
    return this.shifts.copy(t, branchId, body, a);
  }
}
