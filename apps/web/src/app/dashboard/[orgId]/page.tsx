'use client';

import Link from 'next/link';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { Badge, Card, PageHeader, Spinner, statusTone } from '@/components/ui';
import type { ApptRow } from '@/components/dashboard/AppointmentDialogs';
import { addDays, localISODate, money, timeOnly, zonedStartOfDay } from '@/lib/format';

/** Главная панель: записи на сегодня и завтра по выбранному филиалу. */
export default function OverviewPage() {
  const { base, branch, org, can } = useOrg();
  const { t } = useT();
  const tz = branch?.timezone ?? 'Asia/Almaty';
  const today = localISODate(new Date(), tz);
  const from = zonedStartOfDay(today, tz);
  const to = zonedStartOfDay(addDays(today, 2), tz);
  const allowed = branch && can('appointments.view', branch.id);
  const { data, loading } = useApi<{ items: ApptRow[]; total: number }>(
    allowed ? `${base}/appointments?branchId=${branch.id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=pending_otp,confirmed,completed&pageSize=200` : null,
  );
  const items = data?.items ?? [];
  const byDay = (d: string) => items.filter((a) => localISODate(new Date(a.startAt), tz) === d);
  const revenueToday = byDay(today).filter((a) => a.status !== 'pending_otp').reduce((s, a) => s + a.totalPrice, 0);

  return (
    <div>
      <PageHeader title={org.name} subtitle={branch ? `${branch.name}${branch.address ? ` · ${branch.address}` : ''}` : undefined} />
      {!branch && <Card><p className="text-sm text-slate-600">{t('empty')} — <Link className="text-brand-700 underline" href={`/dashboard/${org.id}/branches`}>{t('branches')}</Link></p></Card>}
      {branch && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={t('today')}>
            <p className="text-3xl font-semibold">{byDay(today).length}</p>
            <p className="text-sm text-slate-500">{money(revenueToday)}</p>
          </Card>
          <Card title={t('tomorrow')}>
            <p className="text-3xl font-semibold">{byDay(addDays(today, 1)).length}</p>
          </Card>
          <Card title={t('openPage')}>
            <a className="break-all text-sm text-brand-700 underline" href={`/ru/b/${branch.slug}`} target="_blank" rel="noreferrer">/ru/b/{branch.slug}</a>
          </Card>
          <Card title={t('dashboardHint')} className="lg:col-span-3">
            {loading ? <Spinner /> : byDay(today).length === 0 ? <p className="text-sm text-slate-500">{t('empty')}</p> : (
              <ul className="divide-y divide-slate-100">
                {byDay(today).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="font-medium">{timeOnly(a.startAt, tz)}</span>
                    <span className="flex-1">{a.client.name} · {a.items.map((i) => i.serviceNameSnapshot).join(', ')}</span>
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
