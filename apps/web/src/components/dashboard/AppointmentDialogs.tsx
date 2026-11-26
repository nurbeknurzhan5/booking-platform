'use client';

import { useCallback, useMemo, useState } from 'react';
import { api, errorMessage, newIdempotencyKey } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { useOrg } from './OrgContext';
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { SlotPicker } from '@/components/public/SlotPicker';
import type { SlotsResponse } from '@/lib/types';
import { dateTime, minutesLabel, money } from '@/lib/format';
import { apiPath } from '@/lib/api-path';

export interface ServiceRow {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  isActive: boolean;
  branchServices: Array<{ branchId: string; priceOverride: number | null }>;
}
export interface SpecialistRow {
  id: string;
  name: string;
  isActive: boolean;
  services: Array<{ serviceId: string }>;
}

/** Ручная запись администратором (сразу подтверждена). */
export function NewAppointmentDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { base, branch } = useOrg();
  const { t } = useT();
  const services = useApi<ServiceRow[]>(branch ? apiPath`${base}/services?branchId=${branch.id}` : null);
  const specialists = useApi<SpecialistRow[]>(branch ? apiPath`${base}/branches/${branch.id}/specialists` : null);
  const [selected, setSelected] = useState<string[]>([]);
  const [spec, setSpec] = useState<Record<string, string>>({});
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => selected.map((serviceId) => ({ serviceId, specialistId: spec[serviceId] || null })), [selected, spec]);
  const fetchSlots = useCallback(
    (date: string) => api<SlotsResponse>(apiPath`${base}/availability`, { method: 'POST', body: { branchId: branch!.id, date, items } }),
    [base, branch, items],
  );
  if (!branch) return null;
  const active = (services.data ?? []).filter((s) => s.isActive);

  return (
    <Modal open={open} onClose={onClose} title={t('newAppointment')} wide>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <div>
          <p className="mb-2 text-xs font-medium text-slate-600">{t('services')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {active.map((s) => (
              <Checkbox
                key={s.id}
                checked={selected.includes(s.id)}
                onChange={(e) => {
                  setSlot(null);
                  setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id));
                }}
                label={`${s.name} · ${minutesLabel(s.durationMinutes)} · ${money(s.branchServices.find((b) => b.branchId === branch.id)?.priceOverride ?? s.price)}`}
              />
            ))}
          </div>
        </div>
        {selected.map((sid) => (
          <Field key={sid} label={`${t('specialist')}: ${active.find((s) => s.id === sid)?.name}`}>
            <Select value={spec[sid] ?? ''} onChange={(e) => { setSlot(null); setSpec({ ...spec, [sid]: e.target.value }); }}>
              <option value="">{t('anySpecialist')}</option>
              {(specialists.data ?? []).filter((sp) => sp.isActive && sp.services.some((x) => x.serviceId === sid)).map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.name}</option>
              ))}
            </Select>
          </Field>
        ))}
        {selected.length > 0 && (
          <div className="tpl rounded-lg bg-white">
            <SlotPicker lang="ru" timezone={branch.timezone} fetchSlots={fetchSlots} onSelect={(s) => setSlot(s.startAt)} selected={slot} days={30} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('personName')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('phone')}><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 7__ ___ __ __" /></Field>
        </div>
        <Field label={t('notes')}><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)} label={t('adminOverride')} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
          <Button
            loading={busy}
            disabled={!slot || !name || !phone}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api(apiPath`${base}/appointments`, {
                  method: 'POST',
                  idempotencyKey: newIdempotencyKey(),
                  body: { branchId: branch.id, startAt: slot, items, client: { name, phone }, comment: comment || undefined, overrideClientLimits: override },
                });
                onCreated();
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('create')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export interface ApptRow {
  id: string;
  branchId: string;
  status: string;
  startAt: string;
  endAt: string;
  timezone: string;
  totalPrice: number;
  comment: string | null;
  client: { id: string; name: string; phone: string };
  items: Array<{ serviceId: string; serviceNameSnapshot: string; specialistId: string | null; specialistNameSnapshot: string | null; startAt: string; endAt: string; finalPrice: number }>;
}

