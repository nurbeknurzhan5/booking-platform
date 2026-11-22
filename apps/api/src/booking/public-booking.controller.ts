import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { DateTime } from 'luxon';
import type { Request, Response } from 'express';
import {
  AvailabilitySearchSchema,
  CancelSchema,
  ConfirmLinkSchema,
  CreateHoldSchema,
  HoldTokenSchema,
  QuoteSchema,
  RescheduleSchema,
} from '@booking/shared';
import { Public, RateLimit } from '../common/decorators';
import { clientIp } from '../common/request-context';
import { IdempotencyService } from '../common/idempotency.service';
import { BookingService } from './booking.service';
import { AppError } from '../common/errors';
import { sha256 } from '../common/crypto';

class SearchDto extends createZodDto(AvailabilitySearchSchema) {}
class QuoteDto extends createZodDto(QuoteSchema) {}
class HoldDto extends createZodDto(CreateHoldSchema) {}
class ConfirmLinkDto extends createZodDto(ConfirmLinkSchema) {}
class HoldTokenDto extends createZodDto(HoldTokenSchema) {}
class RescheduleDto extends createZodDto(RescheduleSchema) {}
class CancelDto extends createZodDto(CancelSchema) {}

const publicActor = (req: Request) => ({ userId: null, actorType: 'client' as const, ip: clientIp(req), userAgent: (req.headers['user-agent'] ?? '').slice(0, 500) });

function assertDateRange(date: string) {
  const d = new Date(`${date}T00:00:00Z`).getTime();
  if (Number.isNaN(d) || d < Date.now() - 2 * 86400_000 || d > Date.now() + 400 * 86400_000) {
    throw AppError.badRequest('VALIDATION_ERROR', 'Дата вне допустимого диапазона');
  }
}

@ApiTags('availability', 'appointments')
@Public()
@Controller('public')
export class PublicBookingController {
  constructor(
    private readonly booking: BookingService,
    private readonly idem: IdempotencyService,
  ) {}

