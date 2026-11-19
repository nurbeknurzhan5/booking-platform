import { HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { PasswordService, MfaService } from './password.service';
import { SessionService } from './session.service';
import { OtpService } from './otp.service';
import { RateLimitService } from '../common/rate-limit.service';
import { AuditService } from '../common/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { clientIp, type ActorContext, type AuthUser } from '../common/request-context';

const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionService,
    private readonly otp: OtpService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async staffLogin(
    input: { email: string; password: string; totpCode?: string },
    req: Request,
    res: Response,
  ): Promise<{ mfaRequired?: boolean; user?: unknown }> {
    const ip = clientIp(req);
    await this.rateLimit.consume(`login:ip:${ip}`, 30, 900);
    await this.rateLimit.consume(`login:email:${input.email}`, 15, 900);

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const invalid = () => new AppError('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED, 'Неверный email или пароль');

    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppError('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, 'Вход временно заблокирован после неудачных попыток');
    }
    const ok = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !ok) {
      if (user) {
        const failed = user.failedLoginCount + 1;
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
            lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined,
          },
        });
      }
      throw invalid();
    }
    if (user.blockedAt) throw new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, 'Учётная запись заблокирована');

    const hasStaffRole =
      user.isSuperadmin ||
      (await this.prisma.userOrganizationRole.count({ where: { userId: user.id, revokedAt: null } })) > 0;
    if (!hasStaffRole) throw invalid();

    let mfaVerified = false;
    if (user.isSuperadmin) {
      if (!user.mfaEnabled || !user.mfaSecretEnc) {
        throw new AppError('MFA_REQUIRED', HttpStatus.FORBIDDEN, 'Для суперадминистратора не настроена MFA. Используйте скрипт superadmin:create.');
      }
      if (!input.totpCode) return { mfaRequired: true };
      await this.rateLimit.consume(`mfa:user:${user.id}`, 10, 900);
      if (!this.mfa.verify(user.mfaSecretEnc, input.totpCode)) {
        throw new AppError('MFA_INVALID', HttpStatus.UNAUTHORIZED, 'Неверный код подтверждения');
      }
      mfaVerified = true;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.sessions.create(user.id, 'staff', mfaVerified, req, res);
    await this.audit.log(
      { userId: user.id, actorType: user.isSuperadmin ? 'superadmin' : 'user', ip, userAgent: req.headers['user-agent'] ?? null },
      'auth.login',
      'user',
      user.id,
    );
    return { user: await this.profile(user.id) };
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string, actor: ActorContext): Promise<void> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await this.passwords.verify(u.passwordHash, currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', HttpStatus.BAD_REQUEST, 'Текущий пароль неверен');
    }
    if (currentPassword === newPassword) throw AppError.badRequest('VALIDATION_ERROR', 'Новый пароль совпадает с текущим');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(newPassword), mustChangePassword: false },
    });
    await this.sessions.revokeAllForUser(user.id, user.sessionId);
    await this.audit.log(actor, 'auth.password_changed', 'user', user.id);
  }

  async clientRequestOtp(phone: string, req: Request): Promise<{ expiresInSec: number }> {
    const ip = clientIp(req);
    await this.otp.assertCanSend(phone, 'login', ip);
    const result = await this.prisma.$transaction(async (tx) => {
      const issued = await this.otp.issue(tx, { phone, purpose: 'login', ip });
      await this.notifications.enqueue(tx, {
        organizationId: null,
        type: 'otp',
        eventKey: `otp:${issued.otpId}`,
        recipient: phone,
        locale: 'ru',
        params: { code: issued.code, minutes: String(Math.round((issued.expiresAt.getTime() - Date.now()) / 60000)) },
        sensitive: true,
        expiresAt: issued.expiresAt,
      });
      return issued;
    });
    return { expiresInSec: Math.round((result.expiresAt.getTime() - Date.now()) / 1000) };
  }

  async clientVerifyOtp(input: { phone: string; code: string; name?: string }, req: Request, res: Response) {
    await this.rateLimit.consume(`otp-verify:ip:${clientIp(req)}`, 60, 3600);
    await this.otp.verify({ phone: input.phone, purpose: 'login', code: input.code });
    const user = await this.loginOrRegisterByVerifiedPhone(input.phone, input.name);
    await this.sessions.create(user.id, 'client', false, req, res);
    return { user: await this.profile(user.id) };
  }

  /** Вход/регистрация по подтверждённому номеру и привязка гостевых записей (§10, §11). */
  async loginOrRegisterByVerifiedPhone(phone: string, name?: string) {
    const now = new Date();
    const user = await this.prisma.user.upsert({
      where: { phone },
      create: { phone, name: name ?? 'Клиент', phoneVerifiedAt: now },
      update: { phoneVerifiedAt: now },
    });
    if (user.blockedAt) throw new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, 'Учётная запись заблокирована');
    await this.prisma.client.updateMany({ where: { phone, userId: null }, data: { userId: user.id } });
    return user;
  }

  async profile(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        orgRoles: {
          where: { revokedAt: null, organization: { archivedAt: null } },
          include: { organization: { select: { id: true, name: true } } },
        },
        branchAccess: { include: { permissions: true, branch: { select: { id: true, name: true, archivedAt: true } } } },
      },
    });
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      locale: u.locale,
      isSuperadmin: u.isSuperadmin,
      mustChangePassword: u.mustChangePassword,
      memberships: u.orgRoles.map((r) => ({
        organizationId: r.organizationId,
        organizationName: r.organization.name,
        role: r.roleCode,
        branches:
          r.roleCode === 'OWNER'
            ? null
            : u.branchAccess
                .filter((a) => a.organizationId === r.organizationId && !a.branch.archivedAt)
                .map((a) => ({ branchId: a.branchId, branchName: a.branch.name, permissions: a.permissions.map((p) => p.permissionCode) })),
      })),
    };
  }
}
