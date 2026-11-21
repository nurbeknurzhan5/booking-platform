'use client';

import { themeRoot } from '@/lib/theme';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppointmentView, PublicPageData, SlotsResponse } from '@/lib/types';
import { api, ApiError, errorMessage, newIdempotencyKey } from '@/lib/api';
import { pt, type PublicKey } from '@/lib/i18n-public';
import { dateTime, minutesLabel, money } from '@/lib/format';
import { analyticsSession, savedUtm, track } from '@/lib/analytics';
import { SlotPicker } from './SlotPicker';

type Step = 'services' | 'specialists' | 'time' | 'details' | 'otp' | 'done' | 'waitlist' | 'waitlistOtp' | 'waitlistDone';
type Slot = SlotsResponse['slots'][number];

interface HoldResponse {
  appointmentId: string;
  holdToken: string;
  holdExpiresAt: string;
  otpExpiresAt: string;
  appointment: AppointmentView;
}
interface WaitlistJoin {
  entryId: string;
  token: string;
  otpExpiresAt: string;
}
/** Сегодняшняя дата YYYY-MM-DD в часовом поясе филиала (+ days). */
function localISODate(timezone: string, days = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(Date.now() + days * 86400_000));
}
interface Quote {
  durationMinutes: number;
  baseTotal: number;
  saleDiscountTotal: number;
  promoDiscountTotal: number;
  totalPrice: number;
}

function useCountdown(until: string | null) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!until) return;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  return left;
}

