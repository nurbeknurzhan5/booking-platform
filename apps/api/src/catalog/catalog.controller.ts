import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  ResourceInputSchema,
  ScheduleExceptionInputSchema,
  ServiceCategoryInputSchema,
  ServiceInputSchema,
  SpecialistInputSchema,
  UpdateResourceSchema,
  UpdateServiceSchema,
  UpdateSpecialistSchema,
  WeeklyScheduleSchema,
} from '@booking/shared';
import { Actor, AnyMember, RequirePermission, Tenant } from '../common/decorators';
import type { ActorContext, TenantContext } from '../common/request-context';
import { ServicesService } from './services.service';
import { ResourcesService } from './resources.service';
import { SchedulesService } from './schedules.service';

class ServiceDto extends createZodDto(ServiceInputSchema) {}
class UpdateServiceDto extends createZodDto(UpdateServiceSchema) {}
class CategoryDto extends createZodDto(ServiceCategoryInputSchema) {}
class SpecialistDto extends createZodDto(SpecialistInputSchema) {}
class UpdateSpecialistDto extends createZodDto(UpdateSpecialistSchema) {}
class ResourceDto extends createZodDto(ResourceInputSchema) {}
class UpdateResourceDto extends createZodDto(UpdateResourceSchema) {}
class WeeklyDto extends createZodDto(WeeklyScheduleSchema) {}
class ExceptionDto extends createZodDto(ScheduleExceptionInputSchema) {}

const OptionalUuid = new ParseUUIDPipe({ optional: true });

@ApiTags('services')
@Controller('organizations/:orgId')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get('services')
  @AnyMember()
  @ApiOperation({ summary: 'Каталог услуг (администратор видит услуги своих филиалов)' })
  list(@Tenant() t: TenantContext, @Query('branchId', OptionalUuid) branchId?: string) {
    return this.services.list(t, branchId);
  }

  @Post('services')
  @RequirePermission('services.manage')
  @ApiOperation({ summary: 'Создать услугу' })
  create(@Tenant() t: TenantContext, @Body() body: ServiceDto, @Actor() a: ActorContext) {
    return this.services.create(t, body, a);
  }

  @Get('services/:serviceId')
  @AnyMember()
  get(@Tenant() t: TenantContext, @Param('serviceId', ParseUUIDPipe) id: string) {
    return this.services.get(t, id);
  }

  @Patch('services/:serviceId')
  @RequirePermission('services.manage')
  @ApiOperation({ summary: 'Изменить услугу (цены в существующих записях не меняются — snapshot)' })
  update(@Tenant() t: TenantContext, @Param('serviceId', ParseUUIDPipe) id: string, @Body() body: UpdateServiceDto, @Actor() a: ActorContext) {
    return this.services.update(t, id, body, a);
  }

  @Delete('services/:serviceId')
  @HttpCode(204)
  @RequirePermission('services.manage')
  archive(@Tenant() t: TenantContext, @Param('serviceId', ParseUUIDPipe) id: string, @Actor() a: ActorContext) {
    return this.services.archive(t, id, a);
  }

  @Get('service-categories')
  @AnyMember()
  listCategories(@Tenant() t: TenantContext) {
    return this.services.listCategories(t);
  }

  @Post('service-categories')
  @RequirePermission('services.manage')
  createCategory(@Tenant() t: TenantContext, @Body() body: CategoryDto, @Actor() a: ActorContext) {
    return this.services.createCategory(t, body, a);
  }

  @Patch('service-categories/:categoryId')
  @RequirePermission('services.manage')
  updateCategory(@Tenant() t: TenantContext, @Param('categoryId', ParseUUIDPipe) id: string, @Body() body: CategoryDto, @Actor() a: ActorContext) {
    return this.services.updateCategory(t, id, body, a);
  }

  @Delete('service-categories/:categoryId')
  @HttpCode(204)
  @RequirePermission('services.manage')
  archiveCategory(@Tenant() t: TenantContext, @Param('categoryId', ParseUUIDPipe) id: string, @Actor() a: ActorContext) {
    return this.services.archiveCategory(t, id, a);
  }
}

@ApiTags('specialists')
@Controller('organizations/:orgId/branches/:branchId/specialists')
export class SpecialistsController {
  constructor(private readonly resources: ResourcesService) {}

