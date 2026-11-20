import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  computeSubscriptionStatus,
  hasPermission,
  isBranchPermission,
  isManagementAllowed,
  type AccessGrant,
  type Permission,
} from '@booking/shared';
import { PrismaService } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { SessionService, SESSION_COOKIE, CSRF_COOKIE } from './session.service';
import { MfaService } from './password.service';
import { RateLimitService } from '../common/rate-limit.service';
import {
  ACCESS_KEY,
  ANY_MEMBER,
  ALLOW_INACTIVE_SUBSCRIPTION,
  ALLOW_PASSWORD_CHANGE_PENDING,
  PERMISSION_KEY,
  RATE_LIMIT_KEY,
  STEP_UP_KEY,
  type AccessMode,
  type RateLimitRule,
} from '../common/decorators';
import { clientIp, type AppRequest } from '../common/request-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function accessMode(reflector: Reflector, ctx: ExecutionContext): AccessMode {
  return reflector.getAllAndOverride<AccessMode>(ACCESS_KEY, [ctx.getHandler(), ctx.getClass()]) ?? 'staff';
}

/** 1. Аутентификация: по умолчанию маршрут доступен только сотрудникам (secure by default). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (token) req.user = (await this.sessions.resolve(token)) ?? undefined;

    const mode = accessMode(this.reflector, ctx);
    if (mode === 'public') return true;
    const user = req.user;
    if (!user) throw AppError.unauthenticated();
    if (mode === 'client') return true;

    if (user.sessionKind !== 'staff') throw AppError.forbidden('Требуется вход сотрудника');
    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_PENDING, [ctx.getHandler(), ctx.getClass()]);
    if (user.mustChangePassword && !allowPending) {
      throw new AppError('PASSWORD_CHANGE_REQUIRED', HttpStatus.FORBIDDEN, 'Необходимо сменить временный пароль');
    }
    if (mode === 'superadmin') {
      if (!user.isSuperadmin) throw AppError.notFound('Маршрут');
      if (!user.mfaVerified) throw new AppError('MFA_REQUIRED', HttpStatus.FORBIDDEN, 'Требуется MFA');
    }
    const stepUp = this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (stepUp) {
      const code = req.headers['x-mfa-code'];
      if (typeof code !== 'string' || !code) {
        throw new AppError('MFA_REQUIRED', HttpStatus.FORBIDDEN, 'Подтвердите действие кодом MFA (заголовок X-MFA-Code)');
      }
      const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { mfaSecretEnc: true } });
      if (!this.mfa.verify(u.mfaSecretEnc, code)) throw new AppError('MFA_INVALID', HttpStatus.FORBIDDEN, 'Неверный код MFA');
    }
    return true;
  }
}

/** 2. CSRF: double-submit cookie для изменяющих запросов с cookie-сессией. */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    const cookies = (req.cookies ?? {}) as Record<string, string>;
    if (!cookies[SESSION_COOKIE]) return true;
    const header = req.headers['x-csrf-token'];
    if (typeof header !== 'string' || !cookies[CSRF_COOKIE] || header !== cookies[CSRF_COOKIE]) {
      throw new AppError('CSRF_INVALID', HttpStatus.FORBIDDEN, 'Недействительный CSRF-токен');
    }
    return true;
  }
}

