'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { pt, type PublicKey } from '@/lib/i18n-public';
import { dateTime, money } from '@/lib/format';
import type { AppointmentView } from '@/lib/types';
import { apiPath } from '@/lib/api-path';

type State = { kind: 'loading' } | { kind: 'ok'; appointment: AppointmentView; manageToken: string } | { kind: 'error'; message: PublicKey; slug?: string };

/**
 * Подтверждение записи по ссылке из сообщения (D-42). Запрос отправляется скриптом после открытия страницы,
 * а не самим GET-запросом: предпросмотр ссылок в мессенджерах не подтвердит запись за клиента.
 */
export function ConfirmClient({ token, lang }: { token: string; lang: string }) {
  const t = (k: PublicKey) => pt(lang, k);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    api<{ appointment: AppointmentView; manageToken: string }>(apiPath`/public/bookings/confirm-link`, { method: 'POST', body: { token } })
      .then((r) => setState({ kind: 'ok', ...r }))
      .catch((e) => {
        const code = e instanceof ApiError ? e.code : '';
        const message: PublicKey = code === 'HOLD_EXPIRED' || code === 'OTP_EXPIRED' ? 'linkExpired' : code === 'OTP_USED' || code === 'CONFLICT' ? 'linkUsed' : 'linkInvalid';
        setState({ kind: 'error', message });
      });
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm" data-testid="confirm-page">
        {state.kind === 'loading' && (
          <>
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
            <h1 className="text-lg font-semibold">{t('confirmingTitle')}</h1>
          </>
        )}
        {state.kind === 'ok' && (
          <div data-testid="confirm-ok">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-3xl text-white">✓</div>
            <h1 className="text-2xl font-semibold">{t('confirmedTitle')}</h1>
            <div className="mt-5 rounded-xl border border-slate-200 p-4 text-left text-sm">
              <div className="font-semibold">{state.appointment.branch.name}</div>
              {state.appointment.branch.address && <div className="text-slate-500">{state.appointment.branch.address}</div>}
              <div className="mt-2 font-medium">{dateTime(state.appointment.startAt, state.appointment.timezone, lang)}</div>
              {state.appointment.items.map((i) => (
                <div key={i.id} className="text-slate-600">
                  {i.serviceName}
                  {i.seats && i.seats > 1 ? ` × ${i.seats}` : ''}
                  {i.specialistName ? ` · ${i.specialistName}` : ''}
                  {i.places?.length ? ` · ${i.places.join(', ')}` : ''}
                </div>
              ))}
              <div className="mt-2 font-semibold">{t('total')}: {money(state.appointment.price.total)}</div>
            </div>
            <Link href={`/${lang}/manage/${state.manageToken}`} className="mt-5 inline-block rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700" data-testid="manage-link">
              {t('manageLink')}
            </Link>
          </div>
        )}
        {state.kind === 'error' && (
          <div data-testid="confirm-error">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl text-amber-600">!</div>
            <p className="text-sm text-slate-700">{t(state.message)}</p>
            <Link href="/" className="mt-5 inline-block text-sm font-medium text-brand-700 underline">{t('back')}</Link>
          </div>
        )}
      </div>
    </main>
  );
}
