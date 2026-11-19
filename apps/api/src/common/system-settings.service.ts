import { Injectable } from '@nestjs/common';
import { DEFAULT_SYSTEM_SETTINGS, SystemSettingsSchema, type SystemSettings } from '@booking/shared';
import { PrismaService } from './prisma.service';
import type { Prisma } from '../generated/prisma/client';

const KEY = 'system';
const CACHE_MS = 30_000;

@Injectable()
export class SystemSettingsService {
  private cache: { value: SystemSettings; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<SystemSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const row = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });
    const parsed = SystemSettingsSchema.safeParse({ ...DEFAULT_SYSTEM_SETTINGS, ...((row?.value as object) ?? {}) });
    const value = parsed.success ? parsed.data : DEFAULT_SYSTEM_SETTINGS;
    this.cache = { value, at: Date.now() };
    return value;
  }

  async set(value: SystemSettings, userId: string | null): Promise<SystemSettings> {
    await this.prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: value as Prisma.InputJsonValue, updatedByUserId: userId },
      update: { value: value as Prisma.InputJsonValue, updatedByUserId: userId },
    });
    this.cache = null;
    return value;
  }

  invalidate(): void {
    this.cache = null;
  }
}