/** Действия над записью: выполнено, неявка, отмена с причиной, перенос. */
export function AppointmentActionsDialog({ appt, onClose, onChanged }: { appt: ApptRow | null; onClose: () => void; onChanged: () => void }) {
  const { base } = useOrg();
  const { t } = useT();
  const [mode, setMode] = useState<'menu' | 'cancel' | 'reschedule'>('menu');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fetchSlots = useCallback(
    (date: string) =>
      api<SlotsResponse>(apiPath`${base}/availability`, {
        method: 'POST',
        body: { branchId: appt!.branchId, date, items: appt!.items.map((i) => ({ serviceId: i.serviceId, specialistId: i.specialistId })), excludeAppointmentId: appt!.id },
      }),
    [base, appt],
  );
  if (!appt) return null;
  const status = async (s: 'completed' | 'no_show' | 'cancelled_by_admin') => {
    setBusy(true);
    setError(null);
    try {
      await api(apiPath`${base}/appointments/${appt.id}/status`, { method: 'POST', idempotencyKey: newIdempotencyKey(), body: { status: s, reason: reason || undefined } });
      onChanged();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const past = new Date(appt.startAt).getTime() <= Date.now();
  return (
    <Modal open onClose={() => { setMode('menu'); onClose(); }} title={`${appt.client.name} · ${dateTime(appt.startAt, appt.timezone)}`} wide={mode === 'reschedule'}>
      <Alert>{error}</Alert>
      <ul className="mb-4 mt-2 text-sm">
        {appt.items.map((i, k) => (
          <li key={k}>{i.serviceNameSnapshot}{i.specialistNameSnapshot ? ` · ${i.specialistNameSnapshot}` : ''} · {money(i.finalPrice)}</li>
        ))}
        <li className="mt-1 text-slate-500">{appt.client.phone}{appt.comment ? ` · ${appt.comment}` : ''}</li>
      </ul>
      {mode === 'menu' && (
        <div className="flex flex-wrap gap-2">
          {appt.status === 'confirmed' && past && <Button loading={busy} onClick={() => status('completed')}>{t('complete')}</Button>}
          {appt.status === 'confirmed' && past && <Button variant="secondary" loading={busy} onClick={() => status('no_show')}>{t('noShow')}</Button>}
          {appt.status === 'no_show' && <Button loading={busy} onClick={() => status('completed')}>{t('complete')}</Button>}
          {appt.status === 'confirmed' && <Button variant="secondary" onClick={() => setMode('reschedule')}>{t('reschedule')}</Button>}
          {appt.status === 'confirmed' && <Button variant="danger" onClick={() => setMode('cancel')}>{t('cancelAppt')}</Button>}
        </div>
      )}
      {mode === 'cancel' && (
        <div className="space-y-3">
          <Field label={t('reason')}><Input value={reason} onChange={(e) => setReason(e.target.value)} required /></Field>
          <div className="flex gap-2">
            <Button variant="danger" disabled={!reason} loading={busy} onClick={() => status('cancelled_by_admin')}>{t('cancelAppt')}</Button>
            <Button variant="ghost" onClick={() => setMode('menu')}>{t('cancel')}</Button>
          </div>
        </div>
      )}
      {mode === 'reschedule' && (
        <div className="tpl rounded-lg bg-white">
          <SlotPicker
            lang="ru"
            timezone={appt.timezone}
            fetchSlots={fetchSlots}
            days={30}
            onSelect={async (s) => {
              setError(null);
              try {
                await api(apiPath`${base}/appointments/${appt.id}/reschedule`, { method: 'POST', idempotencyKey: newIdempotencyKey(), body: { startAt: s.startAt } });
                onChanged();
                setMode('menu');
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          />
        </div>
      )}
    </Modal>
  );
}
