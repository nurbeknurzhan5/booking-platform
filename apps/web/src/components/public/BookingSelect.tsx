'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicPageData, SlotsResponse } from '@/lib/types';
import { api, errorMessage } from '@/lib/api';
import { pt, type PublicKey } from '@/lib/i18n-public';
import { addDays, dateTime, dayParts, localISODate, minutesLabel, money, timeOnly } from '@/lib/format';

type Slot = SlotsResponse['slots'][number];
export interface Overview extends SlotsResponse {
  days: Array<{ date: string; count: number }>;
  specialists: Array<{ id: string; count: number; serviceIds: string[] }>;
}
export interface Quote {
  durationMinutes: number;
  baseTotal: number;
  saleDiscountTotal: number;
  promoDiscountTotal: number;
  totalPrice: number;
}

const DAYS = 14;

/**
 * Запись на одной странице: услуги, специалист, дата и время видны сразу и влияют друг на друга.
 * Выбор услуги сужает список мастеров и пересчитывает дни и время; выбор мастера — его услуги, дни и время;
 * выбор даты — показывает, у кого из мастеров есть окна в этот день. Всё считает один запрос к серверу.
 */
export function BookingSelect({
  data,
  selected,
  onSelectedChange,
  specialist,
  onSpecialistChange,
  slot,
  onSlotChange,
  date: dateProp,
  onDateChange,
  items,
  seats,
  onSeatsChange,
  together,
  onTogetherChange,
  reloadToken,
  quote,
  onContinue,
  onWaitlist,
}: {
  data: PublicPageData;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  specialist: string | null;
  onSpecialistChange: (id: string | null) => void;
  slot: Slot | null;
  onSlotChange: (s: Slot | null) => void;
  /** Дата хранится в форме записи: при возврате с шага «Ваши данные» выбор не теряется. */
  date: string | null;
  onDateChange: (d: string) => void;
  /** Позиции запроса (собираются в форме записи: мастер и число мест). */
  items: Array<{ serviceId: string; specialistId: string | null; seats?: number; together?: boolean }>;
  seats: number;
  onSeatsChange: (n: number) => void;
  together: boolean;
  onTogetherChange: (v: boolean) => void;
  reloadToken: number;
  quote: Quote | null;
  onContinue: () => void;
  onWaitlist?: () => void;
}) {
  const lang = data.locale;
  const t = (k: PublicKey) => pt(lang, k);
  const tz = data.branch.timezone;
  const today = localISODate(new Date(), tz);
  const dates = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(today, i)), [today]);
  const date = dateProp ?? today;
  const setDate = onDateChange;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const datePicked = useRef(dateProp !== null);

  const bookable = data.services.filter((s) => s.onlineBooking);
  const sp = (id: string | null) => (id ? data.specialists.find((x) => x.id === id) ?? null : null);
  const chosen = sp(specialist);
  const does = (spId: string, serviceId: string) => !!sp(spId)?.serviceIds.includes(serviceId);

  const itemsKey = JSON.stringify(items);

  useEffect(() => {
    if (!items.length) {
      setOverview(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api<Overview>(`/public/branches/${data.slug}/availability/overview`, { method: 'POST', body: { date, items } })
      .then((r) => {
        if (!alive) return;
        setOverview(r);
        // первый показ: если сегодня мест нет — сразу ближайший день со свободным временем
        if (!datePicked.current && r.slots.length === 0) {
          const first = r.days.find((d) => d.count > 0);
          if (first && first.date !== date) {
            datePicked.current = true;
            setDate(first.date);
          }
        }
      })
      .catch((e) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [itemsKey, date, reloadToken, data.slug]);

  // выбранное время остаётся, если оно всё ещё свободно при новом наборе; иначе сбрасывается
  useEffect(() => {
    if (!slot || !overview) return;
    const same = overview.slots.find((s) => s.startAt === slot.startAt);
    if (!same) onSlotChange(null);
    else if (JSON.stringify(same.items) !== JSON.stringify(slot.items)) onSlotChange(same);
  }, [overview]);

  // мастер, который не делает ни одной из выбранных услуг, сбрасывается на «любой свободный»
  useEffect(() => {
    if (specialist && selected.length && !selected.some((sid) => does(specialist, sid))) onSpecialistChange(null);
  }, [selected, specialist]);

  // Несколько мест — только если все выбранные услуги без мастера и для каждой есть хотя бы два места (D-41)
  const capacity = (serviceId: string) => data.resources.filter((r) => r.serviceIds.includes(serviceId)).length;
  const seatCapacity = selected.length && selected.every((sid) => !data.specialists.some((x) => x.serviceIds.includes(sid))) ? Math.min(10, ...selected.map(capacity)) : 1;
  useEffect(() => {
    if (seats > Math.max(1, seatCapacity)) onSeatsChange(Math.max(1, seatCapacity));
  }, [seatCapacity, seats]);

  function toggleService(id: string) {
    onSelectedChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  function pickDate(d: string) {
    datePicked.current = true;
    setDate(d);
    if (slot && localISODate(new Date(slot.startAt), tz) !== d) onSlotChange(null);
  }
  function pickSpecialist(id: string | null) {
    onSpecialistChange(id);
    if (id) setShowAll(false);
  }

  // услуги: при выбранном мастере — только его (и уже выбранные), остальные — по кнопке «Все услуги»
  const visibleServices = chosen && !showAll ? bookable.filter((s) => does(chosen.id, s.id) || selected.includes(s.id)) : bookable;
  const hiddenCount = bookable.length - visibleServices.length;
  const byCategory = new Map<string, { name: string | null; list: typeof bookable }>();
  for (const s of visibleServices) {
    const key = s.category?.id ?? '_';
    if (!byCategory.has(key)) byCategory.set(key, { name: s.category?.name ?? null, list: [] });
    byCategory.get(key)!.list.push(s);
  }

  // мастера: без услуг — все; с услугами — те, кто оказывает хотя бы одну из выбранных
  const relevantSpecialists = selected.length ? data.specialists.filter((x) => selected.some((sid) => x.serviceIds.includes(sid))) : data.specialists.filter((x) => bookable.some((s) => x.serviceIds.includes(s.id)));
  const spCount = (id: string) => overview?.specialists.find((x) => x.id === id)?.count;
  const dayCount = (d: string) => overview?.days.find((x) => x.date === d)?.count;
  const nearest = overview && overview.slots.length === 0 ? overview.days.find((d) => d.count > 0 && d.date !== date) : undefined;

  const assigned = slot ? [...new Set(slot.items.map((i) => i.specialistName).filter(Boolean))].join(', ') : null;

  const continueBtn = (
    <button disabled={!slot} onClick={onContinue} className="tpl-btn tpl-r w-full py-3 font-semibold disabled:opacity-40" data-testid="next">
      {t('next')}
    </button>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="min-w-0 space-y-8">
        <h1 className="tpl-heading text-2xl font-bold">{t('bookTitle')}</h1>

        {/* 1. Услуги */}
        <section aria-labelledby="sec-services">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="sec-services" className="text-lg font-semibold">{t('secServices')}</h2>
            {chosen && (
              <button type="button" onClick={() => setShowAll(!showAll)} className="tpl-primary text-sm underline">
                {showAll ? `${t('onlySpecialistServices')}: ${chosen.name}` : `${t('showAllServices')}${hiddenCount ? ` (+${hiddenCount})` : ''}`}
              </button>
            )}
          </div>
          <div className="space-y-4">
            {[...byCategory.values()].map((g) => (
              <div key={g.name ?? '_'}>
                {g.name && byCategory.size > 1 && <h3 className="tpl-primary mb-2 text-xs font-semibold uppercase tracking-wide">{g.name}</h3>}
                <ul className="grid gap-2 sm:grid-cols-2">
                  {g.list.map((s) => {
                    const on = selected.includes(s.id);
                    const other = chosen && !does(chosen.id, s.id);
                    return (
                      <li key={s.id}>
                        <label className={`tpl-card tpl-r flex h-full cursor-pointer items-center gap-3 border p-3 transition ${on ? 'border-[var(--tpl-primary)] ring-1 ring-[var(--tpl-primary)]' : 'tpl-border'}`}>
                          <input type="checkbox" checked={on} onChange={() => toggleService(s.id)} className="h-5 w-5 shrink-0" data-testid={`service-${s.id}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium leading-snug">{s.name}</span>
                            <span className="tpl-muted text-xs">
                              {minutesLabel(s.durationMinutes, lang)}
                              {other && ` · ${t('autoSpecialist')}`}
                            </span>
                          </span>
                          <span className="shrink-0 font-semibold">{money(s.price)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Групповая бронь мест */}
        {seatCapacity > 1 && (
          <section aria-labelledby="sec-seats" className="tpl-soft tpl-r p-4" data-testid="seats-block">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="sec-seats" className="font-semibold">{t('seatsTitle')}</h2>
                <p className="tpl-muted text-sm">{t('seatsHint')}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => onSeatsChange(Math.max(1, seats - 1))} disabled={seats <= 1} className="tpl-card tpl-border h-10 w-10 rounded-full border text-xl font-semibold disabled:opacity-40" aria-label="−" data-testid="seats-minus">−</button>
                <span className="w-10 text-center text-xl font-bold" data-testid="seats-value">{seats}</span>
                <button type="button" onClick={() => onSeatsChange(Math.min(seatCapacity, seats + 1))} disabled={seats >= seatCapacity} className="tpl-card tpl-border h-10 w-10 rounded-full border text-xl font-semibold disabled:opacity-40" aria-label="+" data-testid="seats-plus">+</button>
              </div>
            </div>
            {seats > 1 && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" checked={together} onChange={(e) => onTogetherChange(e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="seats-together" />
                <span>
                  <b>{t('seatsTogether')}</b> <span className="tpl-muted">— {t('seatsTogetherHint')}</span>
                </span>
              </label>
            )}
          </section>
        )}

        {/* 2. Специалист */}
        {relevantSpecialists.length > 0 && (
          <section aria-labelledby="sec-specialist">
            <h2 id="sec-specialist" className="mb-3 text-lg font-semibold">{t('secSpecialist')}</h2>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" data-testid="specialists-row">
              {[{ id: null as string | null, name: t('anySpecialist'), specialization: null as string | null, photo: null as Record<string, string> | null }, ...relevantSpecialists].map((x) => {
                const on = specialist === x.id;
                const count = x.id ? spCount(x.id) : overview?.slots.length;
                const none = selected.length > 0 && count === 0;
                const doesN = x.id && selected.length > 1 ? selected.filter((sid) => does(x.id!, sid)).length : null;
                return (
                  <button
                    key={x.id ?? 'any'}
                    type="button"
                    onClick={() => pickSpecialist(x.id)}
                    data-testid={`specialist-${x.id ?? 'any'}`}
                    aria-pressed={on}
                    className={`tpl-r flex w-36 shrink-0 flex-col items-center gap-1.5 border p-3 text-center text-sm transition ${on ? 'tpl-btn border-transparent' : 'tpl-card tpl-border'} ${none && !on ? 'opacity-60' : ''}`}
                  >
                    <span className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-lg font-semibold ${on ? 'bg-white/20' : 'tpl-soft'}`}>
                      {x.photo?.thumb ? (
                        <img src={x.photo.thumb} alt="" className="h-full w-full object-cover" />
                      ) : x.id ? (
                        x.name.charAt(0).toUpperCase()
                      ) : (
                        '★'
                      )}
                    </span>
                    <span className="line-clamp-2 font-medium leading-tight">{x.name}</span>
                    {x.specialization && <span className="line-clamp-1 text-xs opacity-75">{x.specialization}</span>}
                    {selected.length > 0 && count !== undefined && (
                      <span className={`mt-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${on ? 'bg-white/20' : count > 0 ? 'tpl-chip' : 'tpl-muted'}`} data-testid={`spcount-${x.id ?? 'any'}`}>
                        {count > 0 ? `${count} ${t('windows')}` : t('noWindows')}
                      </span>
                    )}
                    {doesN !== null && doesN < selected.length && <span className="text-[11px] opacity-70">{t('doesServices')} {doesN}/{selected.length}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* 3. Дата и время */}
        <section aria-labelledby="sec-time">
          <h2 id="sec-time" className="mb-3 text-lg font-semibold">{t('secTime')}</h2>
          <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="listbox" aria-label="date">
            {dates.map((d) => {
              const p = dayParts(d, lang);
              const active = d === date;
              const c = selected.length ? dayCount(d) : undefined;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => pickDate(d)}
                  aria-selected={active}
                  data-testid={`date-${d}`}
                  className={`tpl-r flex min-w-[3.9rem] flex-col items-center border px-2 py-2 text-sm transition ${active ? 'tpl-btn border-transparent' : 'tpl-card tpl-border'} ${c === 0 && !active ? 'opacity-50' : ''}`}
                >
                  <span className="text-xs opacity-80">{p.weekday}</span>
                  <span className="text-lg font-semibold leading-tight">{p.day}</span>
                  <span className="text-[10px] opacity-70">{p.month}</span>
                  {c !== undefined && <span className={`mt-1 h-1.5 w-1.5 rounded-full ${c > 0 ? (active ? 'bg-current' : 'bg-[var(--tpl-primary)]') : 'bg-transparent'}`} aria-label={c > 0 ? `${c} ${t('windows')}` : t('notWorking')} />}
                </button>
              );
            })}
          </div>

          {!selected.length ? (
            <p className="tpl-soft tpl-r px-4 py-6 text-center text-sm" data-testid="pick-service-first">{t('pickServiceFirst')}</p>
          ) : error ? (
            <p className="text-sm text-rose-600">{error}</p>
          ) : !overview || overview.date !== date ? (
            <p className="tpl-muted text-sm">{t('loading')}</p>
          ) : overview.slots.length === 0 ? (
            <div className="tpl-soft tpl-r px-4 py-5 text-sm">
              <p>{t('noSlots')}</p>
              {nearest && (
                <button type="button" onClick={() => pickDate(nearest.date)} className="tpl-primary mt-2 font-medium underline" data-testid="nearest-day">
                  {t('nearestFree')}: {dayParts(nearest.date, lang).weekday}, {dayParts(nearest.date, lang).day} {dayParts(nearest.date, lang).month} →
                </button>
              )}
            </div>
          ) : (
            <div className={`grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6 ${loading ? 'opacity-60' : ''}`} data-testid="slots">
              {overview.slots.map((s) => {
                const active = slot?.startAt === s.startAt;
                return (
                  <button
                    key={s.startAt}
                    type="button"
                    onClick={() => onSlotChange(s)}
                    disabled={loading}
                    data-testid="slot"
                    aria-pressed={active}
                    className={`tpl-r border px-2 py-2.5 text-sm font-medium transition ${active ? 'tpl-btn border-transparent' : 'tpl-card tpl-border hover:border-[var(--tpl-primary)]'}`}
                  >
                    {timeOnly(s.startAt, tz)}
                  </button>
                );
              })}
            </div>
          )}
          {onWaitlist && selected.length > 0 && (
            <button type="button" onClick={onWaitlist} className="tpl-primary mt-4 block text-sm underline" data-testid="waitlist-open">
              {t('waitlistJoin')}
            </button>
          )}
        </section>
      </div>

      {/* Итог: справа на компьютере, снизу на телефоне */}
      <aside className="tpl-card tpl-r tpl-border sticky bottom-0 z-10 -mx-4 border-t p-4 shadow-lg sm:mx-0 sm:border lg:top-6 lg:bottom-auto lg:shadow-none" data-testid="booking-summary">
        <h2 className="mb-3 hidden font-semibold lg:block">{t('yourBooking')}</h2>
        <dl className="hidden space-y-2 text-sm lg:block">
          <div>
            <dt className="tpl-muted text-xs">{t('secServices')}</dt>
            <dd>{selected.length ? selected.map((sid) => <div key={sid}>{data.services.find((s) => s.id === sid)?.name}{seats > 1 ? ` × ${seats}` : ''}</div>) : <span className="tpl-muted">{t('notChosen')}</span>}</dd>
          </div>
          {relevantSpecialists.length > 0 && (
            <div>
              <dt className="tpl-muted text-xs">{t('secSpecialist')}</dt>
              <dd>{assigned || chosen?.name || <span className="tpl-muted">{t('autoSpecialist')}</span>}</dd>
            </div>
          )}
          <div>
            <dt className="tpl-muted text-xs">{t('secTime')}</dt>
            <dd>{slot ? dateTime(slot.startAt, tz, lang) : <span className="tpl-muted">{t('notChosen')}</span>}</dd>
          </div>
        </dl>
        <div className="flex items-center justify-between gap-3 text-sm lg:mt-4 lg:border-t lg:pt-3 lg:tpl-border">
          <span className="tpl-muted">
            {slot ? <span className="lg:hidden">{timeOnly(slot.startAt, tz)} · </span> : null}
            {quote ? minutesLabel(quote.durationMinutes, lang) : '—'}
          </span>
          <span className="text-right">
            {quote && quote.saleDiscountTotal + quote.promoDiscountTotal > 0 && <s className="tpl-muted mr-2">{money(quote.baseTotal)}</s>}
            <b className="text-base">{t('total')}: {money(quote?.totalPrice ?? 0)}</b>
          </span>
        </div>
        <div className="mt-3">{continueBtn}</div>
      </aside>
    </div>
  );
}
