import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CreateReviewSchema, ReviewModerationSchema, ReviewReplySchema } from '@booking/shared';
import { Actor, Public, RateLimit, RequirePermission, SuperadminOnly, Tenant } from '../common/decorators';
import type { ActorContext, TenantContext } from '../common/request-context';
import { ReviewsService } from './reviews.service';
import { BookingService } from '../booking/booking.service';
import { PrismaService } from '../common/prisma.service';

class ReplyDto extends createZodDto(ReviewReplySchema) {}
class ReportDto extends createZodDto(z.object({ reason: z.string().trim().min(3).max(500) })) {}
class ModerationDto extends createZodDto(ReviewModerationSchema) {}
class CreateDto extends createZodDto(CreateReviewSchema) {}

const OptionalUuid = new ParseUUIDPipe({ optional: true });

@ApiTags('reviews')
@Controller()
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly booking: BookingService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('public/manage/:token/review')
  @RateLimit({ name: 'pub-review', limit: 10, windowSec: 3600, by: 'ip' })
  @ApiOperation({ summary: 'Отзыв по ссылке управления записью (гостевой клиент)' })
  async createByToken(@Param('token') token: string, @Body() body: CreateDto) {
    const { raw } = await this.booking.findByManageToken(token);
    return this.reviews.create(raw.id, body);
  }

  @Get('organizations/:orgId/reviews')
  @RequirePermission('reviews.manage')
  list(@Tenant() t: TenantContext, @Query('branchId', OptionalUuid) branchId?: string) {
    return this.reviews.list(t, branchId);
  }

  @Post('organizations/:orgId/reviews/:id/reply')
  @HttpCode(200)
  @RequirePermission('reviews.manage')
  @ApiOperation({ summary: 'Ответ организации на отзыв (текст отзыва изменить нельзя)' })
  reply(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReplyDto, @Actor() a: ActorContext) {
    return this.reviews.reply(t, id, body.text, a);
  }

  @Post('organizations/:orgId/reviews/:id/report')
  @HttpCode(200)
  @RequirePermission('reviews.manage')
  @ApiOperation({ summary: 'Пожаловаться на отзыв (рассматривает суперадминистратор)' })
  report(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReportDto, @Actor() a: ActorContext) {
    return this.reviews.report(t, id, body.reason, a);
  }

  @SuperadminOnly()
  @Get('admin/reviews')
  @ApiOperation({ summary: 'Отзывы на модерацию (жалобы)' })
  adminList(@Query('reported') reported?: string) {
    return this.prisma.review.findMany({
      where: reported === 'true' ? { reportedAt: { not: null } } : {},
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { branch: { select: { id: true, name: true, slug: true } } },
    });
  }

  @SuperadminOnly()
  @Post('admin/reviews/:id/moderate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Модерация отзыва с указанием причины' })
  moderate(@Param('id', ParseUUIDPipe) id: string, @Body() body: ModerationDto, @Actor() a: ActorContext) {
    return this.reviews.moderate(id, body.status, body.reason, a);
  }
}
