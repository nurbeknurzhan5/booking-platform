// Используется только в серверных компонентах (SSR).
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export interface ServerResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: { code: string; message: string; details?: { reason?: string } };
}

/** Запрос к API из серверного компонента (SSR публичных страниц). */
export async function serverGet<T>(path: string, init: { revalidate?: number; headers?: Record<string, string> } = {}): Promise<ServerResult<T>> {
  try {
    const res = await fetch(`${API}/api/v1${path}`, {
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
      ...(init.revalidate !== undefined ? { next: { revalidate: init.revalidate } } : { cache: 'no-store' as const }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, data: null, error: body?.error };
    return { ok: true, status: res.status, data: body as T };
  } catch {
    return { ok: false, status: 503, data: null, error: { code: 'UNAVAILABLE', message: 'API unavailable' } };
  }
}
