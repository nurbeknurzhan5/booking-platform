import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import type { Request } from 'express';
import {
  ConfirmWaitlistSchema,
  DeclineWaitlistOfferSchema,
  JoinWaitlistSchema,
  StaffWaitlistCreateSchema,
  StaffWaitlistUpdateSchema,
  WaitlistListQuerySchema,
  WaitlistTokenSchema,
} from '@booking/shared';
import { Actor, ClientAccess, CurrentUser, Public, RateLimit, RequirePermission, Tenant } from '../common/decorators';
import { clientIp, type ActorContext, type AuthUser, type TenantContext } from '../common/request-context';
import { PrismaService } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { assertBranchPermission, branchFilter } from '../common/tenant-access';
import { WaitlistService } from './waitlist.service';
import type { Prisma } from '../generated/prisma/client';

class JoinDto extends createZodDto(JoinWaitlistSchema) {}
class TokenDto extends createZodDto(WaitlistTokenSchema) {}
class ConfirmDto extends createZodDto(ConfirmWaitlistSchema) {}
class DeclineDto extends createZodDto(DeclineWaitlistOfferSchema) {}
class StaffCreateDto extends createZodDto(StaffWaitlistCreateSchema) {}
class StaffUpdateDto extends createZodDto(StaffWaitlistUpdateSchema) {}
class ListQuery extends createZodDto(WaitlistListQuerySchema) {}

const publicActor = (req: Request): ActorContext => ({ userId: null, actorType: 'client', ip: clientIp(req), userAgent: (req.headers['user-agent'] ?? '').slice(0, 500) });

