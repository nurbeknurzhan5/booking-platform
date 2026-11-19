import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import type { Response } from 'express';
import { AvailabilitySearchSchema, CancelSchema, CreateReviewSchema, RescheduleSchema, UpdateMyProfileSchema } from '@booking/shared';
import { Actor, ClientAccess, CurrentUser, RateLimit } from '../common/decorators';
import type { ActorContext, AuthUser } from '../common/request-context';
import { PrismaService } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { BookingService } from '../booking/booking.service';
import { ReviewsService } from '../reviews/reviews.service';
import { IdempotencyService } from '../common/idempotency.service';
import type { Prisma } from '../generated/prisma/client';

class ProfileDto extends createZodDto(UpdateMyProfileSchema) {}
class RescheduleDto extends createZodDto(RescheduleSchema) {}
class CancelDto extends createZodDto(CancelSchema) {}
class ReviewDto extends createZodDto(CreateReviewSchema) {}
class SearchDto extends createZodDto(AvailabilitySearchSchema) {}

/** Кабинет клиента (§18.1): записи во всех организациях по подтверждённому номеру телефона. */
@ApiTags('clients')
@ClientAccess()
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly reviews: ReviewsService,
    private readonly idem: IdempotencyService,
  ) {}

  private clientWhere(user: AuthUser): Prisma.ClientWhereInput {
    return { OR: [{ userId: user.id }, ...(user.phone ? [{ phone: user.phone, userId: null }] : [])] };
  }

  /** Владение записью проверяется на сервере: запись принадлежит клиенту текущего пользователя. */
  private async own(user: AuthUser, id: string) {
    const a = await this.prisma.appointment.findFirst({ where: { id, client: this.clientWhere(user) }, select: { id: true, branchId: true } });
    if (!a) throw AppError.notFound('Запись');
    return a;
  }

  @Get('appointments')
  @ApiOperation({ summary: 'Мои записи: upcoming | history | cancelled' })
  async appointments(@CurrentUser() user: AuthUser, @Query('scope') scope = 'upcoming') {
    const now = new Date();
    const where: Prisma.AppointmentWhereInput =
      scope === 'cancelled'
        ? { status: { in: ['cancelled_by_client', 'cancelled_by_admin'] } }
        : scope === 'history'
          ? { OR: [{ status: { in: ['completed', 'no_show'] } }, { status: 'confirmed', endAt: { lte: now } }] }
          : { status: 'confirmed', endAt: { gt: now } };
    const rows = await this.prisma.appointment.findMany({
      where: { client: this.clientWhere(user), ...where },
      orderBy: { startAt: scope === 'upcoming' ? 'asc' : 'desc' },
      take: 100,
      include: {
        items: { orderBy: { position: 'asc' } },
        branch: { select: { id: true, name: true, slug: true, address: true, phone: true, timezone: true, organizationId: true } },
        client: { select: { id: true, name: true, phone: true } },
        hold: { select: { expiresAt: true, releasedAt: true, extensionCount: true } },
        review: { select: { id: true, rating: true } },
      },
    });
    const settings = await this.prisma.bookingSettings.findMany({ where: { branchId: { in: [...new Set(rows.map((r) => r.branchId))] } } });
    return rows.map((r) => this.booking.toView(r, settings.find((s) => s.branchId === r.branchId)!));
  }

  @Post('appointments/:id/availability')
  @HttpCode(200)
  async availability(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: SearchDto) {
    const a = await this.own(user, id);
    return this.booking.searchSlots(a.branchId, body.date, body.items, 'public', a.id);
  }

  @Post('appointments/:id/reschedule')
  @HttpCode(200)
  @RateLimit({ name: 'me-reschedule', limit: 20, windowSec: 600, by: 'user' })
  async reschedule(
    @CurrentUser() user: AuthUser,
    @Actor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RescheduleDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.own(user, id);
    const r = await this.idem.run(`reschedule:${id}`, key, body, async () => ({ body: await this.booking.reschedule(id, body, { ...actor, actorType: 'client' }, 'client') }));
    res.status(r.status);
    return r.body;
  }

  @Post('appointments/:id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Actor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.own(user, id);
    const r = await this.idem.run(`cancel:${id}`, key, body, async () => ({ body: await this.booking.cancel(id, { ...actor, actorType: 'client' }, 'client', body.reason) }));
    res.status(r.status);
    return r.body;
  }

  @Post('appointments/:id/review')
  @RateLimit({ name: 'me-review', limit: 10, windowSec: 3600, by: 'user' })
  @ApiOperation({ summary: 'Оставить отзыв о завершённом визите' })
  async review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewDto) {
    await this.own(user, id);
    return this.reviews.create(id, body);
  }

  @Get('profile')
  async profile(@CurrentUser() user: AuthUser) {
    const consents = user.phone
      ? await this.prisma.clientConsent.findMany({ where: { phone: user.phone, organizationId: null }, orderBy: { createdAt: 'desc' } })
      : [];
    const latest = (t: string) => consents.find((c) => c.consentType === t)?.granted ?? (t === 'marketing' ? false : true);
    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      locale: user.locale,
      consents: { notifications: latest('notifications'), whatsapp: latest('whatsapp'), marketing: latest('marketing') },
    };
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Изменить имя, язык и согласия на уведомления' })
  async updateProfile(@CurrentUser() user: AuthUser, @Body() body: ProfileDto, @Actor() actor: ActorContext) {
    await this.prisma.user.update({ where: { id: user.id }, data: { name: body.name, locale: body.locale } });
    if (body.name || body.locale) {
      await this.prisma.client.updateMany({ where: { userId: user.id, anonymizedAt: null }, data: { ...(body.name ? { name: body.name } : {}), ...(body.locale ? { locale: body.locale } : {}) } });
    }
    if (body.consents && user.phone) {
      const rows = Object.entries(body.consents).filter(([, v]) => v !== undefined) as Array<[string, boolean]>;
      await this.prisma.clientConsent.createMany({
        data: rows.map(([consentType, granted]) => ({ userId: user.id, phone: user.phone!, consentType, granted, textVersion: '2026-11-v1', source: 'profile', ip: actor.ip })),
      });
    }
    return this.profile({ ...user, name: body.name ?? user.name, locale: body.locale ?? user.locale });
  }
}
