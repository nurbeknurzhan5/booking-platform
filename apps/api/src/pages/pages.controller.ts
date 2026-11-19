import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  AutoTranslateSchema,
  LOCALES,
  PageModerationSchema,
  PageStatusSchema,
  SavePageDraftSchema,
  TemplateInputSchema,
  TemplateUpdateSchema,
  TranslationUpsertSchema,
  type Locale,
} from '@booking/shared';
import { Actor, Public, RateLimit, RequirePermission, SuperadminOnly, Tenant } from '../common/decorators';
import type { ActorContext, AppRequest, TenantContext } from '../common/request-context';
import { PagesService } from './pages.service';
import { TemplatesService } from './templates.service';
import { TranslationService, type EntityType } from './translation.service';
import { PrismaService } from '../common/prisma.service';

class DraftDto extends createZodDto(SavePageDraftSchema) {}
class StatusDto extends createZodDto(PageStatusSchema) {}
class TranslationsDto extends createZodDto(TranslationUpsertSchema) {}
class AutoDto extends createZodDto(AutoTranslateSchema) {}
class TemplateDto extends createZodDto(TemplateInputSchema) {}
class TemplateUpdateDto extends createZodDto(TemplateUpdateSchema) {}
class TemplateStatusDto extends createZodDto(z.object({ status: z.enum(['draft', 'published', 'disabled']) })) {}
class ModerationDto extends createZodDto(PageModerationSchema) {}

const asLocale = (l?: string): Locale => ((LOCALES as readonly string[]).includes(l ?? '') ? (l as Locale) : 'ru');

