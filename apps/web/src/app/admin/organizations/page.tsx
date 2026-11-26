'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, statusTone } from '@/components/ui';
import { addDays } from '@/lib/format';
import { apiPath, apiQuery } from '@/lib/api-path';

interface OrgRow {
  id: string;
  name: string;
  businessCategoryCode: string;
  branches: number;
  owners: Array<{ name: string; email: string }>;
  subscription: { status: string; plan: { name: string }; maxBranches: number; endsAt: string } | null;
}

export default function AdminOrganizations() {
  const { t, st } = useT();
  const [search, setSearch] = useState('');
  const list = useApi<OrgRow[]>(apiPath`/admin/organizations${apiQuery({ search })}`);
  const plans = useApi<Array<{ id: string; name: string; maxBranches: number; monthlyPrice: number }>>(apiPath`/admin/plans`);
  const cats = useApi<Array<{ code: string; nameRu: string }>>(apiPath`/admin/business-categories`);
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', businessCategory: 'beauty_salon', ownerEmail: '', ownerName: '', ownerPassword: '', planId: '', startsAt: today, endsAt: addDays(today, 30), graceDays: 7 });
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title={t('organizations')} actions={<Button onClick={() => setOpen(true)} data-testid="create-org">+ {t('create')}</Button>} />
      <Card>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search')} className="mb-3 max-w-sm" />
        {list.loading ? <Spinner /> : (
          <Table head={[t('name'), t('businessCategory'), t('owners'), t('branches'), t('subscription')]} empty={!list.data?.length}>
            {(list.data ?? []).map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/organizations/${o.id}`} className="font-medium text-brand-700">{o.name}</Link></Td>
                <Td>{cats.data?.find((c) => c.code === o.businessCategoryCode)?.nameRu ?? o.businessCategoryCode}</Td>
                <Td className="text-xs">{o.owners.map((x) => x.email).join(', ')}</Td>
                <Td>{o.branches}{o.subscription ? ` / ${o.subscription.maxBranches}` : ''}</Td>
                <Td>{o.subscription ? <><Badge tone={statusTone(o.subscription.status)}>{st(o.subscription.status)}</Badge> <span className="text-xs text-slate-500">{o.subscription.plan.name} · {new Date(o.subscription.endsAt).toLocaleDateString('ru-RU')}</span></> : '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title={t('create')} wide>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              const r = await api<{ id: string }>(apiPath`/admin/organizations`, {
                method: 'POST',
                body: {
                  name: f.name,
                  businessCategory: f.businessCategory,
                  owner: f.ownerEmail ? { email: f.ownerEmail, name: f.ownerName || f.ownerEmail, temporaryPassword: f.ownerPassword } : undefined,
                  subscription: f.planId ? { planId: f.planId, startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(`${f.endsAt}T23:59:59`).toISOString(), graceDays: Number(f.graceDays) } : undefined,
                },
              });
              setOpen(false);
              window.location.href = `/admin/organizations/${r.id}`;
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <div className="sm:col-span-2"><Alert>{error}</Alert></div>
          <Field label={t('name')}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('businessCategory')}>
            <Select value={f.businessCategory} onChange={(e) => setF({ ...f, businessCategory: e.target.value })}>
              {(cats.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.nameRu}</option>)}
            </Select>
          </Field>
          <Field label={`${t('owners')}: ${t('email')}`}><Input type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} /></Field>
          <Field label={`${t('owners')}: ${t('personName')}`}><Input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></Field>
          <Field label={t('temporaryPassword')}><Input value={f.ownerPassword} onChange={(e) => setF({ ...f, ownerPassword: e.target.value })} minLength={10} /></Field>
          <Field label={t('plan')}>
            <Select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
              <option value="">—</option>
              {(plans.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.maxBranches})</option>)}
            </Select>
          </Field>
          <Field label={t('validFrom')}><Input type="date" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
          <Field label={t('validTo')}><Input type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
          <Field label={t('graceUntil')}><Input type="number" min={0} value={f.graceDays} onChange={(e) => setF({ ...f, graceDays: Number(e.target.value) })} /></Field>
          <div className="flex justify-end sm:col-span-2"><Button type="submit">{t('create')}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
