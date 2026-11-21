import { Injectable } from '@nestjs/common';
import type { NotificationChannel } from '@booking/shared';
import { PrismaService } from '../common/prisma.service';
import { getConfig } from '../config/config';

export interface OutgoingMessage {
  recipient: string; // E.164
  type: string;
  locale: string;
  params: Record<string, string>;
  /** Отрендеренный текст (SMS / dev_inbox). */
  text: string;
  /** Имя одобренного шаблона Meta и порядок параметров. */
  providerTemplateName: string | null;
  templateVariables: string[];
  category: string;
}

export class ChannelError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
  }
}

export interface ChannelAdapter {
  readonly channel: NotificationChannel;
  isConfigured(): boolean;
  send(msg: OutgoingMessage): Promise<{ providerMessageId: string }>;
}

/** Сетевой вызов с таймаутом; сетевые ошибки — повторяемые. */
async function http(url: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    throw new ChannelError(`Network error: ${(e as Error).message}`, true, 'NETWORK');
  } finally {
    clearTimeout(t);
  }
}

/**
 * WhatsApp Business Platform — официальный Cloud API Meta (§15).
 * Сообщения по инициативе бизнеса — только одобренные шаблоны. Обычный текст — только ответ клиенту
 * в 24-часовом окне после его сообщения (категория SERVICE, D-32).
 */
@Injectable()
export class WhatsAppChannel implements ChannelAdapter {
  readonly channel = 'whatsapp' as const;

  isConfigured(): boolean {
    const c = getConfig();
    return !!(c.WHATSAPP_PHONE_NUMBER_ID && c.WHATSAPP_ACCESS_TOKEN);
  }

  /** Неповторяемые коды ошибок Cloud API (неверный номер, шаблон, окно общения, токен). */
  private static readonly PERMANENT_CODES = new Set([100, 131008, 131009, 131021, 131026, 131047, 131051, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 190, 10, 200]);

  buildPayload(msg: OutgoingMessage) {
    if (msg.category === 'SERVICE' && !msg.providerTemplateName) {
      // Ответ клиенту в 24-часовом окне после его сообщения (D-32): обычный текст без шаблона.
      // Вне окна Meta отклонит сообщение (131047) — ошибка неповторяемая.
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: msg.recipient.replace(/^\+/, ''),
        type: 'text',
        text: { preview_url: false, body: msg.text.slice(0, 4096) },
      };
    }
    if (!msg.providerTemplateName) throw new ChannelError('Шаблон WhatsApp не задан', false, 'NO_TEMPLATE');
    const bodyParams = msg.templateVariables.map((v) => ({ type: 'text', text: msg.params[v] ?? '' }));
    const components: unknown[] = [{ type: 'body', parameters: bodyParams }];
    if (msg.category === 'AUTHENTICATION') {
      // Для шаблонов аутентификации Meta требует параметр кнопки «Копировать код».
      components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: msg.params.code ?? '' }] });
    }
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: msg.recipient.replace(/^\+/, ''),
      type: 'template',
      template: { name: msg.providerTemplateName, language: { code: msg.locale }, components },
    };
  }

  async send(msg: OutgoingMessage): Promise<{ providerMessageId: string }> {
    if (!this.isConfigured()) throw new ChannelError('WhatsApp не настроен', false, 'NOT_CONFIGURED');
    const c = getConfig();
    const res = await http(`${c.WHATSAPP_API_BASE_URL}/${c.WHATSAPP_API_VERSION}/${c.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(this.buildPayload(msg)),
    });
    const body = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { code?: number; message?: string; error_subcode?: number };
    };
    if (res.ok && body.messages?.[0]?.id) return { providerMessageId: body.messages[0].id };
    const code = body.error?.code ?? 0;
    const retryable = res.status >= 500 || res.status === 429 || code === 130429 || code === 131000 || code === 131016 || code === 4 || code === 80007;
    const permanent = WhatsAppChannel.PERMANENT_CODES.has(code);
    throw new ChannelError(
      `WhatsApp API ${res.status}: ${body.error?.message ?? 'unknown error'}`,
      retryable && !permanent,
      `WA_${code || res.status}`,
      res.status,
    );
  }
}

/** SMS — отдельный подключаемый канал (§16). Адаптер Mobizon (Казахстан). */
@Injectable()
export class SmsChannel implements ChannelAdapter {
  readonly channel = 'sms' as const;

  isConfigured(): boolean {
    return !!getConfig().SMS_API_KEY;
  }

  async send(msg: OutgoingMessage): Promise<{ providerMessageId: string }> {
    const c = getConfig();
    if (!this.isConfigured()) throw new ChannelError('SMS не настроен', false, 'NOT_CONFIGURED');
    if (c.SMS_PROVIDER !== 'mobizon') throw new ChannelError(`Неизвестный SMS-провайдер ${c.SMS_PROVIDER}`, false, 'UNKNOWN_PROVIDER');
    const form = new URLSearchParams({ recipient: msg.recipient.replace(/^\+/, ''), text: msg.text });
    if (c.SMS_SENDER) form.set('from', c.SMS_SENDER);
    const url = `${c.SMS_API_BASE_URL}/service/message/sendsmsmessage?output=json&api=v1&apiKey=${encodeURIComponent(c.SMS_API_KEY)}`;
    const res = await http(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: { messageId?: string | number } };
    if (res.ok && body.code === 0 && body.data?.messageId !== undefined) return { providerMessageId: String(body.data.messageId) };
    const retryable = res.status >= 500 || res.status === 429;
    throw new ChannelError(`SMS API ${res.status}: ${body.message ?? 'error'}`, retryable, `SMS_${body.code ?? res.status}`, res.status);
  }
}

/** Канал тестовой среды: сообщения сохраняются в БД (получение OTP в тестах, §26.3). Запрещён в production. */
@Injectable()
export class DevInboxChannel implements ChannelAdapter {
  readonly channel = 'dev_inbox' as const;
  constructor(private readonly prisma: PrismaService) {}

  isConfigured(): boolean {
    return getConfig().APP_ENV !== 'production';
  }

  async send(msg: OutgoingMessage): Promise<{ providerMessageId: string }> {
    if (!this.isConfigured()) throw new ChannelError('dev_inbox запрещён в production', false, 'FORBIDDEN');
    const row = await this.prisma.devInboxMessage.create({ data: { recipient: msg.recipient, type: msg.type, text: msg.text } });
    return { providerMessageId: `dev-${row.id}` };
  }
}
