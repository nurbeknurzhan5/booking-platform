import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { hasPermission } from '@booking/shared';
import { Actor, AnyMember, Public, RateLimit, SuperadminOnly, Tenant } from '../common/decorators';
import type { ActorContext, TenantContext } from '../common/request-context';
import { AppError } from '../common/errors';
import { getConfig } from '../config/config';
import { MEDIA_KINDS, MediaService, type MediaKind, type UploadedFile as Upload } from './media.service';
import { StorageService } from './storage.service';

const uploadInterceptor = () =>
  FileInterceptor('file', { limits: { fileSize: getConfig().MAX_UPLOAD_BYTES, files: 1, fields: 5 } });

function parseKind(kind: unknown): MediaKind {
  if (typeof kind !== 'string' || !(MEDIA_KINDS as readonly string[]).includes(kind)) {
    throw AppError.badRequest('VALIDATION_ERROR', `kind: одно из ${MEDIA_KINDS.join(', ')}`);
  }
  return kind as MediaKind;
}

const UPLOAD_BODY = {
  schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, kind: { type: 'string', enum: [...MEDIA_KINDS] } } },
};

@ApiTags('public-pages')
@Controller()
export class FilesController {
  constructor(
    private readonly media: MediaService,
    private readonly storage: StorageService,
  ) {}

  @Post('organizations/:orgId/files')
  @AnyMember()
  @UseInterceptors(uploadInterceptor())
  @RateLimit({ name: 'upload', limit: 60, windowSec: 600, by: 'user' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY)
  @ApiOperation({ summary: 'Загрузить изображение (JPEG/PNG/WebP, до 5 МБ) — логотип, фото, услуги, специалисты' })
  async upload(@Tenant() t: TenantContext, @UploadedFile() file: Upload | undefined, @Body('kind') kind: string, @Actor() a: ActorContext) {
    const canEdit = ['pages.edit', 'services.manage', 'specialists.manage'].some((p) => hasPermission(t.grant, p as 'pages.edit'));
    if (!canEdit) throw AppError.forbidden();
    return this.media.upload(t.organizationId, parseKind(kind), file, a.userId);
  }

  @Get('organizations/:orgId/files')
  @AnyMember()
  list(@Tenant() t: TenantContext, @Query('kind') kind?: string) {
    return this.media.list(t.organizationId, kind?.slice(0, 30));
  }

  @Delete('organizations/:orgId/files/:id')
  @HttpCode(204)
  @AnyMember()
  async archive(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const canEdit = ['pages.edit', 'services.manage', 'specialists.manage'].some((p) => hasPermission(t.grant, p as 'pages.edit'));
    if (!canEdit) throw AppError.forbidden();
    await this.media.archive(t.organizationId, id);
  }

  @SuperadminOnly()
  @Post('admin/files')
  @UseInterceptors(uploadInterceptor())
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY)
  @ApiOperation({ summary: 'Загрузка изображения платформы (превью шаблона)' })
  adminUpload(@UploadedFile() file: Upload | undefined, @Actor() a: ActorContext) {
    return this.media.upload(null, 'template_preview', file, a.userId);
  }

  /** Раздача файлов при локальном драйвере хранилища (в production файлы отдаёт S3/CDN). */
  @Public()
  @Get('media/:scope/:owner/:asset/:file')
  async serve(
    @Param('scope') scope: string,
    @Param('owner') owner: string,
    @Param('asset') asset: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    if (scope !== 'org' || getConfig().STORAGE_DRIVER !== 'local') throw AppError.notFound();
    const key = `org/${owner}/${asset}/${file}`;
    const stream = await this.storage.openLocal(key).catch(() => null);
    if (!stream) throw AppError.notFound('Файл');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    stream.pipe(res);
  }

  @Public()
  @Get('media/platform/:asset/:file')
  async servePlatform(@Param('asset') asset: string, @Param('file') file: string, @Res() res: Response) {
    if (getConfig().STORAGE_DRIVER !== 'local') throw AppError.notFound();
    const stream = await this.storage.openLocal(`platform/${asset}/${file}`).catch(() => null);
    if (!stream) throw AppError.notFound('Файл');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  }
}
