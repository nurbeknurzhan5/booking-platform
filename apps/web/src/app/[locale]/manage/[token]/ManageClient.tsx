'use client';

import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import type { AppointmentView, SlotsResponse } from '@/lib/types';
import { pt } from '@/lib/i18n-public';
import { AppointmentCard, type AppointmentActions } from '@/components/public/AppointmentCard';

/** Управление гостевой записью по секретной ссылке (решение D-11). */
export function ManageClient({ token, lang }: { token: string; lang: string }) {
  const { data, error, loading } = useApi<AppointmentView>(`/public/manage/${token}`);
  const base = `/public/manage/${token}`;
  const actions = useMemo<AppointmentActions>(
    () => ({
      fetchSlots: (date) =>
        api<SlotsResponse>(`${base}/availability`, {
          method: 'POST',
          body: { date, items: (data?.items ?? []).map((i) => ({ serviceId: i.serviceId, specialistId: i.specialistId })) },
        }),
      reschedule: (startAt, key) => api<AppointmentView>(`${base}/reschedule`, { method: 'POST', body: { startAt }, idempotencyKey: key }),
      cancel: (key) => api<AppointmentView>(`${base}/cancel`, { method: 'POST', body: {}, idempotencyKey: key }),
      review: (rating, text) => api(`${base}/review`, { method: 'POST', body: { rating, text: text || undefined } }),
    }),
    [base, data],
  );
  return (
    <main className="tpl min-h-screen px-4 py-6">
      <div className="mx-auto max-w-xl">
        <h1 className="mb-4 text-xl font-semibold">{pt(lang, 'yourBooking')}</h1>
        {loading && <p className="tpl-muted">{pt(lang, 'loading')}</p>}
        {error && <p className="text-rose-600">{error}</p>}
        {data && <AppointmentCard initial={data} lang={lang} actions={actions} />}
      </div>
    </main>
  );
}
