'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { CalendarCheck2, CalendarClock, CalendarPlus, ExternalLink, Palette, PenLine, Scissors, Users, Wallet } from 'lucide-react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { Alert, Badge, Card, PageHeader, Spinner, statusTone } from '@/components/ui';
import type { ApptRow } from '@/components/dashboard/AppointmentDialogs';
import { addDays, localISODate, money, timeOnly, zonedStartOfDay } from '@/lib/format';
import { apiPath } from '@/lib/api-path';

/** Плитка показателя со значком. */
function Stat({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; tone: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <div className="text-sm text-slate-500">{label}</div>
        <div className="text-2xl font-semibold leading-tight">{value}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}

/** Главная панель: показатели, записи на сегодня и завтра, живое превью страницы филиала и быстрые действия. */
export default function OverviewPage() {
  const { base, branch, org, can } = useOrg();
  const { t, st } = useT();
  const tz = branch?.timezone ?? 'Asia/Almaty';
  const today = localISODate(new Date(), tz);
  const from = zonedStartOfDay(today, tz);
  const to = zonedStartOfDay(addDays(today, 2), tz);
  const allowed = branch && can('appointments.view', branch.id);
  const { data, loading } = useApi<{ items: ApptRow[]; total: number }>(
    allowed ? apiPath`${base}/appointments?branchId=${branch.id}&from=${from}&to=${to}&status=pending_otp,confirmed,completed&pageSize=200` : null,
  );
  // Предупреждения графика смен (задача 21): завтра не заполнено, записи вне смен
  const shifts = useApi<{ mode: string; tomorrow: null | { filled: boolean }; conflicts: Array<{ appointmentId: string }> }>(branch ? apiPath`${base}/branches/${branch.id}/shifts/status` : null);
  const items = data?.items ?? [];
  const byDay = (d: string) => items.filter((a) => localISODate(new Date(a.startAt), tz) === d);
  const revenue = (d: string) => byDay(d).filter((a) => a.status !== 'pending_otp').reduce((s, a) => s + a.totalPrice, 0);
  const tomorrow = addDays(today, 1);
  const list = (d: string) =>
    loading ? <Spinner /> : byDay(d).length === 0 ? <p className="text-sm text-slate-500">{t('empty')}</p> : (
      <ul className="divide-y divide-slate-100">
        {byDay(d).map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="font-medium">{timeOnly(a.startAt, tz)}</span>
            <span className="flex-1">{a.client.name} · {a.items.map((i) => i.serviceNameSnapshot).join(', ')}</span>
            <Badge tone={statusTone(a.status)}>{st(a.status)}</Badge>
          </li>
        ))}
      </ul>
    );

  return (
    <div>
      <PageHeader title={org.name} subtitle={branch ? `${branch.name}${branch.address ? ` · ${branch.address}` : ''}` : undefined} />
      {!branch && <Card><p className="text-sm text-slate-600">{t('empty')} — <Link className="text-brand-700 underline" href={`/dashboard/${org.id}/branches`}>{t('branches')}</Link></p></Card>}
      {shifts.data?.tomorrow && !shifts.data.tomorrow.filled && (
        <div className="mb-4"><Alert tone="amber">{t('tomorrowNotFilled')} <Link className="font-medium underline" href={`/dashboard/${org.id}/schedule`}>{t('resourcesSchedule')} →</Link></Alert></div>
      )}
      {!!shifts.data?.conflicts.length && (
        <div className="mb-4"><Alert tone="amber">{t('appointmentsOutsideShifts')} {shifts.data.conflicts.length}. <Link className="font-medium underline" href={`/dashboard/${org.id}/schedule`}>{t('resourcesSchedule')} →</Link></Alert></div>
      )}
      {branch && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat icon={<CalendarCheck2 className="h-6 w-6" />} tone="bg-brand-50 text-brand-600" label={t('today')} value={byDay(today).length} hint={money(revenue(today))} />
            <Stat icon={<CalendarClock className="h-6 w-6" />} tone="bg-sky-50 text-sky-600" label={t('tomorrow')} value={byDay(tomorrow).length} hint={money(revenue(tomorrow))} />
            <Stat icon={<Wallet className="h-6 w-6" />} tone="bg-emerald-50 text-emerald-600" label={t('revenueTwoDays')} value={money(revenue(today) + revenue(tomorrow))} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card title={t('dashboardHint')} actions={<Link className="text-sm font-medium text-brand-700 hover:underline" href={`/dashboard/${org.id}/appointments`}>{t('appointments')} →</Link>}>{list(today)}</Card>
              <Card title={t('tomorrowAppointments')}>{list(tomorrow)}</Card>
            </div>
            <div className="space-y-4">
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <a href={`/ru/b/${branch.slug}`} target="_blank" rel="noreferrer" className="relative block h-[220px] overflow-hidden bg-slate-100" aria-label={t('openPage')}>
                  <iframe title="page" src={`/ru/b/${branch.slug}`} loading="lazy" tabIndex={-1} className="pointer-events-none absolute left-0 top-0 h-[880px] w-[1280px] origin-top-left scale-[0.25] sm:scale-[0.3] lg:scale-[0.27]" />
                </a>
                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold">{t('yourPage')}</h2>
                    <a className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline" href={`/ru/b/${branch.slug}`} target="_blank" rel="noreferrer">{t('openPage')} <ExternalLink className="h-3.5 w-3.5" /></a>
                  </div>
                  <p className="break-all text-xs text-slate-500">/ru/b/{branch.slug}</p>
                  <div className="flex flex-wrap gap-2">
                    {can('pages.edit', branch.id) && <QuickLink href={`/dashboard/${org.id}/themes`} icon={<Palette className="h-4 w-4" />}>{t('themesTitle')}</QuickLink>}
                    {can('pages.edit', branch.id) && <QuickLink href={`/dashboard/${org.id}/branches/${branch.id}/page-editor`} icon={<PenLine className="h-4 w-4" />}>{t('editPage')}</QuickLink>}
                  </div>
                </div>
              </section>
              <Card title={t('quickActions')}>
                <div className="grid grid-cols-2 gap-2">
                  {can('appointments.view', branch.id) && <QuickLink href={`/dashboard/${org.id}/appointments`} icon={<CalendarPlus className="h-4 w-4" />}>{t('appointments')}</QuickLink>}
                  <QuickLink href={`/dashboard/${org.id}/schedule`} icon={<CalendarClock className="h-4 w-4" />}>{t('resourcesSchedule')}</QuickLink>
                  <QuickLink href={`/dashboard/${org.id}/services`} icon={<Scissors className="h-4 w-4" />}>{t('services')}</QuickLink>
                  <QuickLink href={`/dashboard/${org.id}/specialists`} icon={<Users className="h-4 w-4" />}>{t('specialists')}</QuickLink>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
      <span className="text-slate-400">{icon}</span>
      {children}
    </Link>
  );
}
