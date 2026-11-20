import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker/worker.module';

/** Отдельный процесс фоновых задач: уведомления (outbox), резервы, подписки, напоминания, аналитика. */
async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}

main().catch((err) => {
   
  console.error(err);
  process.exit(1);
});