/** Лист ожидания для клиентов без входа: постановка с OTP, ответ на предложение по ссылке. */
@ApiTags('waitlist')
@Public()
@Controller('public')
export class PublicWaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Post('branches/:slug/waitlist')
  @RateLimit({ name: 'pub-waitlist', limit: 10, windowSec: 600, by: 'ip' })
  @ApiOperation({ summary: 'Встать в лист ожидания (отправляет OTP для подтверждения номера)' })
  join(@Param('slug') slug: string, @Body() body: JoinDto, @Req() req: Request) {
    return this.waitlist.join(slug, body, clientIp(req));
  }

  @Post('waitlist/:id/confirm')
  @HttpCode(200)
  @RateLimit({ name: 'pub-waitlist-confirm', limit: 30, windowSec: 600, by: 'ip' })
  @ApiOperation({ summary: 'Подтвердить заявку кодом OTP' })
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() body: ConfirmDto) {
    return this.waitlist.confirmJoin(id, body.token, body.code);
  }

  @Post('waitlist/:id/resend-otp')
  @HttpCode(200)
  @RateLimit({ name: 'pub-waitlist-resend', limit: 10, windowSec: 600, by: 'ip' })
  @ApiOperation({ summary: 'Повторно отправить OTP для заявки' })
  resend(@Param('id', ParseUUIDPipe) id: string, @Body() body: TokenDto, @Req() req: Request) {
    return this.waitlist.resendJoinOtp(id, body.token, clientIp(req));
  }

  @Post('waitlist/:id/cancel')
  @HttpCode(200)
  @RateLimit({ name: 'pub-waitlist-cancel', limit: 20, windowSec: 600, by: 'ip' })
  @ApiOperation({ summary: 'Выйти из листа ожидания по токену заявки' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() body: TokenDto, @Req() req: Request) {
    return this.waitlist.cancelByToken(id, body.token, publicActor(req));
  }

  @Get('waitlist-offers/:token')
  @RateLimit({ name: 'pub-waitlist-offer', limit: 60, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Предложение освободившегося времени по ссылке из уведомления' })
  offer(@Param('token') token: string) {
    return this.waitlist.getOffer(token);
  }

  @Post('waitlist-offers/:token/accept')
  @HttpCode(200)
  @RateLimit({ name: 'pub-waitlist-accept', limit: 20, windowSec: 600, by: 'ip' })
  @ApiOperation({ summary: 'Записаться на предложенное время (первый подтвердивший получает слот)' })
  accept(@Param('token') token: string, @Req() req: Request) {
    return this.waitlist.acceptOffer(token, clientIp(req));
  }

  @Post('waitlist-offers/:token/decline')
  @HttpCode(200)
  @RateLimit({ name: 'pub-waitlist-decline', limit: 20, windowSec: 600, by: 'ip' })
  @ApiOperation({ summary: 'Отказаться от предложения (и при желании выйти из листа ожидания)' })
  decline(@Param('token') token: string, @Body() body: DeclineDto) {
    return this.waitlist.declineOffer(token, body.leaveWaitlist);
  }
}

/** Лист ожидания филиала в кабинете администратора. */
@ApiTags('waitlist')
@Controller('organizations/:orgId/waitlist')
export class StaffWaitlistController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly waitlist: WaitlistService,
  ) {}

  private async load(t: TenantContext, id: string, permission: 'appointments.view' | 'appointments.manage') {
    const e = await this.prisma.waitlistEntry.findFirst({ where: { id, organizationId: t.organizationId }, select: { id: true, branchId: true } });
    if (!e) throw AppError.notFound('Заявка');
    assertBranchPermission(t, permission, e.branchId);
    return e;
  }

  @Get()
  @RequirePermission('appointments.view')
  @ApiOperation({ summary: 'Заявки листа ожидания (по филиалам, доступным пользователю)' })
  list(@Tenant() t: TenantContext, @Query() q: ListQuery) {
    const where: Prisma.WaitlistEntryWhereInput = {
      organizationId: t.organizationId,
      ...branchFilter(t, 'appointments.view', q.branchId),
      status: q.status === 'active' ? { in: ['waiting', 'offered'] } : q.status ? q.status : { not: 'pending_otp' },
    };
    return this.waitlist.list(where, q.page, q.pageSize);
  }

  @Post()
  @RequirePermission('appointments.manage')
  @ApiOperation({ summary: 'Добавить клиента в лист ожидания' })
  create(@Tenant() t: TenantContext, @Body() body: StaffCreateDto, @Actor() actor: ActorContext) {
    assertBranchPermission(t, 'appointments.manage', body.branchId);
    return this.waitlist.createByStaff(t.organizationId, body, actor);
  }

  @Patch(':id')
  @RequirePermission('appointments.manage')
  @ApiOperation({ summary: 'Изменить приоритет заявки' })
  async update(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: StaffUpdateDto, @Actor() actor: ActorContext) {
    await this.load(t, id, 'appointments.manage');
    return this.waitlist.updatePriority(id, body.priority, actor);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('appointments.manage')
  @ApiOperation({ summary: 'Удалить заявку из листа ожидания' })
  async cancel(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Actor() actor: ActorContext) {
    await this.load(t, id, 'appointments.manage');
    return this.waitlist.cancelEntry(id, actor);
  }
}

/** Лист ожидания в кабинете клиента (§18.1). */
@ApiTags('waitlist')
@ClientAccess()
@Controller('me/waitlist')
export class MeWaitlistController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly waitlist: WaitlistService,
  ) {}

  private clientWhere(user: AuthUser): Prisma.ClientWhereInput {
    return { OR: [{ userId: user.id }, ...(user.phone ? [{ phone: user.phone, userId: null }] : [])] };
  }

  @Get()
  @ApiOperation({ summary: 'Мои заявки в листах ожидания' })
  list(@CurrentUser() user: AuthUser) {
    return this.waitlist.listForClients(this.clientWhere(user));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Выйти из листа ожидания' })
  async cancel(@CurrentUser() user: AuthUser, @Actor() actor: ActorContext, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.prisma.waitlistEntry.findFirst({ where: { id, client: this.clientWhere(user) }, select: { id: true } });
    if (!e) throw AppError.notFound('Заявка');
    return this.waitlist.cancelEntry(id, { ...actor, actorType: 'client' });
  }
}
