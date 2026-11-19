import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { MfaService, PasswordService } from './password.service';
import { OtpService } from './otp.service';
import { NotificationService } from '../notifications/notification.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, PasswordService, MfaService, OtpService, NotificationService],
  exports: [AuthService, SessionService, PasswordService, MfaService, OtpService, NotificationService],
})
export class AuthModule {}
