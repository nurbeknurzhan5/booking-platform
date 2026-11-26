import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { randomToken, sha256 } from '../common/crypto';
import { getConfig } from '../config/config';
import { clientIp, type AuthUser } from '../common/request-context';

export const SESSION_COOKIE = 'bk_sid';
export const CSRF_COOKIE = 'bk_csrf';

const POLICY = {
  staff: { idleMs: 12 * 3600_000, absoluteMs: 7 * 24 * 3600_000 },
  client: { idleMs: 30 * 24 * 3600_000, absoluteMs: 90 * 24 * 3600_000 },
} as const;
const TOUCH_INTERVAL_MS = 5 * 60_000;

/**
 * Сессии: случайный токен в HttpOnly-cookie, в БД хранится только SHA-256 (§22).
 * Скользящее продление до абсолютного предела.
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    kind: 'staff' | 'client',
    mfaVerified: boolean,
    req: Request,
    res: Response,
  ): Promise<void> {
    // Ротация: прежняя сессия из cookie этого браузера отзывается (повторный вход, смена учётной записи,
    // навязанная cookie — session fixation), иначе её токен оставался бы действительным.
    const previous = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (previous && previous.length <= 100) {
      await this.prisma.userSession.updateMany({ where: { tokenHash: sha256(previous), revokedAt: null }, data: { revokedAt: new Date() } });
    }
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + POLICY[kind].idleMs);
    await this.prisma.userSession.create({
      data: {
        userId,
        tokenHash: sha256(token),
        kind,
        mfaVerified,
        ip: clientIp(req),
        userAgent: (req.headers['user-agent'] ?? '').slice(0, 500),
        expiresAt,
      },
    });
    this.setCookies(res, token, new Date(Date.now() + POLICY[kind].absoluteMs));
  }

  async resolve(token: string): Promise<AuthUser | null> {
    if (!token || token.length > 100) return null;
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.user.blockedAt) return null;
    const now = Date.now();
    const kind = session.kind === 'client' ? 'client' : 'staff';
    if (session.expiresAt.getTime() <= now) return null;
    if (session.createdAt.getTime() + POLICY[kind].absoluteMs <= now) return null;

    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const cap = session.createdAt.getTime() + POLICY[kind].absoluteMs;
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now), expiresAt: new Date(Math.min(now + POLICY[kind].idleMs, cap)) },
      });
    }
    const u = session.user;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      isSuperadmin: u.isSuperadmin,
      mustChangePassword: u.mustChangePassword,
      locale: u.locale,
      sessionId: session.id,
      sessionKind: kind,
      mfaVerified: session.mfaVerified,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  setCookies(res: Response, token: string, expires: Date): void {
    const secure = getConfig().COOKIE_SECURE;
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', expires });
    this.issueCsrf(res);
  }

  issueCsrf(res: Response): string {
    const csrf = randomToken(24);
    res.cookie(CSRF_COOKIE, csrf, { httpOnly: false, secure: getConfig().COOKIE_SECURE, sameSite: 'lax', path: '/' });
    return csrf;
  }

  clearCookies(res: Response): void {
    const secure = getConfig().COOKIE_SECURE;
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure, sameSite: 'lax', path: '/' });
    res.clearCookie(CSRF_COOKIE, { secure, sameSite: 'lax', path: '/' });
  }

  async cleanupExpired(): Promise<number> {
    const r = await this.prisma.userSession.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date(Date.now() - 24 * 3600_000) } }, { revokedAt: { lt: new Date(Date.now() - 7 * 24 * 3600_000) } }] },
    });
    return r.count;
  }
}
