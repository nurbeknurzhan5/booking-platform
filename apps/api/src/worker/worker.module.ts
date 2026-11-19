import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { DomainModule } from '../domain.module';
import { WorkerService } from './worker.service';
import { getConfig } from '../config/config';

@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: { level: getConfig().APP_ENV === 'test' ? 'silent' : getConfig().LOG_LEVEL } }),
    CommonModule,
    AuthModule,
    DomainModule,
  ],
  providers: [WorkerService],
})
export class WorkerModule {}
