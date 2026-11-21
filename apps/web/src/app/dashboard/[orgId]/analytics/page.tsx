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

const CHART_PX = 160;

/** Подпись периода: день — «19.11», неделя — «с 17.11», месяц — «11.2026». */
function bucketLabel(bucket: string, gran: 'day' | 'week' | 'month'): string {
  const [y, m, d] = bucket.slice(0, 10).split('-');
  if (gran === 'month') return `${m}.${y}`;
  return gran === 'week' ? `с ${d}.${m}` : `${d}.${m}`;
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
          <Field label={t('periodFrom')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('periodTo')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
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
          <Card
            title={`${t('pageViews')} / ${t('bookingsCreated')}`}
            actions={
              <div className="flex gap-3 text-xs text-slate-600">
                <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-500/70" />{t('pageViews')}</span>
                <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />{t('bookingsCreated')}</span>
              </div>
            }
          >
            {!data.series.length ? <p className="text-sm text-slate-500">{t('empty')}</p> : (
              <div className="overflow-x-auto">
                <div className="flex items-end gap-1" style={{ height: CHART_PX + 22, minWidth: data.series.length * 22 }} data-testid="analytics-chart">
                  {data.series.map((s, i) => (
                    <div key={s.bucket} className="flex min-w-[18px] flex-1 flex-col items-center" title={`${bucketLabel(s.bucket, gran)}: ${s.pageViews} / ${s.bookingsCreated}`}>
                      <div className="flex w-full items-end justify-center gap-px" style={{ height: CHART_PX }}>
                        <div className="w-1/2 rounded-t bg-brand-500/70" style={{ height: Math.round((s.pageViews / max) * CHART_PX) }} />
                        <div className="w-1/2 rounded-t bg-emerald-500" style={{ height: Math.round((s.bookingsCreated / max) * CHART_PX) }} />
                      </div>
                      {/* подписи через одну-две при большом числе столбцов, чтобы не наезжали */}
                      <span className="mt-1 h-4 whitespace-nowrap text-[10px] text-slate-400">
                        {i % Math.max(1, Math.ceil(data.series.length / 12)) === 0 ? bucketLabel(s.bucket, gran) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title={t('sources')}>
              <Table head={['', t('pageViews'), t('uniqueVisitors'), t('bookingsCreated')]} empty={!data.sources.length}>
                {data.sources.map((s) => <tr key={s.source}><Td>{s.source === 'direct' ? t('sourceDirect') : s.source}</Td><Td>{s.views}</Td><Td>{s.uniques}</Td><Td>{s.bookings}</Td></tr>)}
              </Table>
            </Card>
            <Card title={t('popularServices')}>
              <Table head={['', t('bookingsCount'), t('revenue')]} empty={!data.popularServices.length}>
                {data.popularServices.map((s) => <tr key={s.name}><Td>{s.name}</Td><Td>{s.count}</Td><Td>{money(s.revenue)}</Td></tr>)}
              </Table>
            </Card>
            <Card title={t('popularSpecialists')}>
              <Table head={['', t('bookingsCount')]} empty={!data.popularSpecialists.length}>
                {data.popularSpecialists.map((s) => <tr key={s.name ?? '-'}><Td>{s.name}</Td><Td>{s.count}</Td></tr>)}
              </Table>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
