'use client';

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    mapgl?: {
      Map: new (el: HTMLElement, opts: { center: [number, number]; zoom: number; key: string }) => { destroy: () => void };
      Marker: new (map: unknown, opts: { coordinates: [number, number] }) => unknown;
    };
  }
}

/**
 * Карта 2GIS (§13.6): при наличии ключа MapGL — встроенная карта, иначе ссылка «Открыть в 2GIS».
 */
export function MapBlock({ map, label }: { map: { latitude: number | null; longitude: number | null; url: string | null }; label: string }) {
  const key = process.env.NEXT_PUBLIC_2GIS_KEY;
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const canEmbed = !!key && map.latitude !== null && map.longitude !== null && !failed;

  useEffect(() => {
    if (!canEmbed || !ref.current) return;
    let instance: { destroy: () => void } | null = null;
    const init = () => {
      if (!window.mapgl || !ref.current) return setFailed(true);
      const coords: [number, number] = [map.longitude!, map.latitude!];
      instance = new window.mapgl.Map(ref.current, { center: coords, zoom: 16, key: key! });
      new window.mapgl.Marker(instance, { coordinates: coords });
    };
    if (window.mapgl) init();
    else {
      const s = document.createElement('script');
      s.src = 'https://mapgl.2gis.com/api/js/v1';
      s.async = true;
      s.onload = init;
      s.onerror = () => setFailed(true);
      document.head.appendChild(s);
    }
    return () => instance?.destroy();
  }, [canEmbed, key, map.latitude, map.longitude]);

  return (
    <div>
      {canEmbed && <div ref={ref} className="mb-3 h-72 w-full overflow-hidden rounded-lg" />}
      {map.url && (
        <a href={map.url} target="_blank" rel="noopener noreferrer" className="tpl-btn inline-flex rounded-lg px-4 py-2 text-sm font-semibold">
          🗺️ {label}
        </a>
      )}
    </div>
  );
}
