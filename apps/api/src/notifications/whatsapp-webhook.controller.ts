import { Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public, RateLimit } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { getConfig } from '../config/config';
import { AppError } from '../common/errors';

interface WaStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string }>;
}

export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Webhook WhatsApp Cloud API: подтверждение подписки и статусы доставки (§15.2). */
@ApiExcludeController()
@Public()
@Controller('integrations/whatsapp/webhook')
export class WhatsAppWebhookController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    const expected = getConfig().WHATSAPP_VERIFY_TOKEN;
    if (mode === 'subscribe' && expected && token === expected) {
      res.status(200).type('text/plain').send(String(challenge ?? '').slice(0, 200));
      return;
    }
    res.status(403).send('forbidden');
  }

  @Post()
  @HttpCode(200)
  @RateLimit({ name: 'wa-webhook', limit: 3000, windowSec: 60, by: 'ip' })
  async receive(@Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody;
    if (!raw || !verifyMetaSignature(raw, req.headers['x-hub-signature-256'] as string | undefined, getConfig().WHATSAPP_APP_SECRET)) {
      throw AppError.forbidden('Invalid signature');
    }
    const body = req.body as { entry?: Array<{ changes?: Array<{ value?: { statuses?: WaStatus[] } }> }> };
    const statuses = (body.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.statuses ?? []));
    for (const s of statuses) await this.applyStatus(s);
    return { received: statuses.length };
  }

  /** Идемпотентно: уникальная пара (message id, status); повторная доставка webhook ничего не дублирует. */
  async applyStatus(s: WaStatus): Promise<void> {
    if (!s.id || !s.status) return;
    const outbox = await this.prisma.notificationOutbox.findFirst({ where: { providerMessageId: s.id }, select: { id: true, status: true } });
    const occurredAt = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
    const created = await this.prisma.whatsappMessageStatus
      .create({
        data: {
          outboxId: outbox?.id ?? null,
          providerMessageId: s.id,
          status: s.status,
          errorCode: s.errors?.[0]?.code !== undefined ? String(s.errors[0].code) : null,
          errorTitle: s.errors?.[0]?.title?.slice(0, 300) ?? null,
          occurredAt,
          raw: { id: s.id, status: s.status, timestamp: s.timestamp ?? null, errors: s.errors ?? [] },
        },
      })
      .then(() => true)
      .catch(() => false);
    if (!created || !outbox) return;
    if (s.status === 'delivered') {
      await this.prisma.notificationOutbox.updateMany({ where: { id: outbox.id, status: { in: ['sent'] } }, data: { status: 'delivered', deliveredAt: occurredAt } });
    } else if (s.status === 'read') {
      await this.prisma.notificationOutbox.updateMany({ where: { id: outbox.id, status: { in: ['sent', 'delivered'] } }, data: { status: 'read', readAt: occurredAt } });
    } else if (s.status === 'failed') {
      await this.prisma.notificationOutbox.updateMany({
        where: { id: outbox.id },
        data: { status: 'dead', lastError: `WA delivery failed: ${s.errors?.[0]?.code ?? ''} ${s.errors?.[0]?.title ?? ''}`.slice(0, 1000) },
      });
    }
  }
}
