'use client';

import { api, type ApiOptions } from '@/lib/api';
import type { ApiPath } from '@/lib/api-path';

/**
 * Критическое действие суперадмина: запрашивает TOTP-код и передаёт его в X-MFA-Code (§22).
 * Код запрашивается заново для каждого действия и нигде не сохраняется: API принимает каждый код один раз
 * (повтор → 403 MFA_INVALID «Код уже использован…», превышение попыток → 429) — сообщение API показывает вызывающий.
 */
export async function withMfa<T>(path: ApiPath, opts: ApiOptions, promptText = 'Код MFA из приложения-аутентификатора (для каждого действия — новый код)'): Promise<T | undefined> {
  // приложения показывают код как «123 456» — пробелы убираем, чтобы не тратить попытку на неверный формат
  const code = window.prompt(promptText)?.replace(/\s+/g, '');
  if (!code) return undefined;
  if (!/^\d{6}$/.test(code)) throw new Error('Код MFA — 6 цифр из приложения-аутентификатора');
  return api<T>(path, { ...opts, headers: { ...(opts.headers ?? {}), 'X-MFA-Code': code } });
}
