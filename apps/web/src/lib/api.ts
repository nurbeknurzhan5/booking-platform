'use client';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}

async function ensureCsrf(): Promise<string> {
  let token = getCookie('bk_csrf');
  if (!token) {
    const r = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
    token = ((await r.json()) as { csrfToken: string }).csrfToken;
  }
  return token;
}

export function newIdempotencyKey(): string {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, '');
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

/** Запрос к API (через прокси Next.js, cookie-сессия, CSRF double-submit). */
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = await ensureCsrf();
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  }
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'INTERNAL_ERROR', data?.error?.message ?? `HTTP ${res.status}`, data?.error?.details);
  }
  return data as T;
}

export async function uploadFile(path: string, file: File, kind: string): Promise<{ id: string; urls: Record<string, string> }> {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', file);
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': await ensureCsrf() },
    body: fd,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'FILE_INVALID', data?.error?.message ?? 'Ошибка загрузки');
  return data;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details as Array<{ path: string; message: string }> | undefined;
    if (e.code === 'VALIDATION_ERROR' && Array.isArray(d) && d.length) return d.map((x) => `${x.path}: ${x.message}`).join('; ');
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