/** 3. Rate limit: правила из @RateLimit, по умолчанию — для публичных и авторизованных маршрутов. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const route = `${req.method}:${(req.route as { path?: string } | undefined)?.path ?? req.path}`;
    const ip = clientIp(req);
    const rules = this.reflector.getAllAndOverride<RateLimitRule[]>(RATE_LIMIT_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    // Явные правила маршрута заменяют правило по умолчанию (одна запись счётчика на запрос).
    const defaults: RateLimitRule[] = rules.length
      ? []
      : req.user
        ? [{ name: 'default-user', limit: 1200, windowSec: 60, by: 'user' }]
        : [{ name: 'default-ip', limit: 300, windowSec: 60, by: 'ip+route' }];
    for (const r of [...rules, ...defaults]) {
      const subject = r.by === 'user' ? `u:${req.user?.id ?? ip}` : r.by === 'ip' ? `ip:${ip}` : `ip:${ip}:${route}`;
      await this.rateLimit.consume(`rl:${r.name}:${subject}`, r.limit, r.windowSec);
    }
    return true;
  }
}

/**
 * 4. Tenant context: для маршрутов с :orgId проверяет членство и права на филиал.
 * Чужая организация или филиал → 404 (не раскрываем существование).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const orgId = (req.params as Record<string, string> | undefined)?.orgId;
    if (!orgId) return true;
    const user = req.user;
    if (!user || user.sessionKind !== 'staff') throw AppError.unauthenticated();
    if (!UUID_RE.test(orgId)) throw AppError.notFound('Организация');

    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, archivedAt: null },
      select: { id: true, subscription: { select: { suspended: true, startsAt: true, endsAt: true, graceDays: true } } },
    });
    if (!org) throw AppError.notFound('Организация');
    const subscriptionStatus = computeSubscriptionStatus(org.subscription ?? null, new Date());

    let grant: AccessGrant;
    let role: 'OWNER' | 'BRANCH_ADMIN' | 'SUPERADMIN';
    if (user.isSuperadmin && user.mfaVerified) {
      grant = { role: 'OWNER', branchPermissions: {} };
      role = 'SUPERADMIN';
    } else {
      const membership = await this.prisma.userOrganizationRole.findFirst({
        where: { userId: user.id, organizationId: orgId, revokedAt: null },
      });
      if (!membership) throw AppError.notFound('Организация');
      if (membership.roleCode === 'OWNER') {
        grant = { role: 'OWNER', branchPermissions: {} };
        role = 'OWNER';
      } else {
        const access = await this.prisma.userBranchAccess.findMany({
          where: { userId: user.id, organizationId: orgId, branch: { archivedAt: null } },
          include: { permissions: true },
        });
        grant = {
          role: 'BRANCH_ADMIN',
          branchPermissions: Object.fromEntries(access.map((a) => [a.branchId, a.permissions.map((p) => p.permissionCode)])),
        };
        role = 'BRANCH_ADMIN';
      }
    }

    const branchId = (req.params as Record<string, string>).branchId;
    if (branchId) {
      if (!UUID_RE.test(branchId)) throw AppError.notFound('Филиал');
      const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId: orgId, archivedAt: null }, select: { id: true } });
      if (!branch) throw AppError.notFound('Филиал');
      if (grant.role === 'BRANCH_ADMIN' && !(branchId in grant.branchPermissions)) throw AppError.notFound('Филиал');
    }

    req.tenant = { organizationId: orgId, role, grant, subscriptionStatus, isSuperadmin: role === 'SUPERADMIN' };
    return true;
  }
}

/** 5. RBAC: на маршрутах организации без @RequirePermission доступ есть только у владельца. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const tenant = req.tenant;
    if (!tenant) return true;
    const permission = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!permission) {
      if (tenant.grant.role !== 'OWNER') throw AppError.forbidden();
      return true;
    }
    if ((permission as string) === ANY_MEMBER) return true;
    const branchId =
      (req.params as Record<string, string>).branchId ??
      (typeof (req.query as Record<string, unknown>)?.branchId === 'string' ? ((req.query as Record<string, string>).branchId) : undefined) ??
      (typeof (req.body as Record<string, unknown> | undefined)?.branchId === 'string' ? ((req.body as Record<string, string>).branchId) : undefined);
    const ok = isBranchPermission(permission) && branchId
      ? hasPermission(tenant.grant, permission, branchId)
      : hasPermission(tenant.grant, permission);
    if (!ok) throw AppError.forbidden();
    return true;
  }
}

/** 6. Подписка: при expired/suspended изменения запрещены (D-12); суперадмин не ограничен. */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const tenant = req.tenant;
    if (!tenant || tenant.isSuperadmin || SAFE_METHODS.has(req.method)) return true;
    const allow = this.reflector.getAllAndOverride<boolean>(ALLOW_INACTIVE_SUBSCRIPTION, [ctx.getHandler(), ctx.getClass()]);
    if (allow || isManagementAllowed(tenant.subscriptionStatus)) return true;
    throw new AppError(
      'SUBSCRIPTION_INACTIVE',
      HttpStatus.FORBIDDEN,
      'Подписка неактивна. Изменения недоступны до продления подписки.',
      { subscriptionStatus: tenant.subscriptionStatus },
    );
  }
}