export function BookingFlow({ data, initialServiceId }: { data: PublicPageData; initialServiceId?: string }) {
  const lang = data.locale;
  const t = (k: PublicKey) => pt(lang, k);
  const { style, className: themeClass } = themeRoot(data.template);
  const bookable = data.services.filter((s) => s.onlineBooking);

  const [step, setStep] = useState<Step>('services');
  const [selected, setSelected] = useState<string[]>(initialServiceId ? [initialServiceId] : []);
  const [specialistFor, setSpecialistFor] = useState<Record<string, string | null>>({});
  const [slot, setSlot] = useState<Slot | null>(null);
  const [reloadSlots, setReloadSlots] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');
  const [promo, setPromo] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<string | undefined>();
  const [consentPd, setConsentPd] = useState(false);
  const [consentNotify, setConsentNotify] = useState(true);
  const [consentWa, setConsentWa] = useState(true);
  // Рекламные сообщения (D-34): только по явной отметке, по умолчанию выключено.
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot
  const [quote, setQuote] = useState<Quote | null>(null);
  const [hold, setHold] = useState<HoldResponse | null>(null);
  const [code, setCode] = useState('');
  const [done, setDone] = useState<{ appointment: AppointmentView; manageToken: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wlFrom, setWlFrom] = useState(() => localISODate(data.branch.timezone));
  const [wlTo, setWlTo] = useState(() => localISODate(data.branch.timezone, 7));
  const [wl, setWl] = useState<WaitlistJoin | null>(null);
  const [wlLeft, setWlLeft] = useState(false);
  const formStarted = useRef(Date.now());
  const holdKey = useRef(newIdempotencyKey());
  const holdLeft = useCountdown(hold?.holdExpiresAt ?? null);

  useEffect(() => {
    track(data.slug, 'booking_started');
  }, [data.slug]);

  const items = useMemo(() => selected.map((serviceId) => ({ serviceId, specialistId: specialistFor[serviceId] ?? null })), [selected, specialistFor]);

  useEffect(() => {
    if (!items.length) return setQuote(null);
    api<Quote>(`/public/branches/${data.slug}/quote`, { method: 'POST', body: { items, promoCode: appliedPromo } })
      .then(setQuote)
      .catch((e) => {
        if (e instanceof ApiError && e.code === 'PROMO_INVALID') {
          setAppliedPromo(undefined);
          setError(e.message);
        }
      });
  }, [items, appliedPromo, data.slug]);

  const fetchSlots = useCallback(
    (date: string) => api<SlotsResponse>(`/public/branches/${data.slug}/availability`, { method: 'POST', body: { date, items } }),
    [data.slug, items],
  );

  const specialistsFor = (serviceId: string) => data.specialists.filter((s) => s.serviceIds.includes(serviceId));
  const needsSpecialistStep = selected.some((id) => specialistsFor(id).length > 0);

  async function submitHold() {
    setError(null);
    setBusy(true);
    try {
      const r = await api<HoldResponse>(`/public/branches/${data.slug}/bookings`, {
        method: 'POST',
        idempotencyKey: holdKey.current,
        body: {
          startAt: slot!.startAt,
          items,
          client: { name: name.trim(), phone },
          promoCode: appliedPromo,
          locale: lang,
          consents: { personalData: consentPd, notifications: consentNotify, whatsapp: consentWa, marketing: consentMarketing },
          comment: comment.trim() || undefined,
          utm: savedUtm(),
          visitorSession: analyticsSession() || undefined,
          website: website || undefined,
          formElapsedMs: Date.now() - formStarted.current,
        },
      });
      setHold(r);
      setStep('otp');
    } catch (e) {
      holdKey.current = newIdempotencyKey();
      if (e instanceof ApiError && e.code === 'SLOT_UNAVAILABLE') {
        setSlot(null);
        setReloadSlots((n) => n + 1);
        setStep('time');
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!hold) return;
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ appointment: AppointmentView; manageToken: string }>(`/public/bookings/${hold.appointmentId}/confirm`, {
        method: 'POST',
        idempotencyKey: `confirm-${hold.appointmentId}-${code}`,
        body: { holdToken: hold.holdToken, code },
      });
      setDone(r);
      setStep('done');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'HOLD_EXPIRED') {
        setHold(null);
        setSlot(null);
        setReloadSlots((n) => n + 1);
        setStep('time');
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!hold) return;
    setError(null);
    try {
      await api(`/public/bookings/${hold.appointmentId}/resend-otp`, { method: 'POST', body: { holdToken: hold.holdToken } });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function extend() {
    if (!hold) return;
    try {
      const r = await api<{ holdExpiresAt: string }>(`/public/bookings/${hold.appointmentId}/extend`, { method: 'POST', body: { holdToken: hold.holdToken } });
      setHold({ ...hold, holdExpiresAt: r.holdExpiresAt, appointment: { ...hold.appointment, hold: { expiresAt: r.holdExpiresAt, extensionCount: 1 } } });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  // ---------- лист ожидания (§9) ----------
  async function joinWaitlist() {
    setError(null);
    setBusy(true);
    try {
      const sps = [...new Set(items.map((i) => i.specialistId ?? null))];
      const r = await api<WaitlistJoin>(`/public/branches/${data.slug}/waitlist`, {
        method: 'POST',
        body: {
          items: selected.map((serviceId) => ({ serviceId })),
          specialistId: sps.length === 1 ? sps[0] : null,
          dateFrom: wlFrom,
          dateTo: wlTo,
          client: { name: name.trim(), phone },
          locale: lang,
          consents: { personalData: consentPd, notifications: consentNotify, whatsapp: consentWa },
          website: website || undefined,
          formElapsedMs: Date.now() - formStarted.current,
        },
      });
      setWl(r);
      setCode('');
      setStep('waitlistOtp');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmWaitlist() {
    if (!wl) return;
    setError(null);
    setBusy(true);
    try {
      await api(`/public/waitlist/${wl.entryId}/confirm`, { method: 'POST', body: { token: wl.token, code } });
      setStep('waitlistDone');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function resendWaitlist() {
    if (!wl) return;
    setError(null);
    try {
      await api(`/public/waitlist/${wl.entryId}/resend-otp`, { method: 'POST', body: { token: wl.token } });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function leaveWaitlist() {
    if (!wl) return;
    setError(null);
    try {
      await api(`/public/waitlist/${wl.entryId}/cancel`, { method: 'POST', body: { token: wl.token } });
      setWlLeft(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const steps: Array<{ key: Step; label: PublicKey }> = [
    { key: 'services', label: 'step1' },
    ...(needsSpecialistStep ? [{ key: 'specialists' as Step, label: 'step2' as PublicKey }] : []),
    { key: 'time', label: 'step3' },
    { key: 'details', label: 'step4' },
    { key: 'otp', label: 'step5' },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  if (!data.availability.bookingEnabled) {
    return (
      <div className="tpl flex min-h-screen items-center justify-center p-6 text-center" style={style}>
        <div>
          <h1 className="text-xl font-semibold">{t('closedTitle')}</h1>
          <p className="tpl-muted mt-2">{t('closedText')}</p>
          <Link className="tpl-primary mt-4 inline-block underline" href={`/${lang}/b/${data.slug}`}>{t('back')}</Link>
        </div>
      </div>
    );
  }

  const Summary = () =>
    quote ? (
      <div className="tpl-surface sticky bottom-0 -mx-4 mt-6 flex items-center justify-between border-t tpl-border px-4 py-3 text-sm">
        <span>{t('duration')}: {minutesLabel(quote.durationMinutes, lang)}</span>
        <span className="text-right">
          {quote.saleDiscountTotal + quote.promoDiscountTotal > 0 && <s className="tpl-muted mr-2">{money(quote.baseTotal)}</s>}
          <b>{t('total')}: {money(quote.totalPrice)}</b>
        </span>
      </div>
    ) : null;

  return (
    <div className={`${themeClass} min-h-screen`} style={style}>
      <div className="mx-auto max-w-xl px-4 pb-10 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <Link href={`/${lang}/b/${data.slug}`} className="tpl-primary text-sm">← {data.branch.name}</Link>
        </div>
        {stepIndex >= 0 && (
          <ol className="mb-5 flex gap-1" aria-label="progress">
            {steps.map((s, i) => (
              <li key={s.key} className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? 'tpl-btn' : 'tpl-border border'}`} title={t(s.label)} />
            ))}
          </ol>
        )}
        {error && <div role="alert" className="mb-4 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-800">{error}</div>}

        {step === 'services' && (
          <section>
            <h1 className="mb-4 text-xl font-semibold">{t('step1')}</h1>
            <ul className="space-y-2">
              {bookable.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <li key={s.id}>
                    <label className={`tpl-surface flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${on ? 'border-[var(--tpl-primary)]' : 'tpl-border'}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setSelected(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])}
                        className="h-5 w-5 accent-[var(--tpl-primary)]"
                        data-testid={`service-${s.id}`}
                      />
                      <span className="flex-1">
                        <span className="block font-medium">{s.name}</span>
                        <span className="tpl-muted text-xs">{minutesLabel(s.durationMinutes, lang)}</span>
                      </span>
                      <span className="font-semibold">{money(s.price)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <Summary />
            <button disabled={!selected.length} onClick={() => setStep(needsSpecialistStep ? 'specialists' : 'time')} className="tpl-btn mt-4 w-full rounded-xl py-3 font-semibold disabled:opacity-40" data-testid="next">
              {t('next')}
            </button>
          </section>
        )}

        {step === 'specialists' && (
          <section>
            <h1 className="mb-4 text-xl font-semibold">{t('step2')}</h1>
            {selected.map((sid) => {
              const svc = data.services.find((s) => s.id === sid)!;
              const list = specialistsFor(sid);
              if (!list.length) return null;
              return (
                <div key={sid} className="mb-5">
                  <h2 className="tpl-muted mb-2 text-sm font-medium">{svc.name}</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {[{ id: null as string | null, name: t('anySpecialist'), specialization: null as string | null }, ...list].map((sp) => {
                      const on = (specialistFor[sid] ?? null) === sp.id;
                      return (
                        <button
                          key={sp.id ?? 'any'}
                          type="button"
                          onClick={() => setSpecialistFor({ ...specialistFor, [sid]: sp.id })}
                          data-testid={`specialist-${sp.id ?? 'any'}`}
                          className={`rounded-xl border p-3 text-left text-sm ${on ? 'tpl-btn border-transparent' : 'tpl-surface tpl-border'}`}
                        >
                          <span className="block font-medium">{sp.name}</span>
                          {sp.specialization && <span className="text-xs opacity-75">{sp.specialization}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <Summary />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setStep('services')} className="tpl-surface tpl-border flex-1 rounded-xl border py-3">{t('back')}</button>
              <button onClick={() => { setSlot(null); setStep('time'); }} className="tpl-btn flex-1 rounded-xl py-3 font-semibold" data-testid="next">{t('next')}</button>
            </div>
          </section>
        )}

        {step === 'time' && (
          <section>
            <h1 className="mb-4 text-xl font-semibold">{t('step3')}</h1>
            <SlotPicker lang={lang} timezone={data.branch.timezone} fetchSlots={fetchSlots} onSelect={setSlot} selected={slot?.startAt} reloadToken={reloadSlots} />
            {slot && (
              <p className="tpl-muted mt-4 text-sm">
                {dateTime(slot.startAt, data.branch.timezone, lang)}
                {slot.items.some((i) => i.specialistName) && ` · ${[...new Set(slot.items.map((i) => i.specialistName).filter(Boolean))].join(', ')}`}
              </p>
            )}
            {data.availability.waitlistEnabled && (
              <button type="button" onClick={() => { setError(null); setStep('waitlist'); }} className="tpl-primary mt-4 block text-sm underline" data-testid="waitlist-open">
                {t('waitlistJoin')}
              </button>
            )}
            <Summary />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setStep(needsSpecialistStep ? 'specialists' : 'services')} className="tpl-surface tpl-border flex-1 rounded-xl border py-3">{t('back')}</button>
              <button disabled={!slot} onClick={() => setStep('details')} className="tpl-btn flex-1 rounded-xl py-3 font-semibold disabled:opacity-40" data-testid="next">{t('next')}</button>
            </div>
          </section>
        )}

        {step === 'waitlist' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void joinWaitlist();
            }}
          >
            <h1 className="mb-2 text-xl font-semibold">{t('waitlistTitle')}</h1>
            <p className="tpl-muted mb-4 text-sm">{t('waitlistText')}</p>
            <div className="tpl-surface tpl-border mb-4 rounded-xl border p-3 text-sm">
              {selected.map((sid) => {
                const svc = data.services.find((s) => s.id === sid);
                const sp = specialistFor[sid] ? data.specialists.find((x) => x.id === specialistFor[sid]) : null;
                return <div key={sid}>{svc?.name}{sp ? ` · ${sp.name}` : ''}</div>;
              })}
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">
                  {t('waitlistFrom')}
                  <input type="date" required value={wlFrom} min={localISODate(data.branch.timezone)} onChange={(e) => setWlFrom(e.target.value)} className="tpl-surface tpl-border mt-1 w-full rounded-lg border px-3 py-2.5" data-testid="wl-from" />
                </label>
                <label className="block text-sm">
                  {t('waitlistTo')}
                  <input type="date" required value={wlTo} min={wlFrom} onChange={(e) => setWlTo(e.target.value)} className="tpl-surface tpl-border mt-1 w-full rounded-lg border px-3 py-2.5" data-testid="wl-to" />
                </label>
              </div>
              <label className="block text-sm">
                {t('name')}
                <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" className="tpl-surface tpl-border mt-1 w-full rounded-lg border px-3 py-2.5" data-testid="wl-name" />
              </label>
              <label className="block text-sm">
                {t('phone')}
                <input required type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 7__ ___ __ __" autoComplete="tel" className="tpl-surface tpl-border mt-1 w-full rounded-lg border px-3 py-2.5" data-testid="wl-phone" />
              </label>
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" required checked={consentPd} onChange={(e) => setConsentPd(e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="wl-consent" />
                <span>{t('consentPd')} (<a href="/legal/privacy" target="_blank" className="underline">↗</a>)</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={consentNotify} onChange={(e) => setConsentNotify(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>{t('consentNotify')}</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={consentWa} onChange={(e) => setConsentWa(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>{t('consentWa')}</span>
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setStep('time')} className="tpl-surface tpl-border flex-1 rounded-xl border py-3">{t('back')}</button>
              <button type="submit" disabled={busy || !consentPd || !selected.length} className="tpl-btn flex-1 rounded-xl py-3 font-semibold disabled:opacity-40" data-testid="wl-get-code">{t('getCode')}</button>
            </div>
          </form>
        )}

        {step === 'waitlistOtp' && wl && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirmWaitlist();
            }}
          >
            <h1 className="mb-2 text-xl font-semibold">{t('waitlistTitle')}</h1>
            <p className="tpl-muted mb-4 text-sm">{t('codeSent')} {phone}</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              aria-label={t('code')}
              className="tpl-surface tpl-border w-full rounded-xl border px-4 py-3 text-center font-mono text-2xl tracking-[0.5em]"
              data-testid="wl-otp"
            />
            <button type="submit" disabled={busy || code.length !== 6} className="tpl-btn mt-4 w-full rounded-xl py-3 font-semibold disabled:opacity-40" data-testid="wl-confirm">{t('waitlistConfirm')}</button>
            <div className="mt-3 text-sm">
              <button type="button" onClick={() => void resendWaitlist()} className="tpl-primary underline">{t('resend')}</button>
            </div>
          </form>
        )}

        {step === 'waitlistDone' && (
          <section className="text-center" data-testid="waitlist-done">
            <div className="tpl-btn mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-3xl">✓</div>
            <h1 className="text-2xl font-semibold">{wlLeft ? t('waitlistLeft') : t('waitlistDone')}</h1>
            {!wlLeft && <p className="tpl-muted mt-2 text-sm">{t('waitlistDoneText')}</p>}
            <div className="tpl-surface tpl-border mt-5 rounded-xl border p-4 text-left text-sm">
              {selected.map((sid) => <div key={sid}>{data.services.find((s) => s.id === sid)?.name}</div>)}
              <div className="tpl-muted mt-1">{wlFrom} — {wlTo}</div>
            </div>
            <div className="mt-5 flex flex-col items-center gap-3">
              <Link href={`/${lang}/b/${data.slug}`} className="tpl-btn inline-block rounded-xl px-6 py-3 font-semibold">{t('back')}</Link>
              {!wlLeft && <button type="button" onClick={() => void leaveWaitlist()} className="tpl-primary text-sm underline">{t('waitlistLeave')}</button>}
            </div>
          </section>
        )}

        {step === 'details' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitHold();
            }}
          >
            <h1 className="mb-4 text-xl font-semibold">{t('step4')}</h1>
            <div className="space-y-3">
              <label className="block text-sm">
                {t('name')}
                <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" className="tpl-surface tpl-border mt-1 w-full rounded-lg border px-3 py-2.5" data-testid="name" />
              </label>
              <label className="block text-sm">
                {t('phone')}
                <input required type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 7__ ___ __ __" autoComplete="tel" className="tpl-surface tpl-border mt-1 w-full rounded-lg border px-3 py-2.5" data-testid="phone" />
              </label>
              <label className="block text-sm">
                {t('comment')}
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000} className="tpl-surface tpl-border mt-1 w-full rounded-lg border px-3 py-2" />
              </label>
              <div className="flex gap-2">
                <input value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder={t('promoCode')} className="tpl-surface tpl-border flex-1 rounded-lg border px-3 py-2 font-mono" />
                <button type="button" onClick={() => { setError(null); setAppliedPromo(promo.trim() || undefined); }} className="tpl-surface tpl-border rounded-lg border px-3 text-sm">{t('apply')}</button>
              </div>
              {/* honeypot для ботов — скрыт от людей */}
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" required checked={consentPd} onChange={(e) => setConsentPd(e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="consent" />
                <span>
                  {t('consentPd')} (<a href="/legal/privacy" target="_blank" className="underline">↗</a>)
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={consentNotify} onChange={(e) => setConsentNotify(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>{t('consentNotify')}</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={consentWa} onChange={(e) => setConsentWa(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>{t('consentWa')}</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={consentMarketing} onChange={(e) => setConsentMarketing(e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="consent-marketing" />
                <span>{t('consentMarketing')}</span>
              </label>
            </div>
            <Summary />
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setStep('time')} className="tpl-surface tpl-border flex-1 rounded-xl border py-3">{t('back')}</button>
              <button type="submit" disabled={busy || !consentPd} className="tpl-btn flex-1 rounded-xl py-3 font-semibold disabled:opacity-40" data-testid="get-code">{t('getCode')}</button>
            </div>
          </form>
        )}

        {step === 'otp' && hold && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            <h1 className="mb-2 text-xl font-semibold">{t('step5')}</h1>
            <p className="tpl-muted mb-4 text-sm">{t('codeSent')} {hold.appointment.client.phone}</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              aria-label={t('code')}
              className="tpl-surface tpl-border w-full rounded-xl border px-4 py-3 text-center font-mono text-2xl tracking-[0.5em]"
              data-testid="otp"
            />
            <p className={`mt-3 text-center text-sm ${holdLeft < 60 ? 'text-rose-600' : 'tpl-muted'}`}>
              {holdLeft > 0 ? `${t('holdLeft')}: ${Math.floor(holdLeft / 60)}:${String(holdLeft % 60).padStart(2, '0')}` : t('holdExpired')}
            </p>
            <div className="tpl-surface tpl-border mt-4 rounded-xl border p-3 text-sm">
              <div>{dateTime(hold.appointment.startAt, data.branch.timezone, lang)}</div>
              {hold.appointment.items.map((i) => (
                <div key={i.id} className="tpl-muted">{i.serviceName}{i.specialistName ? ` · ${i.specialistName}` : ''}</div>
              ))}
              <div className="mt-1 font-semibold">{t('total')}: {money(hold.appointment.price.total)}</div>
            </div>
            <button type="submit" disabled={busy || code.length !== 6 || holdLeft === 0} className="tpl-btn mt-4 w-full rounded-xl py-3 font-semibold disabled:opacity-40" data-testid="confirm">{t('confirm')}</button>
            <div className="mt-3 flex justify-between text-sm">
              <button type="button" onClick={() => void resend()} className="tpl-primary underline">{t('resend')}</button>
              {hold.appointment.hold?.extensionCount === 0 && <button type="button" onClick={() => void extend()} className="tpl-primary underline">{t('extend')}</button>}
            </div>
          </form>
        )}

        {step === 'done' && done && (
          <section className="text-center" data-testid="booking-done">
            <div className="tpl-btn mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-3xl">✓</div>
            <h1 className="text-2xl font-semibold">{t('success')}</h1>
            <p className="tpl-muted mt-2 text-sm">{t('successText')}</p>
            <div className="tpl-surface tpl-border mt-5 rounded-xl border p-4 text-left text-sm">
              <div className="font-medium">{dateTime(done.appointment.startAt, data.branch.timezone, lang)}</div>
              {done.appointment.items.map((i) => (
                <div key={i.id} className="tpl-muted">{i.serviceName}{i.specialistName ? ` · ${i.specialistName}` : ''}</div>
              ))}
              <div className="mt-1 font-semibold">{money(done.appointment.price.total)}</div>
            </div>
            <Link href={`/${lang}/manage/${done.manageToken}`} className="tpl-btn mt-5 inline-block rounded-xl px-6 py-3 font-semibold" data-testid="manage-link">{t('manageLink')}</Link>
          </section>
        )}
      </div>
    </div>
  );
}
