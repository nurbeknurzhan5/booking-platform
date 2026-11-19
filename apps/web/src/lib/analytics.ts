'use client';

/**
 * Аналитика публичной страницы (§17) без cookies: UTM и идентификатор сессии в sessionStorage
 * (окно 30 минут бездействия), атрибуция записи — last-touch в пределах сессии (решение D-20).
 */
const SESSION_KEY = 'bk_a_session';
const UTM_KEY = 'bk_a_utm';
const SESSION_TTL_MS = 30 * 60_000;

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export function analyticsSession(): string {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const now = Date.now();
    if (raw) {
      const s = JSON.parse(raw) as { id: string; at: number };
      if (now - s.at < SESSION_TTL_MS) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: s.id, at: now }));
        return s.id;
      }
    }
    const id = (crypto.randomUUID?.() ?? String(now)).replace(/-/g, '').slice(0, 32);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, at: now }));
    return id;
  } catch {
    return '';
  }
}

/** UTM из URL (если есть) перезаписывают сохранённые — last-touch. */
export function captureUtm(search: URLSearchParams): Utm | undefined {
  const keys = ['source', 'medium', 'campaign', 'term', 'content'] as const;
  const fromUrl: Utm = {};
  for (const k of keys) {
    const v = search.get(`utm_${k}`);
    if (v) fromUrl[k] = v.slice(0, 100);
  }
  try {
    if (Object.keys(fromUrl).length) {
      sessionStorage.setItem(UTM_KEY, JSON.stringify(fromUrl));
      return fromUrl;
    }
    const saved = sessionStorage.getItem(UTM_KEY);
    return saved ? (JSON.parse(saved) as Utm) : undefined;
  } catch {
    return Object.keys(fromUrl).length ? fromUrl : undefined;
  }
}

export function savedUtm(): Utm | undefined {
  try {
    const s = sessionStorage.getItem(UTM_KEY);
    return s ? (JSON.parse(s) as Utm) : undefined;
  } catch {
    return undefined;
  }
}

export function track(slug: string, type: 'page_view' | 'booking_click' | 'booking_started', extra: { utm?: Utm; serviceIds?: string[] } = {}): void {
  const body = JSON.stringify({
    slug,
    type,
    sessionId: analyticsSession() || undefined,
    utm: extra.utm ?? savedUtm(),
    referrer: document.referrer || undefined,
    path: location.pathname + location.search,
    serviceIds: extra.serviceIds,
  });
  // Если в браузере есть сессия (сотрудник/клиент), API требует CSRF-заголовок.
  const csrf = document.cookie.split('; ').find((c) => c.startsWith('bk_csrf='))?.slice(8);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (csrf) headers['X-CSRF-Token'] = decodeURIComponent(csrf);
  void fetch('/api/v1/public/analytics/events', { method: 'POST', headers, body, keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
}
