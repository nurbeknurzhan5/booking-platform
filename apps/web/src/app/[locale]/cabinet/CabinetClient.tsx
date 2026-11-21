'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { AppointmentView, SlotsResponse } from '@/lib/types';
import { pt, type PublicKey } from '@/lib/i18n-public';
import { AppointmentCard } from '@/components/public/AppointmentCard';

interface Me {
  id: string;
  name: string;
  phone: string | null;
}
interface Profile {
  name: string;
  phone: string;
  locale: string;
  consents: { notifications: boolean; whatsapp: boolean; marketing: boolean };
}

interface WaitlistEntryView {
  id: string;
  status: 'waiting' | 'offered';
  dateFrom: string;
  dateTo: string;
  branch: { id: string; name: string; slug: string };
  services: Array<{ id: string; name: string }>;
  specialist: { id: string; name: string } | null;
}

type Tab = 'upcoming' | 'history' | 'cancelled' | 'waitlist' | 'profile';
const TAB_LABEL: Record<Tab, PublicKey> = { upcoming: 'upcoming', history: 'history', cancelled: 'cancelled', waitlist: 'waitlistTitle', profile: 'profile' };

/** Кабинет клиента (§18.1): вход по номеру телефона и OTP. */
export function CabinetClient({ lang }: { lang: string }) {
  const t = (k: PublicKey) => pt(lang, k);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [list, setList] = useState<AppointmentView[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [waitlist, setWaitlist] = useState<WaitlistEntryView[] | null>(null);

  useEffect(() => {
    // /auth/session отвечает 200 и гостю — без ошибки 401 в консоли браузера.
    api<(Me & { authenticated: true }) | { authenticated: false }>('/auth/session')
      .then((s) => setMe(s.authenticated ? s : null))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!me) return;
    if (tab === 'profile') {
      api<Profile>('/me/profile').then(setProfile).catch((e) => setError(errorMessage(e)));
      return;
    }
    if (tab === 'waitlist') {
      setWaitlist(null);
      api<WaitlistEntryView[]>('/me/waitlist').then(setWaitlist).catch((e) => setError(errorMessage(e)));
      return;
    }
    setList(null);
    api<AppointmentView[]>(`/me/appointments?scope=${tab}`).then(setList).catch((e) => setError(errorMessage(e)));
  }, [me, tab]);

  const actionsFor = useMemo(
    () => (a: AppointmentView) => ({
      fetchSlots: (date: string) =>
        api<SlotsResponse>(`/me/appointments/${a.id}/availability`, { method: 'POST', body: { date, items: a.items.map((i) => ({ serviceId: i.serviceId, specialistId: i.specialistId })) } }),
      reschedule: (startAt: string, key: string) => api<AppointmentView>(`/me/appointments/${a.id}/reschedule`, { method: 'POST', body: { startAt }, idempotencyKey: key }),
      cancel: (key: string) => api<AppointmentView>(`/me/appointments/${a.id}/cancel`, { method: 'POST', body: {}, idempotencyKey: key }),
      review: (rating: number, text: string) => api(`/me/appointments/${a.id}/review`, { method: 'POST', body: { rating, text: text || undefined } }),
    }),
    [],
  );

  if (me === undefined) return <main className="p-6 text-center text-slate-500">{t('loading')}</main>;

  if (me === null) {
    return (
      <main className="mx-auto max-w-sm px-4 py-10">
        <h1 className="mb-4 text-xl font-semibold">{t('cabinet')}</h1>
        {error && <p role="alert" className="mb-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              if (!codeSent) {
                await api('/auth/client/otp/request', { method: 'POST', body: { phone } });
                setCodeSent(true);
              } else {
                const r = await api<{ user: Me }>('/auth/client/otp/verify', { method: 'POST', body: { phone, code } });
                setMe(r.user);
              }
            } catch (err) {
              setError(err instanceof ApiError ? err.message : errorMessage(err));
            }
          }}
        >
          <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 7__ ___ __ __" className="w-full rounded-lg border px-3 py-2.5" disabled={codeSent} />
          {codeSent && (
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder={t('code')} className="w-full rounded-lg border px-3 py-2.5 text-center font-mono tracking-widest" />
          )}
          <button className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white">{codeSent ? t('login') : t('getCode')}</button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('cabinet')}</h1>
        <button
          onClick={async () => {
            await api('/auth/logout', { method: 'POST' });
            setMe(null);
          }}
          className="text-sm text-slate-500 underline"
        >
          {t('logout')}
        </button>
      </div>
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b">
        {(['upcoming', 'history', 'cancelled', 'waitlist', 'profile'] as Tab[]).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500'}`}>
            {t(TAB_LABEL[k])}
          </button>
        ))}
      </nav>
      {error && <p role="alert" className="mb-3 text-sm text-rose-600">{error}</p>}
      {tab === 'waitlist' && (
        <div className="space-y-3">
          {!waitlist && <p className="text-slate-500">{t('loading')}</p>}
          {waitlist?.length === 0 && <p className="text-slate-500">{t('empty')}</p>}
          {waitlist?.map((w) => (
            <div key={w.id} className="rounded-xl border p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link href={`/${lang}/b/${w.branch.slug}`} className="font-medium underline">{w.branch.name}</Link>
                  <div className="text-slate-600">{w.services.map((s) => s.name).join(', ')}{w.specialist ? ` · ${w.specialist.name}` : ''}</div>
                  <div className="text-slate-500">{w.dateFrom} — {w.dateTo}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs ${w.status === 'offered' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{t(w.status === 'offered' ? 'wl_offered' : 'wl_waiting')}</span>
              </div>
              <button
                type="button"
                className="mt-3 text-sm text-rose-600 underline"
                onClick={async () => {
                  setError(null);
                  try {
                    await api(`/me/waitlist/${w.id}/cancel`, { method: 'POST', body: {} });
                    setWaitlist((cur) => (cur ?? []).filter((x) => x.id !== w.id));
                  } catch (err) {
                    setError(errorMessage(err));
                  }
                }}
              >
                {t('waitlistLeave')}
              </button>
            </div>
          ))}
        </div>
      )}
      {tab !== 'profile' && tab !== 'waitlist' && (
        <div className="tpl space-y-3 rounded-xl">
          {!list && <p className="text-slate-500">{t('loading')}</p>}
          {list?.length === 0 && <p className="text-slate-500">{t('empty')}</p>}
          {list?.map((a) => <AppointmentCard key={a.id} initial={a} lang={lang} actions={actionsFor(a)} />)}
        </div>
      )}
      {tab === 'profile' && profile && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setSavedMsg(false);
            try {
              setProfile(await api<Profile>('/me/profile', { method: 'PATCH', body: { name: profile.name, locale: profile.locale, consents: profile.consents } }));
              setSavedMsg(true);
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <label className="block text-sm">
            {t('name')}
            <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <p className="text-sm text-slate-500">{t('phone')}: {profile.phone}</p>
          <label className="block text-sm">
            {t('language')}
            <select value={profile.locale} onChange={(e) => setProfile({ ...profile, locale: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2">
              <option value="ru">Русский</option>
              <option value="kk">Қазақша</option>
              <option value="en">English</option>
            </select>
          </label>
          <fieldset className="space-y-1 text-sm">
            <legend className="font-medium">{t('notifications')}</legend>
            <label className="flex gap-2"><input type="checkbox" checked={profile.consents.notifications} onChange={(e) => setProfile({ ...profile, consents: { ...profile.consents, notifications: e.target.checked } })} />{t('consentNotify')}</label>
            <label className="flex gap-2"><input type="checkbox" checked={profile.consents.whatsapp} onChange={(e) => setProfile({ ...profile, consents: { ...profile.consents, whatsapp: e.target.checked } })} />{t('consentWa')}</label>
            <label className="flex gap-2"><input type="checkbox" checked={profile.consents.marketing} onChange={(e) => setProfile({ ...profile, consents: { ...profile.consents, marketing: e.target.checked } })} data-testid="cabinet-marketing" />{t('consentMarketingAll')}</label>
          </fieldset>
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">{t('save')}</button>
          {savedMsg && <span className="ml-3 text-sm text-emerald-600">{t('saved')}</span>}
        </form>
      )}
      <p className="mt-8 text-center text-xs text-slate-400"><Link href="/">←</Link></p>
    </main>
  );
}