  @Get()
  @AnyMember()
  list(@Tenant() t: TenantContext, @Param('branchId') branchId: string) {
    return this.resources.listSpecialists(t, branchId);
  }

  @Post()
  @RequirePermission('specialists.manage')
  @ApiOperation({ summary: 'Создать специалиста в филиале' })
  create(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Body() body: SpecialistDto, @Actor() a: ActorContext) {
    return this.resources.createSpecialist(t, branchId, body, a);
  }

  @Get(':specialistId')
  @AnyMember()
  get(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Param('specialistId', ParseUUIDPipe) id: string) {
    return this.resources.getSpecialist(t, branchId, id);
  }

  @Patch(':specialistId')
  @RequirePermission('specialists.manage')
  update(
    @Tenant() t: TenantContext,
    @Param('branchId') branchId: string,
    @Param('specialistId', ParseUUIDPipe) id: string,
    @Body() body: UpdateSpecialistDto,
    @Actor() a: ActorContext,
  ) {
    return this.resources.updateSpecialist(t, branchId, id, body, a);
  }

  @Delete(':specialistId')
  @HttpCode(204)
  @RequirePermission('specialists.manage')
  archive(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Param('specialistId', ParseUUIDPipe) id: string, @Actor() a: ActorContext) {
    return this.resources.archiveSpecialist(t, branchId, id, a);
  }
}

@ApiTags('resources')
@Controller('organizations/:orgId/branches/:branchId/resources')
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Get()
  @AnyMember()
  list(@Tenant() t: TenantContext, @Param('branchId') branchId: string) {
    return this.resources.listResources(t, branchId);
  }

  @Post()
  @RequirePermission('resources.manage')
  @ApiOperation({ summary: 'Создать ресурс (кабинет, зал, оборудование, автомобиль, пост)' })
  create(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Body() body: ResourceDto, @Actor() a: ActorContext) {
    return this.resources.createResource(t, branchId, body, a);
  }

  @Get(':resourceId')
  @AnyMember()
  get(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Param('resourceId', ParseUUIDPipe) id: string) {
    return this.resources.getResource(t, branchId, id);
  }

  @Patch(':resourceId')
  @RequirePermission('resources.manage')
  update(
    @Tenant() t: TenantContext,
    @Param('branchId') branchId: string,
    @Param('resourceId', ParseUUIDPipe) id: string,
    @Body() body: UpdateResourceDto,
    @Actor() a: ActorContext,
  ) {
    return this.resources.updateResource(t, branchId, id, body, a);
  }

  @Delete(':resourceId')
  @HttpCode(204)
  @RequirePermission('resources.manage')
  archive(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Param('resourceId', ParseUUIDPipe) id: string, @Actor() a: ActorContext) {
    return this.resources.archiveResource(t, branchId, id, a);
  }
}

@ApiTags('schedules')
@Controller('organizations/:orgId/branches/:branchId/schedule')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @AnyMember()
  @ApiOperation({ summary: 'Недельное расписание и исключения (resourceId не указан — расписание филиала)' })
  get(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Query('resourceId', OptionalUuid) resourceId?: string) {
    return this.schedules.get(t, branchId, resourceId ?? null);
  }

  @Put('weekly')
  @RequirePermission('schedules.manage')
  @ApiOperation({ summary: 'Заменить недельное расписание (рабочее время и перерывы)' })
  setWeekly(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Body() body: WeeklyDto, @Actor() a: ActorContext) {
    return this.schedules.setWeekly(t, branchId, body, a);
  }

  @Post('exceptions')
  @RequirePermission('schedules.manage')
  @ApiOperation({ summary: 'Добавить исключение: праздник, выходной, временное закрытие, особые часы' })
  addException(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Body() body: ExceptionDto, @Actor() a: ActorContext) {
    return this.schedules.addException(t, branchId, body, a);
  }

  @Delete('exceptions/:exceptionId')
  @HttpCode(204)
  @RequirePermission('schedules.manage')
  removeException(
    @Tenant() t: TenantContext,
    @Param('branchId') branchId: string,
    @Param('exceptionId', ParseUUIDPipe) id: string,
    @Actor() a: ActorContext,
  ) {
    return this.schedules.removeException(t, branchId, id, a);
  }
}
