import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client';
import { getConfig } from '../config/config';

export type Tx = Prisma.TransactionClient;

/**
 * Адаптер PostgreSQL. Сессия принудительно в UTC (ТЗ §1.2): драйвер передаёт даты без смещения,
 * и при часовом поясе сервера, отличном от UTC, они интерпретировались бы со сдвигом.
 */
export function createPgAdapter(connectionString: string, max = 10): PrismaPg {
  return new PrismaPg({ connectionString, max, options: '-c TimeZone=UTC' });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const cfg = getConfig();
    super({ adapter: createPgAdapter(cfg.DATABASE_URL, cfg.DATABASE_POOL_SIZE) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