@ApiTags('public-pages')
@Controller()
export class PagesController {
  constructor(
    private readonly pages: PagesService,
    private readonly templates: TemplatesService,
    private readonly translations: TranslationService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------- публично ----------
  @Public()
  @Get('public/pages/:slug')
  @RateLimit({ name: 'pub-page', limit: 300, windowSec: 60, by: 'ip' })
  @ApiOperation({ summary: 'Опубликованная страница филиала по постоянной ссылке (ru/kk/en)' })
  publicPage(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.pages.publicPage(slug, asLocale(locale));
  }

  @Public()
  @Get('public/pages/:slug/can-edit')
  @ApiOperation({ summary: 'Может ли текущий пользователь редактировать страницу (кнопка «Редактировать»)' })
  canEdit(@Param('slug') slug: string, @Req() req: AppRequest) {
    return this.pages.canEdit(slug, req.user);
  }

  // ---------- каталог шаблонов ----------
  @Get('templates')
  @ApiOperation({ summary: 'Каталог опубликованных шаблонов' })
  catalog() {
    return this.templates.catalog();
  }

  // ---------- редактор (владелец и администраторы с правом pages.edit) ----------
  @Get('organizations/:orgId/branches/:branchId/page')
  @RequirePermission('pages.edit')
  @ApiOperation({ summary: 'Редактор: черновик, версии, переводы' })
  editor(@Tenant() t: TenantContext, @Param('branchId') branchId: string) {
    return this.pages.editor(t, branchId);
  }

  @Put('organizations/:orgId/branches/:branchId/page/draft')
  @RequirePermission('pages.edit')
  @ApiOperation({ summary: 'Сохранить черновик (посетители видят прежнюю опубликованную версию)' })
  saveDraft(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Body() body: DraftDto, @Actor() a: ActorContext) {
    return this.pages.saveDraft(t, branchId, body, a);
  }

  @Get('organizations/:orgId/branches/:branchId/page/preview')
  @RequirePermission('pages.edit')
  @ApiOperation({ summary: 'Предпросмотр черновика (опционально — с другим шаблоном)' })
  preview(
    @Tenant() t: TenantContext,
    @Param('branchId') branchId: string,
    @Query('locale') locale?: string,
    @Query('templateId', new ParseUUIDPipe({ optional: true })) templateId?: string,
    @Query('colorScheme') colorScheme?: string,
  ) {
    return this.pages.preview(t, branchId, asLocale(locale), templateId ? { templateId, colorScheme: colorScheme?.slice(0, 40) } : undefined);
  }

  @Post('organizations/:orgId/branches/:branchId/page/publish')
  @HttpCode(200)
  @RequirePermission('pages.edit')
  @ApiOperation({ summary: 'Опубликовать черновик' })
  publish(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Actor() a: ActorContext) {
    return this.pages.publish(t, branchId, a);
  }

  @Post('organizations/:orgId/branches/:branchId/page/versions/:publicationId/restore')
  @HttpCode(200)
  @RequirePermission('pages.edit')
  @ApiOperation({ summary: 'Восстановить версию в черновик' })
  restore(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Param('publicationId', ParseUUIDPipe) id: string, @Actor() a: ActorContext) {
    return this.pages.restore(t, branchId, id, a);
  }

  @Get('organizations/:orgId/branches/:branchId/page/history')
  @RequirePermission('pages.edit')
  history(@Tenant() t: TenantContext, @Param('branchId') branchId: string) {
    return this.pages.history(t, branchId);
  }

  @Put('organizations/:orgId/branches/:branchId/page/status')
  @RequirePermission('pages.edit')
  @ApiOperation({ summary: 'Статус страницы: active / temporarily_closed / disabled' })
  status(@Tenant() t: TenantContext, @Param('branchId') branchId: string, @Body() body: StatusDto, @Actor() a: ActorContext) {
    return this.pages.setStatus(t, branchId, body.status, a);
  }

  // ---------- переводы ----------
  @Get('organizations/:orgId/translations')
  @RequirePermission('pages.edit')
  @ApiOperation({ summary: 'Переводы контента со статусами (missing / auto_translated / verified / manually_edited)' })
  listTranslations(@Tenant() t: TenantContext, @Query('entityType') entityType?: string, @Query('locale') locale?: string) {
    const types: EntityType[] = ['page', 'service', 'specialist', 'service_category', 'promotion'];
    return this.translations.list(t.organizationId, {
      entityType: types.includes(entityType as EntityType) ? (entityType as EntityType) : undefined,
      locale: (LOCALES as readonly string[]).includes(locale ?? '') ? (locale as Locale) : undefined,
    });
  }

  @Put('organizations/:orgId/translations')
  @RequirePermission('pages.edit')
  @ApiOperation({ summary: 'Ручное редактирование переводов (не перезаписывается автопереводом)' })
  async upsertTranslations(@Tenant() t: TenantContext, @Body() body: TranslationsDto, @Actor() a: ActorContext) {
    await this.translations.upsertManual(t.organizationId, body.items, a.userId);
    return { updated: body.items.length };
  }

  @Post('organizations/:orgId/translations/auto')
  @HttpCode(200)
  @RequirePermission('pages.edit')
  @ApiOperation({ summary: 'Поставить автоперевод в очередь (ручные переводы — только с overwriteManual)' })
  auto(@Tenant() t: TenantContext, @Body() body: AutoDto) {
    return this.translations.requestAuto(t.organizationId, body.locale, body);
  }

  // ---------- суперадмин: шаблоны и модерация ----------
  @SuperadminOnly()
  @Get('admin/templates')
  adminTemplates() {
    return this.templates.adminList();
  }

  @SuperadminOnly()
  @Post('admin/templates')
  createTemplate(@Body() body: TemplateDto, @Actor() a: ActorContext) {
    return this.templates.create(body, a);
  }

  @SuperadminOnly()
  @Patch('admin/templates/:id')
  updateTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() body: TemplateUpdateDto, @Actor() a: ActorContext) {
    return this.templates.update(id, body, a);
  }

  @SuperadminOnly()
  @Post('admin/templates/:id/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Опубликовать / отключить шаблон' })
  templateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: TemplateStatusDto, @Actor() a: ActorContext) {
    return this.templates.setStatus(id, body.status, a);
  }

  @SuperadminOnly()
  @Get('admin/pages')
  @ApiOperation({ summary: 'Публичные страницы для модерации' })
  adminPages(@Query('blocked') blocked?: string) {
    return this.prisma.publicPage.findMany({
      where: blocked === 'true' ? { moderationBlocked: true } : {},
      include: { branch: { select: { id: true, name: true, slug: true, organization: { select: { id: true, name: true } } } } },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
  }

  @SuperadminOnly()
  @Post('admin/pages/:pageId/moderation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Заблокировать/разблокировать страницу с причиной' })
  moderate(@Param('pageId', ParseUUIDPipe) id: string, @Body() body: ModerationDto, @Actor() a: ActorContext) {
    return this.pages.moderate(id, body.blocked, body.reason, a);
  }
}
