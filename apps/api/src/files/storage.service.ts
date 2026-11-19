import { Injectable } from '@nestjs/common';
import { promises as fs, createReadStream, type ReadStream } from 'node:fs';
import path from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getConfig } from '../config/config';

export const STORAGE_KEY_RE = /^(org\/[0-9a-f-]{36}|platform)\/[0-9a-f-]{36}\/(thumb|medium|large)\.webp$/;

/**
 * Объектное хранилище файлов (§24): S3-совместимое в production, локальный диск в разработке.
 * Ключи генерируются сервером и проверяются регулярным выражением (защита от path traversal).
 */
@Injectable()
export class StorageService {
  private s3: S3Client | null = null;

  private client(): S3Client {
    if (!this.s3) {
      const c = getConfig();
      this.s3 = new S3Client({
        region: c.S3_REGION,
        endpoint: c.S3_ENDPOINT || undefined,
        forcePathStyle: c.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: c.S3_ACCESS_KEY_ID, secretAccessKey: c.S3_SECRET_ACCESS_KEY },
      });
    }
    return this.s3;
  }

  private localPath(key: string): string {
    if (!STORAGE_KEY_RE.test(key)) throw new Error('Invalid storage key');
    const root = path.resolve(getConfig().STORAGE_LOCAL_DIR);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage path');
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!STORAGE_KEY_RE.test(key)) throw new Error('Invalid storage key');
    const c = getConfig();
    if (c.STORAGE_DRIVER === 's3') {
      await this.client().send(
        new PutObjectCommand({ Bucket: c.S3_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }),
      );
      return;
    }
    const p = this.localPath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  }

  async remove(key: string): Promise<void> {
    const c = getConfig();
    if (c.STORAGE_DRIVER === 's3') {
      await this.client().send(new DeleteObjectCommand({ Bucket: c.S3_BUCKET, Key: key }));
      return;
    }
    await fs.rm(this.localPath(key), { force: true });
  }

  /** Только для локального драйвера (раздача через API в разработке). */
  async openLocal(key: string): Promise<ReadStream | null> {
    try {
      const p = this.localPath(key);
      await fs.access(p);
      return createReadStream(p);
    } catch {
      return null;
    }
  }

  publicUrl(key: string): string {
    return `${getConfig().STORAGE_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  }
}
