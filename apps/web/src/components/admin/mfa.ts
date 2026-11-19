'use client';

import { api, type ApiOptions } from '@/lib/api';

/** Критическое действие суперадмина: запрашивает TOTP-код и передаёт его в X-MFA-Code (§22). */
export async function withMfa<T>(path: string, opts: ApiOptions, promptText = 'Код MFA из приложения-аутентификатора'): Promise<T | undefined> {
  const code = window.prompt(promptText)?.trim();
  if (!code) return undefined;
  return api<T>(path, { ...opts, headers: { ...(opts.headers ?? {}), 'X-MFA-Code': code } });
}
