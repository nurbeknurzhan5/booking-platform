'use client';

import { useEffect, useRef, useState } from 'react';
import { Navigation } from 'lucide-react';
import { SocialIcon } from './SocialIcon';

declare global {
  interface Window {
    mapgl?: {
      Map: new (el: HTMLElement, opts: { center: [number, number]; zoom: number; key: string }) => { destroy: () => void };
      Marker: new (map: unknown, opts: { coordinates: [number, number] }) => unknown;
    };
  }
}

/** Загрузка скрипта один раз на страницу. */
/** Временная карта без ключа — только для локальной проверки (в сборке production задаётся NEXT_PUBLIC_APP_ENV=production). */
const DEV_TILES = process.env.NEXT_PUBLIC_APP_ENV !== 'production';

export function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) return existing.dataset.loaded ? Promise.resolve() : new Promise((res, rej) => (existing.addEventListener('load', () => res()), existing.addEventListener('error', rej)));
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      s.dataset.loaded = '1';
      res();
    };
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

/**
 * Карта 2ГИС (§13.6). С ключом MapGL (NEXT_PUBLIC_2GIS_KEY, R-04) — векторная карта MapGL;
 * без ключа вне production — временная карта на тайлах 2ГИС (/embed/map, D-43); в production без ключа — только кнопки.
 * Карта грузится, только когда блок появляется на экране. Кнопки «Открыть в 2ГИС» и «Маршрут» — всегда.
 */
export function MapBlock({
  map,
  label,
  routeLabel,
  title,
}: {
  map: { latitude: number | null; longitude: number | null; url: string | null };
  label: string;
  routeLabel?: string;
  title?: string;
}) {
  const key = process.env.NEXT_PUBLIC_2GIS_KEY;
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const hasCoords = map.latitude !== null && map.longitude !== null;

  useEffect(() => {
    if (!hasCoords || !ref.current) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [hasCoords]);

  useEffect(() => {
    if (!visible || !ref.current || !hasCoords) return;
    const el = ref.current;
    const lat = map.latitude!;
    const lng = map.longitude!;
    let cleanup: (() => void) | undefined;
    let alive = true;
    if (key) {
      loadScript('https://mapgl.2gis.com/api/js/v1')
        .then(() => {
          if (!alive || !window.mapgl) return;
          const m = new window.mapgl.Map(el, { center: [lng, lat], zoom: 16, key });
          new window.mapgl.Marker(m, { coordinates: [lng, lat] });
          cleanup = () => m.destroy();
        })
        .catch(() => setFailed(true));
    }
    return () => {
      alive = false;
      cleanup?.();
    };
  }, [visible, key, hasCoords, map.latitude, map.longitude, title]);

  // Ссылки 2ГИС: точка на карте и маршрут до неё
  const openUrl = map.url ?? (hasCoords ? `https://2gis.kz/?m=${map.longitude}%2C${map.latitude}%2F17` : null);
  const routeUrl = hasCoords ? `https://2gis.kz/directions/points/%7C${map.longitude}%2C${map.latitude}` : null;

  return (
    <div>
      {hasCoords && !failed && (key || DEV_TILES) && (
        <div ref={ref} className="tpl-r mb-3 h-80 w-full overflow-hidden border tpl-border" data-testid="map-2gis">
          {!key && DEV_TILES && visible && (
            <iframe
              title={title ?? '2GIS'}
              src={`/embed/map?lat=${map.latitude}&lng=${map.longitude}&title=${encodeURIComponent(title ?? '')}`}
              className="h-full w-full border-0"
              loading="lazy"
            />
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {openUrl && (
          <a href={openUrl} target="_blank" rel="noopener noreferrer" className="tpl-btn tpl-pill inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold">
            <SocialIcon platform="2gis" size={16} mono /> {label}
          </a>
        )}
        {routeUrl && routeLabel && (
          <a href={routeUrl} target="_blank" rel="noopener noreferrer" className="tpl-card tpl-pill inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold">
            <Navigation className="h-4 w-4" aria-hidden /> {routeLabel}
          </a>
        )}
      </div>
    </div>
  );
}
