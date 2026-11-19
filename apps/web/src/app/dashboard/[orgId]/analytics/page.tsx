'use client';

import { useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT, type DashKey } from '@/lib/i18n-dashboard';
import { Card, Field, Input, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { addDays, localISODate, money } from '@/lib/format';

interface Report {
  totals: Record<'pageViews' | 'uniqueVisitors' | 'bookingClicks' | 'bookingStarts' | 'bookingsCreated' | 'cancellations', number> & { conversionVisitorToBooking: number; conversionClickToBooking: number };
  series: Array<{ bucket: string; pageViews: number; uniqueVisitors: number; bookingsCreated: number }>;
  sources: Array<{ source: string; views: number; uniques: number; bookings: number }>;
  popularServices: Array<{ name: string; count: number; revenue: number }>;
  popularSpecialists: Array<{ name: string | null; count: number }>;
  appointmentsByStatus: Record<string, number>;
}

/** Аналитика публичной страницы и записей (§17). Внутренние просмотры и боты исключены. */
export default function AnalyticsPage() {
  const { base, branch } = useOrg();
  const { t } = useT();
  const today = localISODate(new Date(), branch?.timezone ?? 'Asia/Almaty');
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [gran, setGran] = useState<'day' | 'week' | 'month'>('day');
  const { data, loading } = useApi<Report>(branch ? `${base}/analytics?branchId=${branch.id}&from=${from}&to=${to}&granularity=${gran}` : null);
  const max = Math.max(1, ...(data?.series ?? []).map((s) => s.pageViews));
  const kpis: Array<[DashKey, string | number]> = data
    ? [
        ['pageViews', data.totals.pageViews],
        ['uniqueVisitors', data.totals.uniqueVisitors],
        ['bookingClicks', data.totals.bookingClicks],
        ['bookingStarts', data.totals.bookingStarts],
        ['bookingsCreated', data.totals.bookingsCreated],
        ['cancellations', data.totals.cancellations],
        ['conversion', `${data.totals.conversionVisitorToBooking}%`],
      ]
    : [];

  return (
    <div>
      <PageHeader title={t('analytics')} subtitle={branch?.name} />
      <Card className="mb-4">
        <div className="flex flex-wrap gap-3">
          <Field label={t('validFrom')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('validTo')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label={t('period')}>
            <Select value={gran} onChange={(e) => setGran(e.target.value as 'day')}>
              <option value="day">{t('byDay')}</option>
              <option value="week">{t('byWeek')}</option>
              <option value="month">{t('byMonth')}</option>
            </Select>
          </Field>
        </div>
      </Card>
      {loading || !data ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {kpis.map(([k, v]) => (
              <Card key={k}><p className="text-xs text-slate-500">{t(k)}</p><p className="text-2xl font-semibold">{v}</p></Card>
            ))}
          </div>
          <Card title={`${t('pageViews')} / ${t('bookingsCreated')}`}>
            <div className="flex h-48 items-end gap-1 overflow-x-auto">
              {data.series.map((s) => (
                <div key={s.bucket} className="flex min-w-[18px] flex-1 flex-col items-center justify-end gap-0.5" title={`${s.bucket}: ${s.pageViews} / ${s.bookingsCreated}`}>
                  <div className="w-full rounded-t bg-brand-500/70" style={{ height: `${(s.pageViews / max) * 100}%` }} />
                  <div className="w-full rounded-t bg-emerald-500" style={{ height: `${(s.bookingsCreated / max) * 100}%` }} />
                  <span className="mt-1 rotate-[-60deg] whitespace-nowrap text-[9px] text-slate-400">{s.bucket.slice(5)}</span>
                </div>
              ))}
              {!data.series.length && <p className="text-sm text-slate-500">{t('empty')}</p>}
            </div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title={t('sources')}>
              <Table head={['', t('pageViews'), t('uniqueVisitors'), t('bookingsCreated')]} empty={!data.sources.length}>
                {data.sources.map((s) => <tr key={s.source}><Td>{s.source}</Td><Td>{s.views}</Td><Td>{s.uniques}</Td><Td>{s.bookings}</Td></tr>)}
              </Table>
            </Card>
            <Card title={t('popularServices')}>
              <Table head={['', '#', '₸']} empty={!data.popularServices.length}>
                {data.popularServices.map((s) => <tr key={s.name}><Td>{s.name}</Td><Td>{s.count}</Td><Td>{money(s.revenue)}</Td></tr>)}
              </Table>
            </Card>
            <Card title={t('popularSpecialists')}>
              <Table head={['', '#']} empty={!data.popularSpecialists.length}>
                {data.popularSpecialists.map((s) => <tr key={s.name ?? '-'}><Td>{s.name}</Td><Td>{s.count}</Td></tr>)}
              </Table>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
