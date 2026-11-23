'use client';

import { useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { minutesLabel, money } from '@/lib/format';

interface Service {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  photoAssetId: string | null;
  photo: { variants: Record<string, string> } | null;
  price: number;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  requiresSpecialist: boolean;
  isActive: boolean;
  onlineBookingEnabled: boolean;
  sortOrder: number;
  branchServices: Array<{ branchId: string; priceOverride: number | null }>;
  requirements: Array<{ resourceType: string; quantity: number }>;
}
interface Category {
  id: string;
  name: string;
}

const RESOURCE_TYPES = ['cabinet', 'hall', 'equipment', 'vehicle', 'service_bay', 'other'];
type Draft = Omit<Service, 'id' | 'category' | 'photo'> & { id?: string; specialistIds: string[] };
interface SpecialistLite {
  id: string;
  name: string;
  isActive: boolean;
  services: Array<{ serviceId: string }>;
}

const empty = (branchId: string | null): Draft => ({
  name: '',
  description: '',
  categoryId: null,
  photoAssetId: null,
  price: 0,
  durationMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  requiresSpecialist: true,
  isActive: true,
  onlineBookingEnabled: true,
  sortOrder: 0,
  branchServices: branchId ? [{ branchId, priceOverride: null }] : [],
  requirements: [],
  specialistIds: [],
});

export default function ServicesPage() {
  const { base, branches, branchId, can, canManage } = useOrg();
  const { t, st } = useT();
  const services = useApi<Service[]>(`${base}/services`);
  const categories = useApi<Category[]>(`${base}/service-categories`);
  // Специалисты выбранного филиала: назначение на услугу прямо из её карточки
  const specialists = useApi<SpecialistLite[]>(branchId ? `${base}/branches/${branchId}/specialists` : null);
  const branch = branches.find((b) => b.id === branchId);
  const canAssign = !!branchId && can('specialists.manage', branchId) && canManage;
  const openEdit = (s: Service) =>
    setEdit({ ...s, categoryId: s.categoryId, specialistIds: (specialists.data ?? []).filter((x) => x.services.some((y) => y.serviceId === s.id)).map((x) => x.id) });
  const specialistsOf = (serviceId: string) => (specialists.data ?? []).filter((x) => x.services.some((y) => y.serviceId === serviceId)).map((x) => x.name);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState('');
  const canEdit = can('services.manage') && canManage;

  async function save() {
    if (!edit) return;
    setBusy(true);
    setError(null);
    const body = {
      name: edit.name,
      description: edit.description || undefined,
      categoryId: edit.categoryId,
      photoAssetId: edit.photoAssetId,
      price: Number(edit.price),
      durationMinutes: Number(edit.durationMinutes),
      bufferBeforeMinutes: Number(edit.bufferBeforeMinutes),
      bufferAfterMinutes: Number(edit.bufferAfterMinutes),
      requiresSpecialist: edit.requiresSpecialist,
      isActive: edit.isActive,
      onlineBookingEnabled: edit.onlineBookingEnabled,
      sortOrder: Number(edit.sortOrder),
      resourceRequirements: edit.requirements,
      branches: edit.branchServices.map((b) => ({ branchId: b.branchId, priceOverride: b.priceOverride === null || (b.priceOverride as unknown) === '' ? null : Number(b.priceOverride) })),
    };
    try {
      const id = edit.id ?? (await api<{ id: string }>(`${base}/services`, { method: 'POST', body })).id;
      if (edit.id) await api(`${base}/services/${edit.id}`, { method: 'PATCH', body });
      // Назначение специалистов выбранного филиала, если услуга в нём оказывается
      if (canAssign && edit.requiresSpecialist && edit.branchServices.some((b) => b.branchId === branchId)) {
        await api(`${base}/branches/${branchId}/specialists/by-service/${id}`, { method: 'PUT', body: { specialistIds: edit.specialistIds } });
      }
      setEdit(null);
      await Promise.all([services.reload(), specialists.reload()]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title={t('services')} actions={canEdit && <Button onClick={() => setEdit(empty(branchId))} data-testid="add-service">+ {t('add')}</Button>} />
      <Card>
        {services.loading ? <Spinner /> : (
          <Table head={[t('name'), t('category'), t('duration'), t('price'), t('specialists'), t('branches'), t('status')]} empty={!services.data?.length}>
            {(services.data ?? []).map((s) => (
              <tr key={s.id} className={canEdit ? 'cursor-pointer hover:bg-slate-50' : ''} onClick={() => canEdit && openEdit(s)}>
                <Td><div className="font-medium">{s.name}</div>{s.requirements.length > 0 && <div className="text-xs text-slate-500">{s.requirements.map((r) => `${st(r.resourceType)} × ${r.quantity}`).join(', ')}</div>}</Td>
                <Td>{s.category?.name ?? '—'}</Td>
                <Td>{minutesLabel(s.durationMinutes)}</Td>
                <Td>{money(s.price)}</Td>
                <Td className="text-xs">{s.requiresSpecialist ? specialistsOf(s.id).join(', ') || <span className="text-amber-700">{t('noSpecialistsYet')}</span> : '—'}</Td>
                <Td>{s.branchServices.map((b) => branches.find((x) => x.id === b.branchId)?.name).filter(Boolean).join(', ')}</Td>
                <Td>{s.isActive ? <Badge tone="green">{t('active')}</Badge> : <Badge>—</Badge>}{!s.onlineBookingEnabled && <Badge tone="amber">{t('onlineBookingOff')}</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {canEdit && (
        <Card title={t('category')} className="mt-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {(categories.data ?? []).map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm">
                {c.name}
                <button aria-label="delete" className="text-slate-400 hover:text-rose-600" onClick={async () => { await api(`${base}/service-categories/${c.id}`, { method: 'DELETE' }); await categories.reload(); }}>×</button>
              </span>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!newCat) return; await api(`${base}/service-categories`, { method: 'POST', body: { name: newCat } }); setNewCat(''); await categories.reload(); }}>
            <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder={t('name')} className="max-w-xs" />
            <Button variant="secondary" type="submit">{t('add')}</Button>
          </form>
        </Card>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('edit') : t('add')} wide>
        {edit && (
          <div className="space-y-3">
            <Alert>{error}</Alert>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('name')} className="sm:col-span-2"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="service-name" /></Field>
              <Field label={t('description')} className="sm:col-span-2"><Textarea rows={2} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
              <Field label={t('category')}>
                <Select value={edit.categoryId ?? ''} onChange={(e) => setEdit({ ...edit, categoryId: e.target.value || null })}>
                  <option value="">—</option>
                  {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label={t('price')}><Input type="number" min={0} value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} data-testid="service-price" /></Field>
              <Field label={t('duration')}><Input type="number" min={5} step={5} value={edit.durationMinutes} onChange={(e) => setEdit({ ...edit, durationMinutes: Number(e.target.value) })} /></Field>
              <Field label={t('bufferBefore')}><Input type="number" min={0} value={edit.bufferBeforeMinutes} onChange={(e) => setEdit({ ...edit, bufferBeforeMinutes: Number(e.target.value) })} /></Field>
              <Field label={t('bufferAfter')}><Input type="number" min={0} value={edit.bufferAfterMinutes} onChange={(e) => setEdit({ ...edit, bufferAfterMinutes: Number(e.target.value) })} /></Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <Checkbox checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} label={t('active')} />
              <Checkbox checked={edit.onlineBookingEnabled} onChange={(e) => setEdit({ ...edit, onlineBookingEnabled: e.target.checked })} label={t('onlineBooking')} />
              <Checkbox checked={edit.requiresSpecialist} onChange={(e) => setEdit({ ...edit, requiresSpecialist: e.target.checked })} label={t('requiresSpecialist')} />
            </div>
            <Field label={t('photos')}><ImageUpload kind="service" value={edit.photoAssetId} onChange={(id) => setEdit({ ...edit, photoAssetId: id })} /></Field>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-slate-600">{t('requiredResources')}</legend>
              <div className="flex flex-wrap gap-3">
                {RESOURCE_TYPES.map((rt) => {
                  const r = edit.requirements.find((x) => x.resourceType === rt);
                  return (
                    <Checkbox
                      key={rt}
                      checked={!!r}
                      onChange={(e) => setEdit({ ...edit, requirements: e.target.checked ? [...edit.requirements, { resourceType: rt, quantity: 1 }] : edit.requirements.filter((x) => x.resourceType !== rt) })}
                      label={st(rt)}
                    />
                  );
                })}
              </div>
            </fieldset>
            {canAssign && edit.requiresSpecialist && edit.branchServices.some((b) => b.branchId === branchId) && (
              <fieldset data-testid="service-specialists">
                <legend className="mb-1 text-xs font-medium text-slate-600">{t('specialistsInBranch')}: {branch?.name}</legend>
                {(specialists.data ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">{t('noSpecialistsInBranch')}</p>
                ) : (
                  <div className="grid gap-1 sm:grid-cols-2">
                    {(specialists.data ?? []).map((sp) => (
                      <Checkbox
                        key={sp.id}
                        checked={edit.specialistIds.includes(sp.id)}
                        onChange={(e) => setEdit({ ...edit, specialistIds: e.target.checked ? [...edit.specialistIds, sp.id] : edit.specialistIds.filter((x) => x !== sp.id) })}
                        label={sp.isActive ? sp.name : `${sp.name} (${t('inactive')})`}
                      />
                    ))}
                  </div>
                )}
              </fieldset>
            )}
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-slate-600">{t('branches')} / {t('price')}</legend>
              {branches.map((b) => {
                const bs = edit.branchServices.find((x) => x.branchId === b.id);
                return (
                  <div key={b.id} className="mb-1 flex items-center gap-3">
                    <Checkbox
                      checked={!!bs}
                      disabled={!can('services.manage', b.id)}
                      onChange={(e) => setEdit({ ...edit, branchServices: e.target.checked ? [...edit.branchServices, { branchId: b.id, priceOverride: null }] : edit.branchServices.filter((x) => x.branchId !== b.id) })}
                      label={b.name}
                    />
                    {bs && (
                      <Input
                        type="number"
                        min={0}
                        placeholder={String(edit.price)}
                        value={bs.priceOverride ?? ''}
                        onChange={(e) => setEdit({ ...edit, branchServices: edit.branchServices.map((x) => (x.branchId === b.id ? { ...x, priceOverride: e.target.value === '' ? null : Number(e.target.value) } : x)) })}
                        className="max-w-[8rem]"
                      />
                    )}
                  </div>
                );
              })}
            </fieldset>
            <div className="flex justify-between gap-2 pt-2">
              {edit.id ? (
                <Button variant="danger" onClick={async () => { if (!confirm(`${t('archive')}: ${edit.name}?`)) return; setError(null); try { await api(`${base}/services/${edit.id}`, { method: 'DELETE' }); setEdit(null); await services.reload(); } catch (e) { setError(errorMessage(e)); } }}>{t('archive')}</Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEdit(null)}>{t('cancel')}</Button>
                <Button loading={busy} onClick={save} data-testid="save-service">{t('save')}</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
