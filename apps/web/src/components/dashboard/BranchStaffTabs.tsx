'use client';

import { useState } from 'react';
import { useOrg } from './OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Modal, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { ImageUpload } from './ImageUpload';

interface ServiceLite {
  id: string;
  name: string;
  branchServices: Array<{ branchId: string }>;
}
interface Specialist {
  id: string;
  name: string;
  specialization: string | null;
  description: string | null;
  photoAssetId: string | null;
  photo: { variants: Record<string, string> } | null;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  services: Array<{ serviceId: string; priceOverride: number | null }>;
}
interface Resource {
  id: string;
  name: string;
  type: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  services: Array<{ serviceId: string }>;
}

function useBranchServices(branchId: string) {
  const { base } = useOrg();
  return useApi<ServiceLite[]>(`${base}/services?branchId=${branchId}`);
}

/** Специалисты филиала: отдельная карточка в каждом филиале (§4). */
export function SpecialistsTab({ branchId }: { branchId: string }) {
  const { base, can, canManage } = useOrg();
  const { t } = useT();
  const list = useApi<Specialist[]>(`${base}/branches/${branchId}/specialists`);
  const services = useBranchServices(branchId);
  const [edit, setEdit] = useState<(Partial<Specialist> & { services: Specialist['services'] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = can('specialists.manage', branchId) && canManage;

  async function save() {
    if (!edit) return;
    setError(null);
    const body = {
      name: edit.name,
      specialization: edit.specialization || undefined,
      description: edit.description || undefined,
      photoAssetId: edit.photoAssetId ?? null,
      isActive: edit.isActive ?? true,
      isPublic: edit.isPublic ?? true,
      sortOrder: edit.sortOrder ?? 0,
      services: edit.services,
    };
    try {
      if (edit.id) await api(`${base}/branches/${branchId}/specialists/${edit.id}`, { method: 'PATCH', body });
      else await api(`${base}/branches/${branchId}/specialists`, { method: 'POST', body });
      setEdit(null);
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Card actions={canEdit && <Button size="sm" onClick={() => setEdit({ name: '', services: [] })}>+ {t('add')}</Button>}>
      {list.loading ? <Spinner /> : (
        <Table head={[t('personName'), t('specialization'), t('services'), t('status')]} empty={!list.data?.length}>
          {(list.data ?? []).map((s) => (
            <tr key={s.id} className={canEdit ? 'cursor-pointer hover:bg-slate-50' : ''} onClick={() => canEdit && setEdit(s)}>
              <Td className="font-medium">{s.name}</Td>
              <Td>{s.specialization ?? '—'}</Td>
              <Td>{s.services.map((x) => services.data?.find((y) => y.id === x.serviceId)?.name).filter(Boolean).join(', ')}</Td>
              <Td>{s.isActive ? <Badge tone="green">{t('active')}</Badge> : <Badge>—</Badge>}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('edit') : t('add')} wide>
        {edit && (
          <div className="space-y-3">
            <Alert>{error}</Alert>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('personName')}><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label={t('specialization')}><Input value={edit.specialization ?? ''} onChange={(e) => setEdit({ ...edit, specialization: e.target.value })} /></Field>
              <Field label={t('description')} className="sm:col-span-2"><Textarea rows={2} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            </div>
            <Field label={t('photos')}><ImageUpload kind="specialist" value={edit.photoAssetId} preview={edit.photo?.variants ? null : null} onChange={(id) => setEdit({ ...edit, photoAssetId: id })} /></Field>
            <div className="flex gap-4">
              <Checkbox checked={edit.isActive ?? true} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} label={t('active')} />
              <Checkbox checked={edit.isPublic ?? true} onChange={(e) => setEdit({ ...edit, isPublic: e.target.checked })} label={t('publicVisible')} />
            </div>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-slate-600">{t('services')}</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {(services.data ?? []).map((s) => {
                  const on = edit.services.some((x) => x.serviceId === s.id);
                  return (
                    <Checkbox
                      key={s.id}
                      checked={on}
                      onChange={(e) => setEdit({ ...edit, services: e.target.checked ? [...edit.services, { serviceId: s.id, priceOverride: null }] : edit.services.filter((x) => x.serviceId !== s.id) })}
                      label={s.name}
                    />
                  );
                })}
              </div>
            </fieldset>
            <div className="flex justify-between pt-2">
              {edit.id ? (
                <Button variant="danger" onClick={async () => { setError(null); try { await api(`${base}/branches/${branchId}/specialists/${edit.id}`, { method: 'DELETE' }); setEdit(null); await list.reload(); } catch (e) { setError(errorMessage(e)); } }}>{t('archive')}</Button>
              ) : <span />}
              <Button onClick={save}>{t('save')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

const TYPES = ['cabinet', 'hall', 'equipment', 'vehicle', 'service_bay', 'other'];

/** Ресурсы: кабинеты, залы, оборудование, автомобили, посты (§6). */
export function ResourcesTab({ branchId }: { branchId: string }) {
  const { base, can, canManage } = useOrg();
  const { t } = useT();
  const list = useApi<Resource[]>(`${base}/branches/${branchId}/resources`);
  const services = useBranchServices(branchId);
  const [edit, setEdit] = useState<(Partial<Resource> & { serviceIds: string[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = can('resources.manage', branchId) && canManage;

  return (
    <Card actions={canEdit && <Button size="sm" onClick={() => setEdit({ name: '', type: 'cabinet', serviceIds: [] })}>+ {t('add')}</Button>}>
      {list.loading ? <Spinner /> : (
        <Table head={[t('name'), t('type'), t('services'), t('status')]} empty={!list.data?.length}>
          {(list.data ?? []).map((r) => (
            <tr key={r.id} className={canEdit ? 'cursor-pointer hover:bg-slate-50' : ''} onClick={() => canEdit && setEdit({ ...r, serviceIds: r.services.map((s) => s.serviceId) })}>
              <Td className="font-medium">{r.name}</Td>
              <Td>{r.type}</Td>
              <Td>{r.services.map((x) => services.data?.find((y) => y.id === x.serviceId)?.name).filter(Boolean).join(', ')}</Td>
              <Td>{r.isActive ? <Badge tone="green">{t('active')}</Badge> : <Badge>—</Badge>}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('edit') : t('add')}>
        {edit && (
          <div className="space-y-3">
            <Alert>{error}</Alert>
            <Field label={t('name')}><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={t('type')}>
              <Select value={edit.type} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                {TYPES.map((x) => <option key={x}>{x}</option>)}
              </Select>
            </Field>
            <Field label={t('description')}><Textarea rows={2} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Checkbox checked={edit.isActive ?? true} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} label={t('active')} />
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-slate-600">{t('services')}</legend>
              {(services.data ?? []).map((s) => (
                <Checkbox key={s.id} checked={edit.serviceIds.includes(s.id)} onChange={(e) => setEdit({ ...edit, serviceIds: e.target.checked ? [...edit.serviceIds, s.id] : edit.serviceIds.filter((x) => x !== s.id) })} label={s.name} />
              ))}
            </fieldset>
            <div className="flex justify-between pt-2">
              {edit.id ? (
                <Button variant="danger" onClick={async () => { setError(null); try { await api(`${base}/branches/${branchId}/resources/${edit.id}`, { method: 'DELETE' }); setEdit(null); await list.reload(); } catch (e) { setError(errorMessage(e)); } }}>{t('archive')}</Button>
              ) : <span />}
              <Button
                onClick={async () => {
                  setError(null);
                  try {
                    const body = { name: edit.name, description: edit.description || undefined, isActive: edit.isActive ?? true, serviceIds: edit.serviceIds };
                    if (edit.id) await api(`${base}/branches/${branchId}/resources/${edit.id}`, { method: 'PATCH', body });
                    else await api(`${base}/branches/${branchId}/resources`, { method: 'POST', body: { ...body, type: edit.type } });
                    setEdit(null);
                    await list.reload();
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                {t('save')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
