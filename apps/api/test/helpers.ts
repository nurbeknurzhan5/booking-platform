import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { seedReferenceData } from '../src/seed/reference-data';
import { encrypt } from '../src/common/crypto';
import { getConfig } from '../src/config/config';
import { SystemSettingsService } from '../src/common/system-settings.service';

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
  close: () => Promise<void>;
}

export async function bootstrapTestApp(): Promise<TestContext> {
  const app = await createApp();
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, close: () => app.close() };
}

/** Полная очистка тестовой БД (TRUNCATE не вызывает append-only триггеры) и загрузка справочников. */
export async function resetDb(ctx: TestContext): Promise<void> {
  const tables = await ctx.prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await ctx.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  await seedReferenceData(ctx.prisma);
  ctx.app.get(SystemSettingsService).invalidate();
}

/** HTTP-клиент с cookie-сессией и автоматическим CSRF-заголовком. */
export class Http {
  private agent: ReturnType<typeof request.agent>;
  csrf = '';
  mfaCode?: string;
  ip: string;

  constructor(app: NestExpressApplication, ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {
    this.agent = request.agent(app.getHttpServer());
    this.ip = ip;
  }

  private capture(res: request.Response): request.Response {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    for (const c of raw ?? []) {
      const m = /^bk_csrf=([^;]*)/.exec(c);
      if (m) this.csrf = decodeURIComponent(m[1]!);
    }
    return res;
  }

  private decorate(req: request.Test, headers: Record<string, string> = {}): request.Test {
    req.set('X-Forwarded-For', this.ip);
    if (this.csrf) req.set('X-CSRF-Token', this.csrf);
    if (this.mfaCode) req.set('X-MFA-Code', this.mfaCode);
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req;
  }

  async get(url: string, headers?: Record<string, string>) {
    return this.capture(await this.decorate(this.agent.get(url), headers));
  }
  async post(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.capture(await this.decorate(this.agent.post(url), headers).send(body as object));
  }
  async put(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.capture(await this.decorate(this.agent.put(url), headers).send(body as object));
  }
  async patch(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.capture(await this.decorate(this.agent.patch(url), headers).send(body as object));
  }
  async delete(url: string, headers?: Record<string, string>) {
    return this.capture(await this.decorate(this.agent.delete(url), headers));
  }
  raw() {
    return this.agent;
  }
}

export const API = '/api/v1';

export async function createSuperadmin(ctx: TestContext, email = 'root@platform.kz', password = 'SuperSecret123!') {
  const secret = authenticator.generateSecret(20);
  const user = await ctx.prisma.user.create({
    data: {
      email,
      name: 'Root',
      isSuperadmin: true,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      mfaSecretEnc: encrypt(getConfig().ENCRYPTION_KEY, secret),
      mfaEnabled: true,
    },
  });
  return { user, email, password, secret, totp: () => authenticator.generate(secret) };
}

export async function loginSuperadmin(ctx: TestContext, sa: Awaited<ReturnType<typeof createSuperadmin>>): Promise<Http> {
  const http = new Http(ctx.app);
  const res = await http.post(`${API}/auth/staff/login`, { email: sa.email, password: sa.password, totpCode: sa.totp() });
  if (res.status !== 200) throw new Error(`superadmin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  http.mfaCode = sa.totp();
  return http;
}

export async function loginStaff(ctx: TestContext, email: string, password: string, newPassword?: string): Promise<Http> {
  const http = new Http(ctx.app);
  const res = await http.post(`${API}/auth/staff/login`, { email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  if (res.body.user?.mustChangePassword) {
    const np = newPassword ?? `${password}X1`;
    const ch = await http.post(`${API}/auth/staff/change-password`, { currentPassword: password, newPassword: np });
    if (ch.status !== 204) throw new Error(`change password failed: ${ch.status} ${JSON.stringify(ch.body)}`);
  }
  return http;
}

/** Создаёт организацию с владельцем и активной подпиской через API суперадмина. */
export async function createOrgWithOwner(
  ctx: TestContext,
  admin: Http,
  opts: { name?: string; maxBranches?: number; startsAt?: Date; endsAt?: Date; graceDays?: number } = {},
) {
  const plan = await ctx.prisma.plan.findUniqueOrThrow({ where: { code: 'business' } });
  const ownerEmail = `owner-${randomUUID().slice(0, 8)}@test.kz`;
  const ownerPassword = 'OwnerPass123!';
  const res = await admin.post(`${API}/admin/organizations`, {
    name: opts.name ?? 'Салон Тест',
    businessCategory: 'beauty_salon',
    owner: { email: ownerEmail, name: 'Владелец', temporaryPassword: ownerPassword },
    subscription: {
      planId: plan.id,
      maxBranches: opts.maxBranches ?? 3,
      startsAt: (opts.startsAt ?? new Date(Date.now() - 24 * 3600_000)).toISOString(),
      endsAt: (opts.endsAt ?? new Date(Date.now() + 30 * 24 * 3600_000)).toISOString(),
      graceDays: opts.graceDays ?? 7,
    },
  });
  if (res.status !== 201) throw new Error(`create org failed: ${res.status} ${JSON.stringify(res.body)}`);
  const owner = await loginStaff(ctx, ownerEmail, ownerPassword);
  return { orgId: res.body.id as string, owner, ownerEmail };
}

/** Последнее сообщение dev_inbox для номера (тестовая среда, §26.3). */
export async function lastDevMessage(ctx: TestContext, phone: string, type?: string) {
  return ctx.prisma.devInboxMessage.findFirst({
    where: { recipient: phone, ...(type ? { type } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

export function otpFromText(text: string): string {
  const m = /(\d{6})/.exec(text);
  if (!m) throw new Error('OTP not found in message');
  return m[1]!;
}
