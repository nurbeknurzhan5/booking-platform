import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { ClientListQuerySchema, MergeClientsSchema, UpdateClientSchema } from '@booking/shared';
import { Actor, RequirePermission, Tenant } from '../common/decorators';
import type { ActorContext, TenantContext } from '../common/request-context';
import { ClientsService } from './clients.service';

class ListDto extends createZodDto(ClientListQuerySchema) {}
class UpdateDto extends createZodDto(UpdateClientSchema) {}
class MergeDto extends createZodDto(MergeClientsSchema) {}

@ApiTags('clients')
@Controller('organizations/:orgId/clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermission('clients.view')
  @ApiOperation({ summary: 'Клиенты (поиск по имени/телефону) со статистикой посещений' })
  list(@Tenant() t: TenantContext, @Query() q: ListDto) {
    return this.clients.list(t, q);
  }

  @Get(':clientId')
  @RequirePermission('clients.view')
  @ApiOperation({ summary: 'Карточка клиента: история записей, посещения, отмены, неявки, отзывы, согласия' })
  card(@Tenant() t: TenantContext, @Param('clientId', ParseUUIDPipe) id: string) {
    return this.clients.card(t, id);
  }

  @Patch(':clientId')
  @RequirePermission('appointments.manage')
  update(@Tenant() t: TenantContext, @Param('clientId', ParseUUIDPipe) id: string, @Body() body: UpdateDto, @Actor() a: ActorContext) {
    return this.clients.update(t, id, body, a);
  }

  @Post('merge')
  @HttpCode(200)
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Объединить дубли (история записей сохраняется, действие в аудите)' })
  merge(@Tenant() t: TenantContext, @Body() body: MergeDto, @Actor() a: ActorContext) {
    return this.clients.merge(t, body.sourceClientId, body.targetClientId, a);
  }

  @Post(':clientId/anonymize')
  @HttpCode(204)
  @RequirePermission('org.manage')
  @ApiOperation({ summary: 'Обезличить персональные данные клиента по его запросу' })
  anonymize(@Tenant() t: TenantContext, @Param('clientId', ParseUUIDPipe) id: string, @Actor() a: ActorContext) {
    return this.clients.anonymize(t, id, a);
  }
}
