'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

/** Координата из недоверенного источника (query, postMessage): только конечное число в допустимом диапазоне. */
function coord(v: unknown, limit: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/**
 * Временная карта 2ГИС для локальной проверки (D-43): Leaflet на растровых тайлах 2ГИС, без ключа.
 * Официальная карта — MapGL с ключом 2ГИС (NEXT_PUBLIC_2GIS_KEY, R-04); в production без ключа эта страница
 * не используется (показываются только кнопки «Открыть в 2ГИС» и «Маршрут»).
 * Параметры: lat, lng, zoom, title; pick=1 — выбор точки: координаты уходят родителю через postMessage.
 * title (название филиала, задаёт владелец) выводится только как текст: Leaflet вставляет строки через innerHTML,
 * поэтому подсказке передаётся DOM-узел с textContent.
 */
export default function EmbedMap() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const lat = coord(q.get('lat'), 90);
    const lng = coord(q.get('lng'), 180);
    const zoomParam = coord(q.get('zoom'), 18);
    const zoom = zoomParam !== null && zoomParam >= 1 ? zoomParam : lat !== null && lng !== null ? 16 : 12;
    const pick = q.get('pick') === '1';
    const title = (q.get('title') ?? '').slice(0, 120);
    const hasPoint = lat !== null && lng !== null;
    const center: [number, number] = hasPoint ? [lat, lng] : [43.2383, 76.9456];
    let cleanup = () => {};
    let alive = true;

    void import('leaflet').then((L) => {
      if (!alive || !ref.current) return;
      const map = L.map(ref.current, { center, zoom, scrollWheelZoom: pick, attributionControl: true });
      L.tileLayer('https://tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1', { subdomains: '0123', maxZoom: 18, attribution: '© <a href="https://2gis.kz" target="_blank" rel="noopener">2ГИС</a>' }).addTo(map);
      map.attributionControl.setPrefix(false);
      const icon = L.divIcon({
        className: '',
        iconSize: [32, 42],
        iconAnchor: [16, 42],
        popupAnchor: [0, -38],
        html: '<svg width="32" height="42" viewBox="0 0 32 42"><path d="M16 0C7.2 0 0 7 0 15.7 0 27.5 16 42 16 42s16-14.5 16-26.3C32 7 24.8 0 16 0z" fill="#19AA1E"/><circle cx="16" cy="15.5" r="6.5" fill="#fff"/></svg>',
      });
      const marker = L.marker(center, { icon, draggable: pick });
      if (hasPoint || pick) marker.addTo(map);
      if (title && !pick) {
        const tip = document.createElement('span');
        tip.textContent = title;
        tip.dataset.testid = 'map-title';
        marker.bindTooltip(tip, { direction: 'top', offset: [0, -40], permanent: true });
      }
      let onMsg: ((e: MessageEvent) => void) | null = null;
      if (pick) {
        const send = (p: { lat: number; lng: number }) => window.parent.postMessage({ type: '2gis-pick', lat: p.lat, lng: p.lng }, window.location.origin);
        map.on('click', (e) => {
          marker.setLatLng(e.latlng);
          send(e.latlng.wrap());
        });
        marker.on('dragend', () => send(marker.getLatLng().wrap()));
        // точку двигает только страница-родитель того же origin; координаты — только конечные числа
        onMsg = (e: MessageEvent) => {
          if (e.origin !== window.location.origin || e.source !== window.parent || window.parent === window) return;
          const d: unknown = e.data;
          if (typeof d !== 'object' || d === null || (d as { type?: unknown }).type !== '2gis-set') return;
          const { lat: rawLat, lng: rawLng } = d as { lat?: unknown; lng?: unknown };
          if (typeof rawLat !== 'number' || typeof rawLng !== 'number') return;
          const nLat = coord(rawLat, 90);
          const nLng = coord(rawLng, 180);
          if (nLat === null || nLng === null) return;
          marker.setLatLng([nLat, nLng]);
          map.panTo([nLat, nLng]);
        };
        window.addEventListener('message', onMsg);
      }
      cleanup = () => {
        if (onMsg) window.removeEventListener('message', onMsg);
        map.remove();
      };
    });
    return () => {
      alive = false;
      cleanup();
    };
  }, []);

  return <div ref={ref} data-testid="embed-map" style={{ position: 'fixed', inset: 0, background: '#f5f0dc' }} />;
}
