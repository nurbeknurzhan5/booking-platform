'use client';

import { useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import type { ServiceRow, SpecialistRow } from '@/components/dashboard/AppointmentDialogs';
import { useApi } from '@/lib/hooks';
import { useT, type DashKey } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Checkbox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';

interface Entry {
  id: string;
  status: 'waiting' | 'offered' | 'booked' | 'cancelled' | 'expired' | 'pending_otp';
  source: string;
  priority: number;
  dateFrom: string;
  dateTo: string;
  services: Array<{ id: string; name: string }>;
  specialist: { id: string; name: string } | null;
  client: { id: string; name: string; phone: string };
  offerExpiresAt: string | null;
  createdAt: string;
}
interface Page {
  total: number;
  items: Entry[];
}
interface Rules {
  waitlistEnabled: boolean;
}

const TONE: Record<Entry['status'], 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  waiting: 'blue',
  offered: 'amber',
  booked: 'green',
  cancelled: 'slate',
  expired: 'slate',
  pending_otp: 'slate',
};

/** Лист ожидания филиала (§9): очередь, приоритет, ручное добавление и удаление. */
export default function WaitlistPage() {
  const { base, branch, can, isOwner } = useOrg();
  const { t } = useT();
  const [status, setStatus] = useState<'active' | Entry['status']>('active');
  const query = branch ? `${base}/waitlist?branchId=${branch.id}&pageSize=100&status=${status}` : null;
  const list = useApi<Page>(query);
  const rules = useApi<Rules>(branch && isOwner ? `${base}/branches/${branch.id}/booking-settings` : null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const manage = branch ? can('appointments.manage', branch.id) : false;
  const rows = list.data?.items ?? [];

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader title={t('waitlist')} subtitle={t('wlHint')} actions={manage && <Button onClick={() => setAdding(true)}>{t('addToWaitlist')}</Button>} />
      {rules.data && !rules.data.waitlistEnabled && <div className="mb-3"><Alert tone="amber">{t('wlDisabled')}</Alert></div>}
      <Alert>{error}</Alert>
      <div className="mb-3 max-w-xs">
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label={t('status')}>
          <option value="active">{t('wl_waiting')} / {t('wl_offered')}</option>
          {(['booked', 'cancelled', 'expired'] as const).map((s) => <option key={s} value={s}>{t(`wl_${s}` as DashKey)}</option>)}
        </Select>
      </div>
      {list.loading ? <Spinner /> : (
        <Table head={[t('client'), t('services'), t('dates'), t('priority'), t('status'), '']} empty={rows.length === 0}>
          {rows.map((e) => (
            <tr key={e.id} className="border-t border-slate-100">
              <Td>
                <div className="font-medium">{e.client.name}</div>
                <div className="text-xs text-slate-500">{e.client.phone}</div>
              </Td>
              <Td>
                {e.services.map((s) => s.name).join(', ')}
                <div className="text-xs text-slate-500">{e.specialist ? e.specialist.name : t('anySpecialist')}</div>
              </Td>
              <Td className="whitespace-nowrap">{e.dateFrom} — {e.dateTo}</Td>
              <Td>
                {manage && (e.status === 'waiting' || e.status === 'offered') ? (
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={e.priority}
                    className="w-20"
                    aria-label={t('priority')}
                    onBlur={(ev) => {
                      const v = Number(ev.target.value);
                      if (v !== e.priority && Number.isInteger(v) && v >= 0 && v <= 100) void act(() => api(`${base}/waitlist/${e.id}`, { method: 'PATCH', body: { priority: v } }));
                    }}
                  />
                ) : e.priority}
              </Td>
              <Td>
                <Badge tone={TONE[e.status]}>{t(`wl_${e.status}` as DashKey)}</Badge>
                {e.status === 'offered' && e.offerExpiresAt && <div className="mt-1 text-xs text-slate-500">{t('wlOfferUntil')} {new Date(e.offerExpiresAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>}
              </Td>
              <Td>
                {manage && (e.status === 'waiting' || e.status === 'offered') && (
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm(`${t('wlRemove')}?`)) void act(() => api(`${base}/waitlist/${e.id}/cancel`, { method: 'POST', body: {} })); }}>{t('wlRemove')}</Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {adding && <AddDialog onClose={() => setAdding(false)} onCreated={async () => { setAdding(false); await list.reload(); }} />}
    </div>
  );
}

function AddDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { base, branch } = useOrg();
  const { t } = useT();
  const services = useApi<ServiceRow[]>(branch ? `${base}/services?branchId=${branch.id}` : null);
  const specialists = useApi<SpecialistRow[]>(branch ? `${base}/branches/${branch.id}/specialists` : null);
  const today = new Date().toISOString().slice(0, 10);
  const [selected, setSelected] = useState<string[]>([]);
  const [specialistId, setSpecialistId] = useState('');
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [priority, setPriority] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const eligible = (specialists.data ?? []).filter((s) => s.isActive && selected.every((id) => s.services.some((x) => x.serviceId === id)));

  return (
    <Modal open onClose={onClose} title={t('addToWaitlist')}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await api(`${base}/waitlist`, {
              method: 'POST',
              body: {
                branchId: branch!.id,
                items: selected.map((serviceId) => ({ serviceId })),
                specialistId: specialistId || null,
                dateFrom,
                dateTo,
                client: { name: name.trim(), phone },
                priority,
              },
            });
            onCreated();
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      >
        <Alert>{error}</Alert>
        <Field label={t('services')}>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {(services.data ?? []).filter((s) => s.isActive).map((s) => (
              <Checkbox
                key={s.id}
                checked={selected.includes(s.id)}
                onChange={(e) => { setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id)); setSpecialistId(''); }}
                label={s.name}
              />
            ))}
          </div>
        </Field>
        <Field label={t('specialist')}>
          <Select value={specialistId} onChange={(e) => setSpecialistId(e.target.value)}>
            <option value="">{t('anySpecialist')}</option>
            {eligible.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('from')}><Input type="date" required value={dateFrom} min={today} onChange={(e) => setDateFrom(e.target.value)} /></Field>
          <Field label={t('to')}><Input type="date" required value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('client')}><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('phone')}><Input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 7__ ___ __ __" /></Field>
        </div>
        <Field label={t('priority')}><Input type="number" min={0} max={100} value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="w-24" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" disabled={!selected.length}>{t('add')}</Button>
        </div>
      </form>
    </Modal>
  );
}
