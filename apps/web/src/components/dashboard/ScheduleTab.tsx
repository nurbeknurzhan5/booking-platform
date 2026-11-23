'use client';

import { useEffect, useState } from 'react';
import { useOrg } from './OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Button, Card, Field, Input, Select, Spinner } from '@/components/ui';
import { weekdayName } from '@/lib/format';

interface Interval {
  start: string;
  end: string;
}
interface Day {
  weekday: number;
  intervals: Interval[];
  breaks: Interval[];
}
interface Schedule {
  resourceId: string | null;
  inheritsBranch: boolean;
  days: Day[];
  exceptions: Array<{ id: string; dateFrom: string; dateTo: string; kind: string; intervals: Interval[]; reason: string | null }>;
}

/** Расписание филиала и ресурсов: недельные часы, перерывы, исключения (§7). */
export function ScheduleTab({ branchId }: { branchId: string }) {
  const { base, can, canManage } = useOrg();
  const { t, lang } = useT();
  const resources = useApi<Array<{ id: string; name: string; type: string }>>(`${base}/branches/${branchId}/resources`);
  const specialists = useApi<Array<{ id: string; name: string; resourceId: string }>>(`${base}/branches/${branchId}/specialists`);
  const [resourceId, setResourceId] = useState<string>('');
  const sched = useApi<Schedule>(`${base}/branches/${branchId}/schedule${resourceId ? `?resourceId=${resourceId}` : ''}`);
  const [days, setDays] = useState<Day[]>([]);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [ex, setEx] = useState({ dateFrom: '', dateTo: '', kind: 'closed', start: '10:00', end: '14:00', reason: '' });
  const canEdit = can('schedules.manage', branchId) && canManage;

  useEffect(() => {
    if (sched.data) setDays(sched.data.days);
  }, [sched.data]);

  const setDay = (wd: number, patch: Partial<Day>) => setDays(days.map((d) => (d.weekday === wd ? { ...d, ...patch } : d)));
  const owners = [
    { id: '', name: `🏢 ${t('branch')}` },
    ...(specialists.data ?? []).map((s) => ({ id: s.resourceId, name: `👤 ${s.name}` })),
    ...(resources.data ?? []).map((r) => ({ id: r.id, name: `📦 ${r.name}` })),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <Field label={t('schedule')} className="mb-4 max-w-sm">
          <Select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
        {sched.loading ? <Spinner /> : (
          <>
            {sched.data?.inheritsBranch && <Alert tone="blue">{t('inheritsBranch')}</Alert>}
            <Alert>{msg.err}</Alert>
            {msg.ok && <Alert tone="green">{msg.ok}</Alert>}
            <div className="mt-3 divide-y divide-slate-100">
              {days.map((d) => (
                <div key={d.weekday} className="grid items-center gap-2 py-2 sm:grid-cols-[140px_1fr_1fr]">
                  <span className="text-sm font-medium capitalize">{weekdayName(d.weekday, lang)}</span>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {d.intervals.length === 0 && <span className="text-slate-400">{t('dayOff')}</span>}
                    {d.intervals.map((iv, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <Input type="time" value={iv.start} disabled={!canEdit} onChange={(e) => setDay(d.weekday, { intervals: d.intervals.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)) })} className="w-28" />–
                        <Input type="time" value={iv.end} disabled={!canEdit} onChange={(e) => setDay(d.weekday, { intervals: d.intervals.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)) })} className="w-28" />
                        {canEdit && <button className="text-slate-400 hover:text-rose-600" onClick={() => setDay(d.weekday, { intervals: d.intervals.filter((_, k) => k !== i) })}>×</button>}
                      </span>
                    ))}
                    {canEdit && <Button size="sm" variant="ghost" aria-label={t('addInterval')} title={t('addInterval')} data-testid={`add-interval-${d.weekday}`} onClick={() => setDay(d.weekday, { intervals: [...d.intervals, { start: '10:00', end: '20:00' }] })}>+</Button>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs text-slate-500">{t('breaks')}:</span>
                    {d.breaks.map((iv, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <Input type="time" value={iv.start} disabled={!canEdit} onChange={(e) => setDay(d.weekday, { breaks: d.breaks.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)) })} className="w-28" />–
                        <Input type="time" value={iv.end} disabled={!canEdit} onChange={(e) => setDay(d.weekday, { breaks: d.breaks.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)) })} className="w-28" />
                        {canEdit && <button className="text-slate-400 hover:text-rose-600" onClick={() => setDay(d.weekday, { breaks: d.breaks.filter((_, k) => k !== i) })}>×</button>}
                      </span>
                    ))}
                    {canEdit && <Button size="sm" variant="ghost" aria-label={t('addBreak')} title={t('addBreak')} onClick={() => setDay(d.weekday, { breaks: [...d.breaks, { start: '13:00', end: '14:00' }] })}>+</Button>}
                  </div>
                </div>
              ))}
            </div>
            {canEdit && (
              <div className="mt-3 flex flex-wrap justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="copy-monday"
                    onClick={() => {
                      const mon = days.find((d) => d.weekday === 1);
                      if (mon) setDays(days.map((d) => ({ ...d, intervals: mon.intervals.map((x) => ({ ...x })), breaks: mon.breaks.map((x) => ({ ...x })) })));
                    }}
                  >
                    {t('copyMondayAll')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const mon = days.find((d) => d.weekday === 1);
                      if (mon) setDays(days.map((d) => (d.weekday <= 5 ? { ...d, intervals: mon.intervals.map((x) => ({ ...x })), breaks: mon.breaks.map((x) => ({ ...x })) } : d)));
                    }}
                  >
                    {t('copyMondayWeekdays')}
                  </Button>
                </div>
                <Button
                  onClick={async () => {
                    setMsg({});
                    try {
                      await api(`${base}/branches/${branchId}/schedule/weekly`, { method: 'PUT', body: { resourceId: resourceId || null, days } });
                      setMsg({ ok: t('saved') });
                      await sched.reload();
                    } catch (e) {
                      setMsg({ err: errorMessage(e) });
                    }
                  }}
                  data-testid="save-schedule"
                >
                  {t('save')}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
      <Card title={t('exceptions')}>
        <ul className="mb-4 divide-y divide-slate-100 text-sm">
          {(sched.data?.exceptions ?? []).map((e) => (
            <li key={e.id} className="flex items-center justify-between py-2">
              <span>
                {e.dateFrom}{e.dateTo !== e.dateFrom ? ` — ${e.dateTo}` : ''} · {e.kind === 'closed' ? t('closedDay') : `${t('customHours')}: ${e.intervals.map((i) => `${i.start}–${i.end}`).join(', ')}`}
                {e.reason ? ` · ${e.reason}` : ''}
              </span>
              {canEdit && <button className="text-rose-600" onClick={async () => { await api(`${base}/branches/${branchId}/schedule/exceptions/${e.id}`, { method: 'DELETE' }); await sched.reload(); }}>{t('delete')}</button>}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form
            className="grid gap-2 sm:grid-cols-6"
            onSubmit={async (e) => {
              e.preventDefault();
              setMsg({});
              try {
                await api(`${base}/branches/${branchId}/schedule/exceptions`, {
                  method: 'POST',
                  body: { resourceId: resourceId || null, dateFrom: ex.dateFrom, dateTo: ex.dateTo || ex.dateFrom, kind: ex.kind, intervals: ex.kind === 'custom_hours' ? [{ start: ex.start, end: ex.end }] : [], reason: ex.reason || undefined },
                });
                await sched.reload();
              } catch (err) {
                setMsg({ err: errorMessage(err) });
              }
            }}
          >
            <Input type="date" required value={ex.dateFrom} onChange={(e) => setEx({ ...ex, dateFrom: e.target.value })} />
            <Input type="date" value={ex.dateTo} onChange={(e) => setEx({ ...ex, dateTo: e.target.value })} />
            <Select value={ex.kind} onChange={(e) => setEx({ ...ex, kind: e.target.value })}>
              <option value="closed">{t('closedDay')}</option>
              <option value="custom_hours">{t('customHours')}</option>
            </Select>
            {ex.kind === 'custom_hours' ? (
              <div className="flex gap-1 sm:col-span-2">
                <Input type="time" value={ex.start} onChange={(e) => setEx({ ...ex, start: e.target.value })} />
                <Input type="time" value={ex.end} onChange={(e) => setEx({ ...ex, end: e.target.value })} />
              </div>
            ) : (
              <Input placeholder={t('reason')} value={ex.reason} onChange={(e) => setEx({ ...ex, reason: e.target.value })} className="sm:col-span-2" />
            )}
            <Button type="submit" variant="secondary">{t('add')}</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
