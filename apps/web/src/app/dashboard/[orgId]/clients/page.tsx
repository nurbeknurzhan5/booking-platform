'use client';

import { useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Pager, Spinner, Table, Td, Textarea, statusTone } from '@/components/ui';
import { formatPhone, money } from '@/lib/format';

interface ClientRow {
  id: string;
  name: string;
  phone: string;
  registered: boolean;
  createdAt: string;
  visits: number;
  cancellations: number;
  noShows: number;
  lastVisitAt: string | null;
}
interface ClientCard {
  id: string;
  name: string;
  phone: string;
  locale: string;
  notes: string | null;
  registered: boolean;
  createdAt: string;
  stats: { visits: number; cancellations: number; noShows: number };
  consents: Record<string, { granted: boolean; at: string }>;
  appointments: Array<{ id: string; startAt: string; status: string; totalPrice: number; branch: { name: string }; items: Array<{ serviceNameSnapshot: string; specialistNameSnapshot: string | null }> }>;
  reviews: Array<{ id: string; rating: number; text: string | null }>;
}

export default function ClientsPage() {
  const { base, isOwner, can } = useOrg();
  const { t } = useT();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const list = useApi<{ total: number; items: ClientRow[] }>(`${base}/clients?page=${page}&pageSize=${PAGE_SIZE}${q ? `&search=${encodeURIComponent(q)}` : ''}`);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title={t('clients')} subtitle={list.data ? `${list.data.total}` : undefined} />
      <Card>
        <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setQ(search); setPage(1); }}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`${t('search')}: ${t('personName')} / ${t('phone')}`} className="max-w-sm" />
          <Button type="submit" variant="secondary">{t('search')}</Button>
        </form>
        {list.loading ? <Spinner /> : (
          <Table head={[t('personName'), t('phone'), t('visits'), t('cancellations'), t('noShows'), t('registered')]} empty={!list.data?.items.length}>
            {(list.data?.items ?? []).map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(c.id)}>
                <Td className="font-medium">{c.name}</Td>
                <Td>{formatPhone(c.phone)}</Td>
                <Td>{c.visits}</Td>
                <Td>{c.cancellations}</Td>
                <Td>{c.noShows}</Td>
                <Td>{c.registered ? '✓' : ''}</Td>
              </tr>
            ))}
          </Table>
        )}
        {list.data && <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onChange={setPage} label={`${t('clients')}: ${list.data.total}`} />}
      </Card>
      {openId && <ClientDialog id={openId} onClose={() => { setOpenId(null); void list.reload(); }} canEdit={can('appointments.manage')} isOwner={isOwner} candidates={list.data?.items ?? []} />}
    </div>
  );
}

function ClientDialog({ id, onClose, canEdit, isOwner, candidates }: { id: string; onClose: () => void; canEdit: boolean; isOwner: boolean; candidates: ClientRow[] }) {
  const { base } = useOrg();
  const { t, st } = useT();
  const card = useApi<ClientCard>(`${base}/clients/${id}`);
  const [notes, setNotes] = useState<string | null>(null);
  const [mergeId, setMergeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const c = card.data;
  return (
    <Modal open onClose={onClose} title={c ? `${c.name} · ${formatPhone(c.phone)}` : '…'} wide>
      {!c ? <Spinner /> : (
        <div className="space-y-4">
          <Alert>{error}</Alert>
          <div className="flex flex-wrap gap-3 text-sm">
            <Badge tone="blue">{t('visits')}: {c.stats.visits}</Badge>
            <Badge tone="amber">{t('cancellations')}: {c.stats.cancellations}</Badge>
            <Badge tone="red">{t('noShows')}: {c.stats.noShows}</Badge>
            <Badge>{new Date(c.createdAt).toLocaleDateString('ru-RU')}</Badge>
            {Object.entries(c.consents).map(([k, v]) => <Badge key={k} tone={v.granted ? 'green' : 'slate'}>{t(`consent_${k}` as 'consent_marketing')}: {v.granted ? '✓' : '✕'}</Badge>)}
          </div>
          {canEdit && (
            <Field label={t('notes')}>
              <div className="flex gap-2">
                <Textarea rows={2} value={notes ?? c.notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
                <Button variant="secondary" onClick={async () => { try { await api(`${base}/clients/${id}`, { method: 'PATCH', body: { notes: notes ?? '' } }); await card.reload(); } catch (e) { setError(errorMessage(e)); } }}>{t('save')}</Button>
              </div>
            </Field>
          )}
          <Table head={[t('date'), t('branch'), t('services'), t('total'), t('status')]} empty={!c.appointments.length}>
            {c.appointments.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap">{new Date(a.startAt).toLocaleString('ru-RU')}</Td>
                <Td>{a.branch.name}</Td>
                <Td>{a.items.map((i) => i.serviceNameSnapshot).join(', ')}</Td>
                <Td>{money(a.totalPrice)}</Td>
                <Td><Badge tone={statusTone(a.status)}>{st(a.status)}</Badge></Td>
              </tr>
            ))}
          </Table>
          {isOwner && (
            <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <Field label={t('merge')}>
                <select value={mergeId} onChange={(e) => setMergeId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">—</option>
                  {candidates.filter((x) => x.id !== id).map((x) => <option key={x.id} value={x.id}>{x.name} · {formatPhone(x.phone)}</option>)}
                </select>
              </Field>
              <Button variant="secondary" disabled={!mergeId} onClick={async () => { try { await api(`${base}/clients/merge`, { method: 'POST', body: { sourceClientId: mergeId, targetClientId: id } }); setMergeId(''); await card.reload(); } catch (e) { setError(errorMessage(e)); } }}>{t('merge')}</Button>
              <Button variant="danger" onClick={async () => { if (!confirm(`${t('anonymize')}?`)) return; try { await api(`${base}/clients/${id}/anonymize`, { method: 'POST' }); onClose(); } catch (e) { setError(errorMessage(e)); } }}>{t('anonymize')}</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
