'use client';

import { useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { money } from '@/lib/format';

interface Promotion {
  id: string;
  kind: 'promo_code' | 'sale';
  name: string;
  code: string | null;
  description: string | null;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  startsAt: string | null;
  endsAt: string | null;
  allBranches: boolean;
  branchIds: string[];
  allServices: boolean;
  serviceIds: string[];
  minAmount: number | null;
  usageLimit: number | null;
  perClientLimit: number | null;
  isActive: boolean;
  showOnPage: boolean;
  usedCount: number;
}
type Draft = Partial<Promotion> & { kind: Promotion['kind']; discountType: Promotion['discountType'] };

const toLocal = (iso: string | null | undefined) => (iso ? iso.slice(0, 16) : '');
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export default function PromotionsPage() {
  const { base, branches } = useOrg();
  const { t } = useT();
  const list = useApi<Promotion[]>(`${base}/promotions`);
  const services = useApi<Array<{ id: string; name: string }>>(`${base}/services`);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!edit) return;
    setError(null);
    const body = {
      kind: edit.kind,
      name: edit.name,
      code: edit.kind === 'promo_code' ? edit.code : undefined,
      description: edit.description || undefined,
      discountType: edit.discountType,
      discountValue: Number(edit.discountValue),
      startsAt: edit.startsAt ?? null,
      endsAt: edit.endsAt ?? null,
      branchIds: edit.allBranches === false ? edit.branchIds : null,
      serviceIds: edit.allServices === false ? edit.serviceIds : null,
      minAmount: edit.minAmount ? Number(edit.minAmount) : null,
      usageLimit: edit.usageLimit ? Number(edit.usageLimit) : null,
      perClientLimit: edit.perClientLimit ? Number(edit.perClientLimit) : null,
      isActive: edit.isActive ?? true,
      showOnPage: edit.showOnPage ?? false,
    };
    try {
      if (edit.id) await api(`${base}/promotions/${edit.id}`, { method: 'PUT', body });
      else await api(`${base}/promotions`, { method: 'POST', body });
      setEdit(null);
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader title={t('promotions')} actions={<Button onClick={() => setEdit({ kind: 'promo_code', discountType: 'percent', allBranches: true, allServices: true, isActive: true })}>+ {t('add')}</Button>} />
      <Card>
        {list.loading ? <Spinner /> : (
          <Table head={[t('name'), t('type'), t('discount'), t('validTo'), t('used'), t('status')]} empty={!list.data?.length}>
            {(list.data ?? []).map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEdit(p)}>
                <Td><div className="font-medium">{p.name}</div>{p.code && <code className="text-xs">{p.code}</code>}</Td>
                <Td>{p.kind === 'promo_code' ? t('promoCode') : t('sale')}</Td>
                <Td>{p.discountType === 'percent' ? `${p.discountValue}%` : money(p.discountValue)}</Td>
                <Td>{p.endsAt ? new Date(p.endsAt).toLocaleDateString('ru-RU') : '—'}</Td>
                <Td>{p.usedCount}{p.usageLimit ? ` / ${p.usageLimit}` : ''}</Td>
                <Td>{p.isActive ? <Badge tone="green">{t('active')}</Badge> : <Badge>—</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('edit') : t('add')} wide>
        {edit && (
          <div className="space-y-3">
            <Alert>{error}</Alert>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('type')}>
                <Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Promotion['kind'] })}>
                  <option value="promo_code">{t('promoCode')}</option>
                  <option value="sale">{t('sale')}</option>
                </Select>
              </Field>
              <Field label={t('name')}><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              {edit.kind === 'promo_code' && <Field label={t('code')}><Input value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} className="font-mono" /></Field>}
              <Field label={t('discount')}>
                <div className="flex gap-2">
                  <Select value={edit.discountType} onChange={(e) => setEdit({ ...edit, discountType: e.target.value as Promotion['discountType'] })} className="max-w-[10rem]">
                    <option value="percent">{t('percent')}</option>
                    <option value="fixed">{t('fixed')}</option>
                  </Select>
                  <Input type="number" min={1} value={edit.discountValue ?? ''} onChange={(e) => setEdit({ ...edit, discountValue: Number(e.target.value) })} />
                </div>
              </Field>
              <Field label={t('validFrom')}><Input type="datetime-local" value={toLocal(edit.startsAt)} onChange={(e) => setEdit({ ...edit, startsAt: fromLocal(e.target.value) })} /></Field>
              <Field label={t('validTo')}><Input type="datetime-local" value={toLocal(edit.endsAt)} onChange={(e) => setEdit({ ...edit, endsAt: fromLocal(e.target.value) })} /></Field>
              <Field label={t('minAmount')}><Input type="number" min={0} value={edit.minAmount ?? ''} onChange={(e) => setEdit({ ...edit, minAmount: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label={t('usageLimit')}><Input type="number" min={1} value={edit.usageLimit ?? ''} onChange={(e) => setEdit({ ...edit, usageLimit: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label={t('perClientLimit')}><Input type="number" min={1} value={edit.perClientLimit ?? ''} onChange={(e) => setEdit({ ...edit, perClientLimit: e.target.value ? Number(e.target.value) : null })} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <fieldset>
                <Checkbox checked={edit.allBranches !== false} onChange={(e) => setEdit({ ...edit, allBranches: e.target.checked, branchIds: edit.branchIds ?? [] })} label={t('allBranches')} />
                {edit.allBranches === false && branches.map((b) => (
                  <Checkbox key={b.id} checked={(edit.branchIds ?? []).includes(b.id)} onChange={(e) => setEdit({ ...edit, branchIds: e.target.checked ? [...(edit.branchIds ?? []), b.id] : (edit.branchIds ?? []).filter((x) => x !== b.id) })} label={b.name} />
                ))}
              </fieldset>
              <fieldset>
                <Checkbox checked={edit.allServices !== false} onChange={(e) => setEdit({ ...edit, allServices: e.target.checked, serviceIds: edit.serviceIds ?? [] })} label={t('services')} />
                {edit.allServices === false && (services.data ?? []).map((s) => (
                  <Checkbox key={s.id} checked={(edit.serviceIds ?? []).includes(s.id)} onChange={(e) => setEdit({ ...edit, serviceIds: e.target.checked ? [...(edit.serviceIds ?? []), s.id] : (edit.serviceIds ?? []).filter((x) => x !== s.id) })} label={s.name} />
                ))}
              </fieldset>
            </div>
            <div className="flex gap-4">
              <Checkbox checked={edit.isActive ?? true} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} label={t('active')} />
              <Checkbox checked={edit.showOnPage ?? false} onChange={(e) => setEdit({ ...edit, showOnPage: e.target.checked })} label={t('showOnPage')} />
            </div>
            <div className="flex justify-between">
              {edit.id ? <Button variant="danger" onClick={async () => { await api(`${base}/promotions/${edit.id}`, { method: 'DELETE' }); setEdit(null); await list.reload(); }}>{t('archive')}</Button> : <span />}
              <Button onClick={save}>{t('save')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
