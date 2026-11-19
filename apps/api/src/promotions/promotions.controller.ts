import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { PromotionInputSchema } from '@booking/shared';
import { Actor, RequirePermission, Tenant } from '../common/decorators';
import type { ActorContext, TenantContext } from '../common/request-context';
import { PromotionsService } from './promotions.service';

class PromotionDto extends createZodDto(PromotionInputSchema) {}

@ApiTags('promotions')
@Controller('organizations/:orgId/promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @RequirePermission('promotions.manage')
  @ApiOperation({ summary: 'Промокоды и акции с количеством использований' })
  list(@Tenant() t: TenantContext) {
    return this.promotions.list(t);
  }

  @Post()
  @RequirePermission('promotions.manage')
  create(@Tenant() t: TenantContext, @Body() body: PromotionDto, @Actor() a: ActorContext) {
    return this.promotions.create(t, body, a);
  }

  @Put(':id')
  @RequirePermission('promotions.manage')
  update(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: PromotionDto, @Actor() a: ActorContext) {
    return this.promotions.update(t, id, body, a);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('promotions.manage')
  archive(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Actor() a: ActorContext) {
    return this.promotions.archive(t, id, a);
  }
}
