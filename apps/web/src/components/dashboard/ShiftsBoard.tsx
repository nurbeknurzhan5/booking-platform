'use client';

import { useState } from 'react';
import { useOrg } from './OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, ApiError, errorMessage } from '@/lib/api';
import { Alert, Button, Card, Field, Input, Modal, Spinner, cx } from '@/components/ui';
import { addDays, dateTime, formatPhone, localISODate, weekdayName } from '@/lib/format';

interface Shift {
  id: string;
  resourceId: string;
  date: string;
  startMinute: number;
  endMinute: number;
  breakStart: number | null;
  breakEnd: number | null;
}
interface ShiftsData {
  mode: 'weekly' | 'shifts';
  timezone: string;
  specialists: Array<{ id: string; name: string; resourceId: string; isActive: boolean }>;
  shifts: Shift[];
}
interface Conflict {
  appointmentId: string;
  startAt: string;
  endAt: string;
  clientName: string;
  clientPhone: string;
  services: string[];
  specialistName: string | null;
}
interface Status {
  mode: 'weekly' | 'shifts';
  tomorrow: null | { date: string; specialists: number; withShift: number; filled: boolean };
  conflicts: Conflict[];
}

const DAYS = 14;
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h! * 60 + (m ?? 0);
};

/** Список записей, которые окажутся вне смены. */
function ConflictList({ items, tz }: { items: Conflict[]; tz: string }) {
  return (
    <ul className="divide-y divide-amber-200 text-sm" data-testid="shift-conflicts">
      {items.map((c) => (
        <li key={c.appointmentId} className="py-1.5">
          <b>{dateTime(c.startAt, tz)}</b> · {c.clientName} {formatPhone(c.clientPhone)} · {c.services.join(', ')}
          {c.specialistName && <span className="text-slate-500"> · {c.specialistName}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Доска смен (задача 21): кто работает в какие даты. В режиме «по сменам» специалист доступен для записи только в
 * назначенную смену. Снятие или сокращение смены с записями — только после подтверждения со списком записей.
 */
export function ShiftsBoard({ branchId }: { branchId: string }) {
  const { base, branch, can, canManage } = useOrg();
  const { t, lang } = useT();
  const tz = branch?.timezone ?? 'Asia/Almaty';
  const today = localISODate(new Date(), tz);
  const [from, setFrom] = useState(today);
  const to = addDays(from, DAYS - 1);
  const data = useApi<ShiftsData>(`${base}/branches/${branchId}/shifts?from=${from}&to=${to}`);
  const status = useApi<Status>(`${base}/branches/${branchId}/shifts/status`);
  const canEdit = can('schedules.manage', branchId) && canManage;
  const [edit, setEdit] = useState<{ resourceId: string; name: string; date: string; start: string; end: string; brk: boolean; bStart: string; bEnd: string; exists: boolean } | null>(null);
  const [conflicts, setConflicts] = useState<{ items: Conflict[]; action: 'save' | 'remove' } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copy, setCopy] = useState<{ fromDate: string; toFrom: string; toTo: string } | null>(null);

  const dates = Array.from({ length: DAYS }, (_, i) => addDays(from, i));
  const reload = async () => {
    await Promise.all([data.reload(), status.reload()]);
  };
  const shiftOf = (resourceId: string, date: string) => data.data?.shifts.find((s) => s.resourceId === resourceId && s.date === date);

  const openCell = (resourceId: string, name: string, date: string) => {
    if (!canEdit) return;
    const s = shiftOf(resourceId, date);
    setConflicts(null);
    setErr(null);
    setEdit({
      resourceId,
      name,
      date,
      start: toTime(s?.startMinute ?? 600),
      end: toTime(s?.endMinute ?? 1200),
      brk: s?.breakStart !== null && s?.breakStart !== undefined,
      bStart: toTime(s?.breakStart ?? 780),
      bEnd: toTime(s?.breakEnd ?? 840),
      exists: !!s,
    });
  };

  async function submit(action: 'save' | 'remove', force = false) {
    if (!edit) return;
    setErr(null);
    try {
      if (action === 'save') {
        await api(`${base}/branches/${branchId}/shifts`, {
          method: 'PUT',
          body: {
            resourceId: edit.resourceId,
            date: edit.date,
            startMinute: toMin(edit.start),
            endMinute: toMin(edit.end),
            breakStart: edit.brk ? toMin(edit.bStart) : null,
            breakEnd: edit.brk ? toMin(edit.bEnd) : null,
            force,
          },
        });
      } else {
        await api(`${base}/branches/${branchId}/shifts/remove`, { method: 'POST', body: { resourceId: edit.resourceId, date: edit.date, force } });
      }
      setEdit(null);
      setConflicts(null);
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SHIFT_CONFLICT') {
        setConflicts({ items: ((e.details as { appointments?: Conflict[] })?.appointments ?? []), action });
      } else setErr(errorMessage(e));
    }
  }

  const run = async (fn: () => Promise<{ created?: number }>) => {
    setErr(null);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(`${t('saved')}${r.created !== undefined ? ` · ${t('shiftsCreated')}: ${r.created}` : ''}`);
      await reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  if (!data.data) return data.error ? <Alert>{data.error}</Alert> : <Spinner />;
  const d = data.data;

  return (
    <div className="space-y-4">
      {d.mode !== 'shifts' && <Alert tone="blue">{t('shiftsModeOff')}</Alert>}
      {status.data?.tomorrow && !status.data.tomorrow.filled && (
        <Alert tone="amber">
          <span data-testid="tomorrow-not-filled">{t('tomorrowNotFilled')}</span>
        </Alert>
      )}
      {status.data && status.data.conflicts.length > 0 && (
        <Alert tone="amber">
          <p className="mb-1 font-medium">{t('appointmentsOutsideShifts')}</p>
          <ConflictList items={status.data.conflicts} tz={tz} />
        </Alert>
      )}
      <Alert>{err}</Alert>
      {msg && <Alert tone="green">{msg}</Alert>}

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setFrom(addDays(from, -7))} aria-label="←">←</Button>
          <Button size="sm" variant="ghost" onClick={() => setFrom(today)}>{t('today')}</Button>
          <Button size="sm" variant="secondary" onClick={() => setFrom(addDays(from, 7))} aria-label="→">→</Button>
          {canEdit && (
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" data-testid="fill-weekly" onClick={() => run(() => api(`${base}/branches/${branchId}/shifts/fill`, { method: 'POST', body: { from, to } }))}>
                {t('fillFromWeekly')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setCopy({ fromDate: today, toFrom: addDays(today, 1), toTo: addDays(today, 7) })}>{t('copyDay')}</Button>
            </div>
          )}
        </div>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="min-w-full border-separate border-spacing-0 text-xs" data-testid="shifts-board">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left font-medium text-slate-500">{t('specialists')}</th>
                {dates.map((dt) => {
                  const wd = new Date(`${dt}T12:00:00Z`).getUTCDay() || 7;
                  return (
                    <th key={dt} className={cx('min-w-[76px] px-1 py-2 text-center font-medium', dt === today ? 'text-brand-700' : 'text-slate-500', wd >= 6 && 'bg-slate-50')}>
                      <div>{weekdayName(wd, lang).slice(0, 2)}</div>
                      <div>{dt.slice(8, 10)}.{dt.slice(5, 7)}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {d.specialists.length === 0 && (
                <tr><td colSpan={DAYS + 1} className="px-2 py-6 text-center text-slate-500">{t('noSpecialistsInBranch')}</td></tr>
              )}
              {d.specialists.map((sp) => (
                <tr key={sp.id}>
                  <td className="sticky left-0 z-10 whitespace-nowrap border-t border-slate-100 bg-white px-2 py-1.5 text-sm font-medium">{sp.name}</td>
                  {dates.map((dt) => {
                    const s = shiftOf(sp.resourceId, dt);
                    return (
                      <td key={dt} className="border-t border-slate-100 p-0.5">
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => openCell(sp.resourceId, sp.name, dt)}
                          data-testid={`shift-${sp.name}-${dt}`}
                          className={cx(
                            'w-full rounded-md px-1 py-2 text-center leading-tight transition-colors',
                            s ? 'bg-emerald-50 font-medium text-emerald-800 hover:bg-emerald-100' : 'text-slate-300 hover:bg-slate-100',
                          )}
                        >
                          {s ? (
                            <>
                              {toTime(s.startMinute)}
                              <br />
                              {toTime(s.endMinute)}
                            </>
                          ) : '—'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">{t('shiftsHint')}</p>
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `${edit.name} · ${edit.date.slice(8, 10)}.${edit.date.slice(5, 7)}` : ''}>
        {edit && (
          <div className="space-y-3">
            <Alert>{err}</Alert>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('shiftStart')}><Input type="time" value={edit.start} onChange={(e) => setEdit({ ...edit, start: e.target.value })} data-testid="shift-start" /></Field>
              <Field label={t('shiftEnd')}><Input type="time" value={edit.end} onChange={(e) => setEdit({ ...edit, end: e.target.value })} data-testid="shift-end" /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.brk} onChange={(e) => setEdit({ ...edit, brk: e.target.checked })} /> {t('breaks')}
            </label>
            {edit.brk && (
              <div className="grid grid-cols-2 gap-3">
                <Input type="time" value={edit.bStart} onChange={(e) => setEdit({ ...edit, bStart: e.target.value })} aria-label={t('shiftStart')} />
                <Input type="time" value={edit.bEnd} onChange={(e) => setEdit({ ...edit, bEnd: e.target.value })} aria-label={t('shiftEnd')} />
              </div>
            )}
            {conflicts && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3" role="alert">
                <p className="mb-2 text-sm font-medium text-amber-900">{t('shiftConflictTitle')}</p>
                <ConflictList items={conflicts.items} tz={tz} />
                <p className="mt-2 text-xs text-amber-900">{t('shiftConflictHint')}</p>
                <Button variant="danger" size="sm" className="mt-2" data-testid="shift-force" onClick={() => submit(conflicts.action, true)}>{t('shiftForce')}</Button>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-2 pt-1">
              {edit.exists ? <Button variant="ghost" onClick={() => submit('remove')} data-testid="shift-remove">{t('shiftRemove')}</Button> : <span />}
              <Button onClick={() => submit('save')} data-testid="shift-save">{t('save')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!copy} onClose={() => setCopy(null)} title={t('copyDay')}>
        {copy && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const toDates: string[] = [];
              for (let x = copy.toFrom; x <= copy.toTo && toDates.length < 62; x = addDays(x, 1)) toDates.push(x);
              void run(() => api(`${base}/branches/${branchId}/shifts/copy`, { method: 'POST', body: { fromDate: copy.fromDate, toDates } })).then(() => setCopy(null));
            }}
          >
            <Field label={t('copyFrom')}><Input type="date" value={copy.fromDate} onChange={(e) => setCopy({ ...copy, fromDate: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('periodFrom')}><Input type="date" value={copy.toFrom} onChange={(e) => setCopy({ ...copy, toFrom: e.target.value })} /></Field>
              <Field label={t('periodTo')}><Input type="date" value={copy.toTo} onChange={(e) => setCopy({ ...copy, toTo: e.target.value })} /></Field>
            </div>
            <p className="text-xs text-slate-500">{t('copyDayHint')}</p>
            <div className="flex justify-end"><Button type="submit">{t('copyDay')}</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
