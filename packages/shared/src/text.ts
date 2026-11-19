const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // казахские буквы
  ә: 'a', ғ: 'g', қ: 'q', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

/** Slug для постоянной ссылки филиала: латиница, цифры, дефисы. */
export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || 'branch';
}

export const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;

export interface SocialPlatform {
  platform: string;
  label: string;
}

const SOCIAL_PATTERNS: Array<{ re: RegExp; platform: string; label: string }> = [
  { re: /(^|\.)instagram\.com$/, platform: 'instagram', label: 'Instagram' },
  { re: /(^|\.)(wa\.me|whatsapp\.com)$/, platform: 'whatsapp', label: 'WhatsApp' },
  { re: /(^|\.)(t\.me|telegram\.me|telegram\.org)$/, platform: 'telegram', label: 'Telegram' },
  { re: /(^|\.)tiktok\.com$/, platform: 'tiktok', label: 'TikTok' },
  { re: /(^|\.)(facebook\.com|fb\.com)$/, platform: 'facebook', label: 'Facebook' },
  { re: /(^|\.)(youtube\.com|youtu\.be)$/, platform: 'youtube', label: 'YouTube' },
  { re: /(^|\.)(vk\.com|vk\.ru)$/, platform: 'vk', label: 'VK' },
  { re: /(^|\.)threads\.(net|com)$/, platform: 'threads', label: 'Threads' },
  { re: /(^|\.)(x\.com|twitter\.com)$/, platform: 'x', label: 'X' },
  { re: /(^|\.)2gis\.(kz|ru|com)$/, platform: '2gis', label: '2GIS' },
];

/** Определение соцсети по URL (ТЗ §13.7). null — неизвестная платформа, нужна своя подпись. */
export function detectSocialPlatform(url: string): SocialPlatform | null {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    host = u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  const hit = SOCIAL_PATTERNS.find((p) => p.re.test(host));
  return hit ? { platform: hit.platform, label: hit.label } : null;
}

/** Только http(s)-ссылки допустимы на публичных страницах (защита от javascript: URL). */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
