import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@booking/shared';
import { actorFromRequest, type ActorContext, type AppRequest, type AuthUser, type TenantContext } from './request-context';

export const ACCESS_KEY = 'access_mode';
/**
 * public — без входа; client — любой вошедший пользователь; client-session — только сессия клиента (вход по коду
 * на телефон, номер подтверждён); staff — сотрудник (по умолчанию); superadmin.
 */
export type AccessMode = 'public' | 'client' | 'client-session' | 'staff' | 'superadmin';

export const Public = () => SetMetadata(ACCESS_KEY, 'public' satisfies AccessMode);
export const ClientAccess = () => SetMetadata(ACCESS_KEY, 'client' satisfies AccessMode);
/** Данные клиента по номеру телефона: парольная сессия сотрудника сюда не допускается. */
export const ClientSessionOnly = () => SetMetadata(ACCESS_KEY, 'client-session' satisfies AccessMode);
export const SuperadminOnly = () => SetMetadata(ACCESS_KEY, 'superadmin' satisfies AccessMode);

/** Разрешить маршрут сотруднику, которому нужно сменить временный пароль. */
export const ALLOW_PASSWORD_CHANGE_PENDING = 'allow_pwd_pending';
export const AllowPasswordChangePending = () => SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING, true);

export const PERMISSION_KEY = 'required_permission';
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);
/** Доступно любому сотруднику организации (данные затем фильтруются по его филиалам). */
export const ANY_MEMBER = '*';
export const AnyMember = () => SetMetadata(PERMISSION_KEY, ANY_MEMBER);

/** Разрешить изменяющий запрос при неактивной подписке (например, просмотр через POST-поиск). */
export const ALLOW_INACTIVE_SUBSCRIPTION = 'allow_inactive_sub';
export const AllowInactiveSubscription = () => SetMetadata(ALLOW_INACTIVE_SUBSCRIPTION, true);

/** Критическое действие суперадмина: требует повторный TOTP-код в заголовке X-MFA-Code (§22). */
export const STEP_UP_KEY = 'step_up_mfa';
export const RequireStepUp = () => SetMetadata(STEP_UP_KEY, true);

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSec: number;
  by: 'ip' | 'user' | 'ip+route';
}
export const RATE_LIMIT_KEY = 'rate_limit';
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT_KEY, rules);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest<AppRequest>().user;
});

export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const t = ctx.switchToHttp().getRequest<AppRequest>().tenant;
  if (!t) throw new Error('Tenant context missing: route must include :orgId');
  return t;
});

export const Actor = createParamDecorator((_: unknown, ctx: ExecutionContext): ActorContext => {
  return actorFromRequest(ctx.switchToHttp().getRequest<AppRequest>());
});
