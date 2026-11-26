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
  return new SerializedTxPg({ connectionString, max, options: '-c TimeZone=UTC' });
}

type PgAdapter = Awaited<ReturnType<PrismaPg['connect']>>;
type PgTransaction = Awaited<ReturnType<PgAdapter['startTransaction']>>;

/**
 * Запросы внутри транзакции выполняются строго по очереди. Транзакция занимает одно соединение pg,
 * а движок Prisma загружает несколько связей (include) параллельно через Promise.all — pg ставил такие
 * запросы в свою внутреннюю очередь с предупреждением DeprecationWarning («client.query() when the client
 * is already executing a query», в pg@9 перестанет работать). Порядок выполнения на соединении не меняется.
 */
export function serializeTransactionQueries(tx: PgTransaction): PgTransaction {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
  const queryRaw = tx.queryRaw.bind(tx);
  const executeRaw = tx.executeRaw.bind(tx);
  tx.queryRaw = (query) => enqueue(() => queryRaw(query));
  tx.executeRaw = (query) => enqueue(() => executeRaw(query));
  return tx;
}

class SerializedTxPg extends PrismaPg {
  override async connect(): Promise<PgAdapter> {
    const adapter = await super.connect();
    const start = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async (isolationLevel) => serializeTransactionQueries(await start(isolationLevel));
    return adapter;
  }
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
