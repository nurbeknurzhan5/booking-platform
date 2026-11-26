import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { getConfig } from '../config/config';
import { StorageService } from './storage.service';

export const MEDIA_KINDS = ['logo', 'cover', 'gallery', 'service', 'specialist', 'resource', 'template_preview'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DIMENSION = 8000;
const VARIANTS = { thumb: 320, medium: 960, large: 1920 } as const;

/** Определение фактического формата по сигнатуре файла (не доверяем расширению и MIME клиента). */
export function sniffImageType(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * Загрузка изображений (§24, §22): ограничение размера, проверка MIME и фактического формата,
 * лимит разрешения, перекодирование в WebP без метаданных (обезвреживает вложенное содержимое),
 * оптимизированные версии и миниатюры. Файлы хранятся в объектном хранилище, в БД — только ключи.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(organizationId: string | null, kind: MediaKind, file: UploadedFile | undefined, userId: string | null) {
    if (!file?.buffer?.length) throw AppError.badRequest('FILE_INVALID', 'Файл не передан');
    if (file.size > getConfig().MAX_UPLOAD_BYTES) {
      throw new AppError('FILE_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE, `Максимальный размер файла — ${Math.round(getConfig().MAX_UPLOAD_BYTES / 1024 / 1024)} МБ`);
    }
    if (!ALLOWED_MIME.has(file.mimetype)) throw AppError.badRequest('FILE_INVALID', 'Допустимы только JPEG, PNG и WebP');
    const sniffed = sniffImageType(file.buffer);
    if (!sniffed || sniffed !== file.mimetype) throw AppError.badRequest('FILE_INVALID', 'Содержимое файла не соответствует заявленному формату');

    let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try {
      meta = await sharp(file.buffer, { limitInputPixels: MAX_DIMENSION * MAX_DIMENSION, failOn: 'error' }).metadata();
    } catch {
      throw AppError.badRequest('FILE_INVALID', 'Повреждённое или неподдерживаемое изображение');
    }
    if (!meta.width || !meta.height || !['jpeg', 'png', 'webp'].includes(meta.format ?? '')) {
      throw AppError.badRequest('FILE_INVALID', 'Неподдерживаемое изображение');
    }
    if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) throw AppError.badRequest('FILE_INVALID', 'Слишком большое разрешение изображения');
    if ((meta.pages ?? 1) > 1) throw AppError.badRequest('FILE_INVALID', 'Анимированные изображения не поддерживаются');

    const id = randomUUID();
    const prefix = organizationId ? `org/${organizationId}` : 'platform';
    const variants: Record<string, string> = {};
    for (const [name, width] of Object.entries(VARIANTS)) {
      const out = await sharp(file.buffer, { limitInputPixels: MAX_DIMENSION * MAX_DIMENSION })
        .rotate() // учёт EXIF-ориентации, затем метаданные отбрасываются
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      const key = `${prefix}/${id}/${name}.webp`;
      await this.storage.put(key, out, 'image/webp');
      variants[name] = key;
    }
    const asset = await this.prisma.mediaAsset.create({
      data: {
        id,
        organizationId,
        kind,
        storageKey: variants.large!,
        mimeType: 'image/webp',
        width: meta.width,
        height: meta.height,
        sizeBytes: file.size,
        variants,
        originalName: file.originalname.replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 255),
        uploadedByUserId: userId,
      },
    });
    return this.toView(asset);
  }

  toView(a: { id: string; kind: string; width: number; height: number; variants: unknown; createdAt: Date }) {
    const v = a.variants as Record<string, string>;
    return {
      id: a.id,
      kind: a.kind,
      width: a.width,
      height: a.height,
      urls: Object.fromEntries(Object.entries(v).map(([k, key]) => [k, this.storage.publicUrl(key)])),
      createdAt: a.createdAt,
    };
  }

  async list(organizationId: string, kind?: string) {
    const rows = await this.prisma.mediaAsset.findMany({
      where: { organizationId, archivedAt: null, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return rows.map((r) => this.toView(r));
  }

  async archive(organizationId: string, id: string) {
    const r = await this.prisma.mediaAsset.updateMany({ where: { id, organizationId, archivedAt: null }, data: { archivedAt: new Date() } });
    if (r.count === 0) throw AppError.notFound('Файл');
  }

  /**
   * URL-ы набора ассетов организации (для публичных страниц). Чужие ID (из старой публикации, подложенные
   * в контент или связи) не разрешаются: изображение другой организации на странице не появится.
   */
  async urlsFor(organizationId: string, ids: string[]): Promise<Map<string, Record<string, string>>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.mediaAsset.findMany({ where: { id: { in: ids }, organizationId, archivedAt: null } });
    return new Map(rows.map((r) => [r.id, this.toView(r).urls]));
  }
}