  @Post('branches/:slug/availability')
  @HttpCode(200)
  @RateLimit({ name: 'pub-availability', limit: 120, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Свободные слоты на дату для набора услуг (специалист или автоподбор)' })
  async availability(@Param('slug') slug: string, @Body() body: SearchDto) {
    assertDateRange(body.date);
    const branch = await this.booking.assertPublicBookingAllowed(slug);
    return this.booking.searchSlots(branch.id, body.date, body.items, 'public');
  }

  @Post('branches/:slug/availability/overview')
  @HttpCode(200)
  @RateLimit({ name: 'pub-availability-overview', limit: 60, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Запись на одной странице: слоты на дату, число окон по 14 дням и по каждому специалисту' })
  async availabilityOverview(@Param('slug') slug: string, @Body() body: SearchDto) {
    assertDateRange(body.date);
    const branch = await this.booking.assertPublicBookingAllowed(slug);
    const today = DateTime.now().setZone(branch.timezone).startOf('day');
    const days = Array.from({ length: 14 }, (_, i) => today.plus({ days: i }).toISODate()!);
    return this.booking.searchOverview(branch.id, body.date, body.items, days, 'public');
  }

  @Post('branches/:slug/quote')
  @HttpCode(200)
  @RateLimit({ name: 'pub-quote', limit: 60, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Предварительный расчёт стоимости и длительности (промокод проверяется на сервере)' })
  async quote(@Param('slug') slug: string, @Body() body: QuoteDto) {
    const branch = await this.booking.assertPublicBookingAllowed(slug);
    return this.booking.quote(branch.id, body.items, body.promoCode, 'public');
  }

  @Post('branches/:slug/bookings')
  @RateLimit({ name: 'pub-hold-ip', limit: 15, windowSec: 600, by: 'ip' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Создать временный резерв и отправить ссылку подтверждения (атомарно, без двойного бронирования)' })
  async createHold(
    @Param('slug') slug: string,
    @Body() body: HoldDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = clientIp(req);
    const r = await this.idem.run(`hold:${slug}:${sha256(ip)}`, key, body, async () => ({
      status: 201,
      body: await this.booking.createHold(slug, body, ip),
    }));
    res.status(r.status);
    return r.body;
  }

  @Post('bookings/confirm-link')
  @HttpCode(200)
  @RateLimit({ name: 'pub-confirm', limit: 30, windowSec: 600, by: 'ip' })
  @ApiOperation({ summary: 'Подтвердить запись по одноразовой ссылке из сообщения' })
  confirmLink(@Body() body: ConfirmLinkDto, @Req() req: Request) {
    return this.booking.confirmByLink(body.token, clientIp(req));
  }

  @Post('bookings/:id/status')
  @HttpCode(200)
  @RateLimit({ name: 'pub-hold-status', limit: 120, windowSec: 600, by: 'ip' })
  @ApiOperation({ summary: 'Состояние резерва: страница записи ждёт перехода по ссылке' })
  holdStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: HoldTokenDto) {
    return this.booking.holdStatus(id, body.holdToken);
  }

  @Post('bookings/:id/resend-link')
  @HttpCode(200)
  @RateLimit({ name: 'pub-resend', limit: 10, windowSec: 600, by: 'ip' })
  @ApiOperation({ summary: 'Отправить новую ссылку подтверждения (прежняя перестаёт действовать)' })
  resend(@Param('id', ParseUUIDPipe) id: string, @Body() body: HoldTokenDto, @Req() req: Request) {
    return this.booking.resendLink(id, body.holdToken, clientIp(req));
  }

  @Post('bookings/:id/extend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Продлить резерв (если разрешено владельцем)' })
  extend(@Param('id', ParseUUIDPipe) id: string, @Body() body: HoldTokenDto) {
    return this.booking.extendHold(id, body.holdToken);
  }

  @Post('bookings/:id/abandon')
  @HttpCode(204)
  @ApiOperation({ summary: 'Отказаться от резерва (слот освобождается сразу)' })
  async abandon(@Param('id', ParseUUIDPipe) id: string, @Body() body: HoldTokenDto, @Req() req: Request) {
    await this.booking.abandonHold(id, body.holdToken, clientIp(req));
  }

  // ---------- управление записью по секретной ссылке (гостевая запись, D-11) ----------

  @Get('manage/:token')
  @RateLimit({ name: 'pub-manage', limit: 60, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Запись по ссылке управления' })
  async manage(@Param('token') token: string) {
    return (await this.booking.findByManageToken(token)).view;
  }

  @Post('manage/:token/availability')
  @HttpCode(200)
  @RateLimit({ name: 'pub-manage-av', limit: 60, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Свободные слоты для переноса (с учётом освобождения текущего времени)' })
  async manageAvailability(@Param('token') token: string, @Body() body: SearchDto) {
    assertDateRange(body.date);
    const { raw } = await this.booking.findByManageToken(token);
    return this.booking.searchSlots(raw.branchId, body.date, body.items, 'public', raw.id);
  }

  @Post('manage/:token/reschedule')
  @HttpCode(200)
  @RateLimit({ name: 'pub-reschedule', limit: 20, windowSec: 600, by: 'ip' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Перенести запись (без повторного OTP; атомарно)' })
  async reschedule(
    @Param('token') token: string,
    @Body() body: RescheduleDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { raw } = await this.booking.findByManageToken(token);
    const r = await this.idem.run(`reschedule:${raw.id}`, key, body, async () => ({
      body: await this.booking.reschedule(raw.id, body, publicActor(req), 'client'),
    }));
    res.status(r.status);
    return r.body;
  }

  @Post('manage/:token/cancel')
  @HttpCode(200)
  @RateLimit({ name: 'pub-cancel', limit: 20, windowSec: 600, by: 'ip' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Отменить запись (до дедлайна, установленного владельцем)' })
  async cancel(
    @Param('token') token: string,
    @Body() body: CancelDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { raw } = await this.booking.findByManageToken(token);
    const r = await this.idem.run(`cancel:${raw.id}`, key, body, async () => ({
      body: await this.booking.cancel(raw.id, publicActor(req), 'client', body.reason),
    }));
    res.status(r.status);
    return r.body;
  }
}
