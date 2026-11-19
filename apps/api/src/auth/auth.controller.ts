import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import type { Request, Response } from 'express';
import { ChangePasswordSchema, ClientOtpRequestSchema, ClientOtpVerifySchema, StaffLoginSchema } from '@booking/shared';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { Actor, AllowPasswordChangePending, ClientAccess, CurrentUser, Public, RateLimit } from '../common/decorators';
import type { ActorContext, AuthUser } from '../common/request-context';

class StaffLoginDto extends createZodDto(StaffLoginSchema) {}
class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
class OtpRequestDto extends createZodDto(ClientOtpRequestSchema) {}
class OtpVerifyDto extends createZodDto(ClientOtpVerifySchema) {}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Get('csrf')
  @ApiOperation({ summary: 'Выдать CSRF-токен (cookie bk_csrf + тело)' })
  csrf(@Res({ passthrough: true }) res: Response) {
    return { csrfToken: this.sessions.issueCsrf(res) };
  }

  @Public()
  @Post('staff/login')
  @HttpCode(200)
  @RateLimit({ name: 'staff-login', limit: 30, windowSec: 900, by: 'ip' })
  @ApiOperation({ summary: 'Вход сотрудника (email + пароль; суперадмин — + TOTP)' })
  staffLogin(@Body() body: StaffLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.staffLogin(body, req, res);
  }

  @Public()
  @Post('client/otp/request')
  @HttpCode(200)
  @RateLimit({ name: 'otp-request', limit: 20, windowSec: 3600, by: 'ip' })
  @ApiOperation({ summary: 'Запросить OTP для входа клиента по телефону' })
  requestOtp(@Body() body: OtpRequestDto, @Req() req: Request) {
    return this.auth.clientRequestOtp(body.phone, req);
  }

  @Public()
  @Post('client/otp/verify')
  @HttpCode(200)
  @RateLimit({ name: 'otp-verify', limit: 30, windowSec: 900, by: 'ip' })
  @ApiOperation({ summary: 'Подтвердить OTP: вход/регистрация клиента, привязка гостевых записей' })
  verifyOtp(@Body() body: OtpVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.clientVerifyOtp(body, req, res);
  }

  @ClientAccess()
  @AllowPasswordChangePending()
  @Get('me')
  @ApiOperation({ summary: 'Текущий пользователь и членство в организациях' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user.id).then((p) => ({ ...p, sessionKind: user.sessionKind, mfaVerified: user.mfaVerified }));
  }

  @AllowPasswordChangePending()
  @Post('staff/change-password')
  @HttpCode(204)
  @RateLimit({ name: 'change-password', limit: 10, windowSec: 900, by: 'user' })
  @ApiOperation({ summary: 'Сменить пароль (обязательно после выдачи временного)' })
  async changePassword(@Body() body: ChangePasswordDto, @CurrentUser() user: AuthUser, @Actor() actor: ActorContext) {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword, actor);
  }

  @ClientAccess()
  @AllowPasswordChangePending()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Выход (отзыв текущей сессии)' })
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(user.sessionId);
    this.sessions.clearCookies(res);
  }
}
