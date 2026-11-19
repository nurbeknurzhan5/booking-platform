import type { Request } from 'express';
import type { AccessGrant, SubscriptionStatus } from '@booking/shared';

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isSuperadmin: boolean;
  mustChangePassword: boolean;
  locale: string;
  sessionId: string;
  sessionKind: 'staff' | 'client';
  mfaVerified: boolean;
}

export interface TenantContext {
  organizationId: string;
  role: 'OWNER' | 'BRANCH_ADMIN' | 'SUPERADMIN';
  grant: AccessGrant;
  subscriptionStatus: SubscriptionStatus;
  isSuperadmin: boolean;
}

export interface AppRequest extends Request {
  user?: AuthUser;
  tenant?: TenantContext;
  requestId?: string;
}

/** Контекст действующего лица для аудита и истории. */
export interface ActorContext {
  userId: string | null;
  actorType: 'user' | 'superadmin' | 'client' | 'system';
  ip: string | null;
  userAgent: string | null;
  organizationId?: string | null;
}

export function clientIp(req: Request): string {
  return (req.ip ?? req.socket?.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
}

export function actorFromRequest(req: AppRequest): ActorContext {
  const u = req.user;
  return {
    userId: u?.id ?? null,
    actorType: u ? (u.isSuperadmin ? 'superadmin' : u.sessionKind === 'client' ? 'client' : 'user') : 'client',
    ip: clientIp(req),
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 500) || null,
    organizationId: req.tenant?.organizationId ?? null,
  };
}

export const SYSTEM_ACTOR: ActorContext = { userId: null, actorType: 'system', ip: null, userAgent: null };
