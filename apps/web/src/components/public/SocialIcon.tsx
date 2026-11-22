import { siFacebook, siInstagram, siTelegram, siThreads, siTiktok, siVk, siWhatsapp, siX, siYoutube } from 'simple-icons';
import { Link2, MapPin } from 'lucide-react';

type Brand = { path: string; hex: string; title: string };

/** Логотипы соцсетей (Simple Icons, CC0) — фирменный цвет и форма вместо эмодзи. */
const BRANDS: Record<string, Brand> = {
  instagram: siInstagram,
  whatsapp: siWhatsapp,
  telegram: siTelegram,
  tiktok: siTiktok,
  facebook: siFacebook,
  youtube: siYoutube,
  vk: siVk,
  threads: siThreads,
  x: siX,
};

/** Instagram — фирменный градиент, остальные — фирменный цвет. */
export function SocialIcon({ platform, size = 20, mono = false }: { platform: string; size?: number; mono?: boolean }) {
  if (platform === '2gis') return <MapPin width={size} height={size} color={mono ? 'currentColor' : '#19AA1E'} strokeWidth={2.2} aria-hidden />;
  const b = BRANDS[platform];
  if (!b) return <Link2 width={size} height={size} aria-hidden />;
  const gradient = platform === 'instagram' && !mono;
  return (
    <svg role="img" viewBox="0 0 24 24" width={size} height={size} aria-hidden fill={mono ? 'currentColor' : gradient ? 'url(#ig-grad)' : `#${b.hex}`} style={{ flexShrink: 0 }}>
      {gradient && (
        <defs>
          <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
            <stop offset="0" stopColor="#fdf497" />
            <stop offset="0.05" stopColor="#fdf497" />
            <stop offset="0.45" stopColor="#fd5949" />
            <stop offset="0.6" stopColor="#d6249f" />
            <stop offset="0.9" stopColor="#285AEB" />
          </radialGradient>
        </defs>
      )}
      <path d={b.path} />
    </svg>
  );
}

/** Тёмные логотипы (TikTok, X, Threads) на тёмной теме — светлым цветом. */
export const DARK_BRANDS = new Set(['tiktok', 'x', 'threads']);
