'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { pt, type PublicKey } from '@/lib/i18n-public';
import { dateTime, minutesLabel, money } from '@/lib/format';

interface OfferView {
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'lost';
  startAt: string;
  endAt: string;
  expiresAt: string;
  branch: { id: string; name: string; slug: string; timezone: string };
  services: Array<{ id: string; name: string; durationMinutes: number }>;
  specialist: { id: string; name: string } | null;
  totalPrice: number | null;
}

const STATUS_TEXT: Record<Exclude<OfferView['status'], 'pending'>, PublicKey> = {
  accepted: 'offerAccepted',
  declined: 'offerDeclined',
  expired: 'offerExpired',
  cancelled: 'offerClosed',
  lost: 'offerClosed',
};

/** Предложение освободившегося времени из листа ожидания (§9): записаться или отказаться. */
export function WaitlistOfferClient({ token, lang }: { token: string; lang: string }) {
  const t = (k: PublicKey) => pt(lang, k);
  const router = useRouter();
  const { data, setData, error: loadError, loading } = useApi<OfferView>(`/public/waitlist-offers/${token}`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(false);

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ manageToken: string }>(`/public/waitlist-offers/${token}/accept`, { method: 'POST', body: {} });
      router.push(`/${lang}/manage/${r.manageToken}`);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && ['WAITLIST_OFFER_CLOSED', 'WAITLIST_OFFER_EXPIRED', 'SLOT_UNAVAILABLE'].includes(e.code)) {
        setData(await api<OfferView>(`/public/waitlist-offers/${token}`).catch(() => data));
      }
      setBusy(false);
    }
  }

  async function decline(leaveWaitlist: boolean) {
    setError(null);
    setBusy(true);
    try {
      setData(await api<OfferView>(`/public/waitlist-offers/${token}/decline`, { method: 'POST', body: { leaveWaitlist } }));
      if (leaveWaitlist) setLeft(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="tpl min-h-screen px-4 py-6">
      <div className="mx-auto max-w-xl">
        <h1 className="mb-2 text-xl font-semibold">{t('offerTitle')}</h1>
        {loading && <p className="tpl-muted">{t('loading')}</p>}
        {loadError && <p className="text-rose-600">{loadError}</p>}
        {error && <div role="alert" className="mb-4 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-800">{error}</div>}
        {data && (
          <>
            {data.status === 'pending' && <p className="tpl-muted mb-4 text-sm">{t('offerText')}</p>}
            <div className="tpl-surface tpl-border rounded-xl border p-4 text-sm" data-testid="offer-card">
              <div className="font-medium">{data.branch.name}</div>
              <div className="mt-1 text-base font-semibold">{dateTime(data.startAt, data.branch.timezone, lang)}</div>
              {data.services.map((s) => (
                <div key={s.id} className="tpl-muted">{s.name} · {minutesLabel(s.durationMinutes, lang)}</div>
              ))}
              {data.specialist && <div className="tpl-muted">{data.specialist.name}</div>}
              {data.totalPrice !== null && <div className="mt-1 font-semibold">{t('total')}: {money(data.totalPrice)}</div>}
              {data.status === 'pending' && (
                <div className="mt-2 text-amber-700">{t('offerValidUntil')}: {dateTime(data.expiresAt, data.branch.timezone, lang)}</div>
              )}
            </div>

            {data.status === 'pending' ? (
              <div className="mt-4 space-y-2">
                <button type="button" disabled={busy} onClick={() => void accept()} className="tpl-btn w-full rounded-xl py-3 font-semibold disabled:opacity-40" data-testid="offer-accept">
                  {t('offerAccept')}
                </button>
                <button type="button" disabled={busy} onClick={() => void decline(false)} className="tpl-surface tpl-border w-full rounded-xl border py-3" data-testid="offer-decline">
                  {t('offerDecline')}
                </button>
              </div>
            ) : (
              <p className="mt-4 text-sm" data-testid="offer-status">{left ? t('waitlistLeft') : t(STATUS_TEXT[data.status])}</p>
            )}
            <div className="mt-6 flex flex-col items-start gap-2 text-sm">
              {!left && data.status !== 'accepted' && (
                <button type="button" disabled={busy} onClick={() => void decline(true)} className="tpl-primary underline">{t('waitlistLeave')}</button>
              )}
              <Link href={`/${lang}/b/${data.branch.slug}`} className="tpl-primary underline">{data.branch.name}</Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
