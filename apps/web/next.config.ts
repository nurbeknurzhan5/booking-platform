import type { NextConfig } from 'next';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // окна 2ГИС/WhatsApp открываются с noopener; window.opener между origin-ами не нужен
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://mapgl.2gis.com",
      // inline-обработчики в атрибутах (onerror=, onclick=) не нужны ни React, ни Leaflet — запрещаем: это частый вектор XSS
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.2gis.com https://*.2gis.ru",
      "frame-src 'self' https://*.2gis.com https://widgets.2gis.com",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  // API и фронтенд на одном origin: cookie сессии остаются first-party (SameSite=Lax, CSRF double-submit).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // В адресе — секретный токен (управление записью, подтверждение, лист ожидания) или ссылки с токенами (тестовый телефон):
      // не передаём адрес в Referer и не индексируем. Правило ниже общего: одноимённый заголовок перекрывается.
      ...['/:locale/manage/:token', '/:locale/confirm/:token', '/:locale/waitlist/:token', '/dev/phone'].map((source) => ({
        source,
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      })),
    ];
  },
};

export default nextConfig;
