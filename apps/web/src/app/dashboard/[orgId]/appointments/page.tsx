'use client';

import { useMemo, useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { Badge, Button, Card, Input, PageHeader, Select, Spinner, Table, Td, Tabs, statusTone } from '@/components/ui';
import { AppointmentActionsDialog, NewAppointmentDialog, type ApptRow } from '@/components/dashboard/AppointmentDialogs';
import { addDays, localISODate, money, timeOnly, zonedStartOfDay } from '@/lib/format';
import { apiPath, apiQuery } from '@/lib/api-path';

const STATUSES = ['', 'pending_otp', 'confirmed', 'completed', 'no_show', 'cancelled_by_client', 'cancelled_by_admin', 'expired_otp'];

/** Календарь и список записей филиала (§18.2). */
export default function AppointmentsPage() {
  const { base, branch, can } = useOrg();
  const { t, st } = useT();
  const tz = branch?.timezone ?? 'Asia/Almaty';
  const [date, setDate] = useState(localISODate(new Date(), tz));
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<ApptRow | null>(null);

  const from = zonedStartOfDay(date, tz);
  const to = zonedStartOfDay(addDays(date, 1), tz);
  const q = branch ? apiPath`${base}/appointments${apiQuery({ branchId: branch.id, from, to, pageSize: 200, status })}` : null;
  const { data, loading, reload } = useApi<{ items: ApptRow[] }>(q);
  const specialists = useApi<Array<{ id: string; name: string }>>(branch ? apiPath`${base}/branches/${branch.id}/specialists` : null);
  const canManage = can('appointments.manage', branch?.id);

  const columns = useMemo(() => {
    const cols = (specialists.data ?? []).map((s) => ({ id: s.id as string | null, name: s.name }));
    if ((data?.items ?? []).some((a) => a.items.some((i) => !i.specialistId))) cols.push({ id: null, name: '—' });
    return cols;
  }, [specialists.data, data]);

  const HOUR_START = 8;
  const HOURS = 15;
  const PX = 56;
  const minutesFrom = (iso: string) => {
    const [h, m] = timeOnly(iso, tz).split(':').map(Number);
    return (h! - HOUR_START) * 60 + m!;
  };

  return (
    <div>
      <PageHeader
        title={t('appointments')}
        actions={canManage && <Button onClick={() => setNewOpen(true)} data-testid="new-appointment">+ {t('newAppointment')}</Button>}
      />
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDate(addDays(date, -1))}>←</Button>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
          <Button variant="secondary" size="sm" onClick={() => setDate(addDays(date, 1))}>→</Button>
          <Button variant="ghost" size="sm" onClick={() => setDate(localISODate(new Date(), tz))}>{t('today')}</Button>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
            {STATUSES.map((s) => <option key={s} value={s}>{s ? st(s) : `${t('status')}: —`}</option>)}
          </Select>
        </div>
        <Tabs value={view} onChange={setView} items={[{ value: 'calendar', label: t('calendar') }, { value: 'list', label: t('appointments') }]} />
        {loading && <Spinner />}
        {!loading && view === 'calendar' && (
          <div className="overflow-x-auto">
            <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `56px repeat(${Math.max(columns.length, 1)}, minmax(140px, 1fr))` }}>
              <div />
              {columns.map((c) => <div key={c.id ?? 'none'} className="border-b border-slate-200 px-2 py-1 text-sm font-medium">{c.name}</div>)}
              <div className="relative" style={{ height: HOURS * PX }}>
                {Array.from({ length: HOURS }, (_, i) => (
                  <div key={i} className="absolute right-2 text-xs text-slate-400" style={{ top: i * PX - 6 }}>{String(HOUR_START + i).padStart(2, '0')}:00</div>
                ))}
              </div>
              {columns.map((c) => (
                <div key={c.id ?? 'none'} className="relative border-l border-slate-100" style={{ height: HOURS * PX }}>
                  {Array.from({ length: HOURS }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-slate-100" style={{ top: i * PX }} />)}
                  {(data?.items ?? []).flatMap((a) =>
                    a.items
                      .filter((i) => (i.specialistId ?? null) === c.id)
                      .map((i, k) => {
                        const top = (minutesFrom(i.startAt) / 60) * PX;
                        const height = Math.max(22, ((new Date(i.endAt).getTime() - new Date(i.startAt).getTime()) / 3600_000) * PX - 2);
                        return (
                          <button
                            key={`${a.id}-${k}`}
                            onClick={() => setSelected(a)}
                            className={`absolute inset-x-1 overflow-hidden rounded-md px-1.5 py-1 text-left text-xs shadow-sm ${a.status === 'confirmed' ? 'bg-brand-100 text-brand-900' : a.status === 'completed' ? 'bg-sky-100' : a.status === 'pending_otp' ? 'bg-amber-100' : 'bg-slate-100 text-slate-500 line-through'}`}
                            style={{ top, height }}
                          >
                            <b>{timeOnly(i.startAt, tz)}</b> {a.client.name}
                            <div className="truncate">{i.serviceNameSnapshot}</div>
                          </button>
                        );
                      }),
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {!loading && view === 'list' && (
          <Table head={[t('time'), t('client'), t('services'), t('specialist'), t('total'), t('status')]} empty={!data?.items.length}>
            {(data?.items ?? []).map((a) => (
              <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(a)}>
                <Td className="whitespace-nowrap">{timeOnly(a.startAt, tz)}–{timeOnly(a.endAt, tz)}</Td>
                <Td>{a.client.name}<div className="text-xs text-slate-500">{a.client.phone}</div></Td>
                <Td>{a.items.map((i) => i.serviceNameSnapshot).join(', ')}</Td>
                <Td>{[...new Set(a.items.map((i) => i.specialistNameSnapshot).filter(Boolean))].join(', ')}</Td>
                <Td>{money(a.totalPrice)}</Td>
                <Td><Badge tone={statusTone(a.status)}>{st(a.status)}</Badge></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <NewAppointmentDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={reload} />
      {selected && canManage && <AppointmentActionsDialog appt={selected} onClose={() => setSelected(null)} onChanged={reload} />}
    </div>
  );
}
