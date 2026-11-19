'use client';

import { useEffect, useState } from 'react';
import type { SlotsResponse } from '@/lib/types';
import { addDays, localISODate, timeOnly } from '@/lib/format';
import { pt } from '@/lib/i18n-public';
import { errorMessage } from '@/lib/api';

type Slot = SlotsResponse['slots'][number];

/** Выбор даты (лента на 14 дней) и свободного времени. */
export function SlotPicker({
  lang,
  timezone,
  fetchSlots,
  onSelect,
  selected,
  reloadToken = 0,
  days = 14,
}: {
  lang: string;
  timezone: string;
  fetchSlots: (date: string) => Promise<SlotsResponse>;
  onSelect: (slot: Slot) => void;
  selected?: string | null;
  reloadToken?: number;
  days?: number;
}) {
  const today = localISODate(new Date(), timezone);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intl = lang === 'kk' ? 'kk-KZ' : lang === 'en' ? 'en-GB' : 'ru-RU';

  useEffect(() => {
    let alive = true;
    setSlots(null);
    setError(null);
    fetchSlots(date)
      .then((r) => alive && setSlots(r.slots))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [date, fetchSlots, reloadToken]);

  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
  return (
    <div>
      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="listbox" aria-label="date">
        {dates.map((d) => {
          const dt = new Date(`${d}T12:00:00Z`);
          const active = d === date;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDate(d)}
              aria-selected={active}
              data-testid={`date-${d}`}
              className={`flex min-w-[3.75rem] flex-col items-center rounded-xl border px-2 py-2 text-sm ${active ? 'tpl-btn border-transparent' : 'tpl-surface tpl-border'}`}
            >
              <span className="text-xs capitalize opacity-80">{new Intl.DateTimeFormat(intl, { weekday: 'short', timeZone: 'UTC' }).format(dt)}</span>
              <span className="text-lg font-semibold">{dt.getUTCDate()}</span>
              <span className="text-[10px] opacity-70">{new Intl.DateTimeFormat(intl, { month: 'short', timeZone: 'UTC' }).format(dt)}</span>
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!slots && !error && <p className="tpl-muted text-sm">{pt(lang, 'loading')}</p>}
      {slots && slots.length === 0 && <p className="tpl-muted text-sm">{pt(lang, 'noSlots')}</p>}
      {slots && slots.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {slots.map((s) => {
            const active = selected === s.startAt;
            return (
              <button
                key={s.startAt}
                type="button"
                onClick={() => onSelect(s)}
                data-testid="slot"
                className={`rounded-lg border px-2 py-2.5 text-sm font-medium ${active ? 'tpl-btn border-transparent' : 'tpl-surface tpl-border'}`}
              >
                {timeOnly(s.startAt, timezone)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
