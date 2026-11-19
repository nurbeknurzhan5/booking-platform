'use client';

import { useCallback, useState } from 'react';
import type { AppointmentView, SlotsResponse } from '@/lib/types';
import { pt, type PublicKey } from '@/lib/i18n-public';
import { dateTime, money } from '@/lib/format';
import { errorMessage, newIdempotencyKey } from '@/lib/api';
import { SlotPicker } from './SlotPicker';

export interface AppointmentActions {
  fetchSlots: (date: string) => Promise<SlotsResponse>;
  reschedule: (startAt: string, idempotencyKey: string) => Promise<AppointmentView>;
  cancel: (idempotencyKey: string) => Promise<AppointmentView>;
  review?: (rating: number, text: string) => Promise<unknown>;
}

/** Карточка записи клиента: перенос (без повторного OTP), отмена, отзыв. */
export function AppointmentCard({ initial, lang, actions }: { initial: AppointmentView; lang: string; actions: AppointmentActions }) {
  const t = (k: PublicKey) => pt(lang, k);
  const [a, setA] = useState(initial);
  const [mode, setMode] = useState<'view' | 'reschedule' | 'review'>('view');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [reviewed, setReviewed] = useState(!!initial.review);
  const items = a.items.map((i) => ({ serviceId: i.serviceId, specialistId: i.specialistId }));
  const fetchSlots = useCallback((date: string) => actions.fetchSlots(date), [actions]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="tpl-surface tpl-border rounded-xl border p-4" data-testid="appointment">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold" data-testid="appointment-time">{dateTime(a.startAt, a.timezone, lang)}</div>
          <div className="tpl-muted text-sm">{a.branch.name}{a.branch.address ? ` · ${a.branch.address}` : ''}</div>
        </div>
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs" data-testid="appointment-status">{t(`st_${a.status}` as PublicKey)}</span>
      </div>
      <ul className="mt-2 text-sm">
        {a.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-2">
            <span>{i.serviceName}{i.specialistName ? ` · ${i.specialistName}` : ''}</span>
            <span>{money(i.finalPrice)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1 text-right text-sm font-semibold">{t('total')}: {money(a.price.total)}</div>
      {error && <p role="alert" className="mt-2 text-sm text-rose-600">{error}</p>}

      {mode === 'view' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {a.canReschedule && (
            <button onClick={() => setMode('reschedule')} className="tpl-btn rounded-lg px-3 py-2 text-sm" data-testid="reschedule">{t('reschedule')}</button>
          )}
          {a.canCancel && (
            <button
              onClick={() => {
                if (!confirm(t('cancelConfirm'))) return;
                void run(async () => setA(await actions.cancel(newIdempotencyKey())));
              }}
              disabled={busy}
              className="tpl-border rounded-lg border px-3 py-2 text-sm"
              data-testid="cancel"
            >
              {t('cancel')}
            </button>
          )}
          {a.canReview && !reviewed && actions.review && (
            <button onClick={() => setMode('review')} className="tpl-border rounded-lg border px-3 py-2 text-sm">{t('leaveReview')}</button>
          )}
          {a.status === 'confirmed' && (
            <p className="tpl-muted w-full text-xs">
              {t('rescheduleDeadline')}: {dateTime(a.rescheduleDeadline, a.timezone, lang)} · {t('cancelDeadline')}: {dateTime(a.cancelDeadline, a.timezone, lang)}
            </p>
          )}
          {reviewed && <p className="tpl-muted text-sm">{t('thanksReview')}</p>}
        </div>
      )}

      {mode === 'reschedule' && (
        <div className="mt-4">
          <h3 className="mb-3 font-medium">{t('chooseNewTime')}</h3>
          <SlotPicker
            lang={lang}
            timezone={a.timezone}
            fetchSlots={fetchSlots}
            onSelect={(slot) => {
              if (items.length === 0) return;
              void run(async () => {
                setA(await actions.reschedule(slot.startAt, newIdempotencyKey()));
                setMode('view');
              });
            }}
          />
          <button onClick={() => setMode('view')} className="tpl-primary mt-3 text-sm underline">{t('back')}</button>
        </div>
      )}

      {mode === 'review' && actions.review && (
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await actions.review!(rating, text);
              setReviewed(true);
              setMode('view');
            });
          }}
        >
          <div className="flex gap-1 text-2xl" role="radiogroup">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-label={String(n)} onClick={() => setRating(n)} className={n <= rating ? 'tpl-accent' : 'opacity-30'}>★</button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} className="tpl-border w-full rounded-lg border px-3 py-2 text-sm" />
          <button disabled={busy} className="tpl-btn rounded-lg px-4 py-2 text-sm">{t('sendReview')}</button>
        </form>
      )}
    </article>
  );
}
