'use client';

import { useEffect, useRef } from 'react';

/**
 * Точка филиала на карте 2ГИС: клик по карте или перетаскивание метки задаёт координаты.
 * Карта — встроенная страница /embed/map?pick=1 (JS API 2.0 без ключа), координаты приходят через postMessage.
 */
export function MapPicker({ lat, lng, onChange, disabled }: { lat: number | null; lng: number | null; onChange: (lat: number, lng: number) => void; disabled?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  // адрес iframe фиксируется при первом показе, дальше метка двигается сообщениями
  const initial = useRef({ lat, lng });

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow || e.data?.type !== '2gis-pick') return;
      cb.current(Math.round(e.data.lat * 1e6) / 1e6, Math.round(e.data.lng * 1e6) / 1e6);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    if (lat !== null && lng !== null) frame.current?.contentWindow?.postMessage({ type: '2gis-set', lat, lng }, window.location.origin);
  }, [lat, lng]);

  const q = new URLSearchParams({ ...(initial.current.lat !== null && initial.current.lng !== null ? { lat: String(initial.current.lat), lng: String(initial.current.lng) } : {}), ...(disabled ? {} : { pick: '1' }) });
  return <iframe ref={frame} title="map" src={`/embed/map?${q}`} className="h-72 w-full rounded-lg border border-slate-200" data-testid="map-picker" />;
}
