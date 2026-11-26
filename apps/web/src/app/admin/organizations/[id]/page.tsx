'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { withMfa } from '@/components/admin/mfa';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Td, statusTone } from '@/components/ui';
import { money } from '@/lib/format';
import { apiPath } from '@/lib/api-path';

interface OrgDetail {
  id: string;
  name: string;
  businessCategory: { nameRu: string };
  branches: Array<{ id: string; name: string; slug: string; page: { id: string; status: string; moderationBlocked: boolean } | null }>;
  members: Array<{ roleCode: string; user: { id: string; name: string; email: string | null } }>;
  subscription: { status: string; subscription: null | { plan: { id: string; name: string }; maxBranches: number; branchesUsed: number; price: number; startsAt: string; endsAt: string; graceDays: number; suspendedReason: string | null } };
}
interface History {
  history: Array<{ id: string; action: string; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: string }>;
  payments: Array<{ id: string; amount: number; paidAt: string; method: string; reference: string | null }>;
}

export default function AdminOrgDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, st } = useT();
  const org = useApi<OrgDetail>(apiPath`/admin/organizations/${id}`);
  const hist = useApi<History>(apiPath`/admin/organizations/${id}/subscription/history`);
  const plans = useApi<Array<{ id: string; name: string; maxBranches: number; monthlyPrice: number }>>(apiPath`/admin/plans`);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [sub, setSub] = useState({ planId: '', maxBranches: '', price: '', startsAt: '', endsAt: '', graceDays: '7' });
  const [pay, setPay] = useState({ amount: '', method: 'kaspi', reference: '', extendTo: '' });
  const [owner, setOwner] = useState({ email: '', name: '', temporaryPassword: '' });
  const [branch, setBranch] = useState({ name: '', address: '' });

  // Поля дат и льготного периода заполняются текущей подпиской: правка начинается с действующих значений.
  const current = org.data?.subscription.subscription;
  useEffect(() => {
    if (!current) return;
    setSub((x) => ({
      ...x,
      startsAt: x.startsAt || current.startsAt.slice(0, 10),
      endsAt: x.endsAt || current.endsAt.slice(0, 10),
      graceDays: String(current.graceDays),
    }));
  }, [current]);

  const act = async (fn: () => Promise<unknown>) => {
    setMsg({});
    try {
      const r = await fn();
      if (r !== undefined) setMsg({ ok: t('saved') });
      await Promise.all([org.reload(), hist.reload()]);
    } catch (e) {
      setMsg({ err: errorMessage(e) });
    }
  };
  if (!org.data) return org.error ? <Alert>{org.error}</Alert> : <Spinner />;
  const o = org.data;
  const s = o.subscription.subscription;

  return (
    <div className="space-y-4">
      <PageHeader title={o.name} subtitle={o.businessCategory.nameRu} actions={
        o.subscription.status === 'suspended' ? (
          <Button onClick={() => act(() => withMfa(apiPath`/admin/organizations/${id}/restore`, { method: 'POST', body: { reason: prompt(t('reason')) ?? 'restore' } }))}>{t('restoreAccess')}</Button>
        ) : (
          <Button variant="danger" onClick={() => { const reason = prompt(t('reason')); if (reason) void act(() => withMfa(apiPath`/admin/organizations/${id}/suspend`, { method: 'POST', body: { reason } })); }}>{t('suspend')}</Button>
        )
      } />
      <Alert>{msg.err}</Alert>
      {msg.ok && <Alert tone="green">{msg.ok}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('subscription')}>
          <p className="mb-3"><Badge tone={statusTone(o.subscription.status)}>{st(o.subscription.status)}</Badge></p>
          {s && (
            <p className="mb-3 text-sm text-slate-600">
              {s.plan.name} · {s.branchesUsed}/{s.maxBranches} · {money(s.price)} · {new Date(s.startsAt).toLocaleDateString('ru-RU')} — {new Date(s.endsAt).toLocaleDateString('ru-RU')} · {t('graceDays')}: {s.graceDays}
              {s.suspendedReason && <span className="block text-rose-700">{s.suspendedReason}</span>}
            </p>
          )}
          <form className="grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void act(() => withMfa(apiPath`/admin/organizations/${id}/subscription`, { method: 'PUT', body: { planId: sub.planId || s?.plan.id, maxBranches: sub.maxBranches ? Number(sub.maxBranches) : undefined, price: sub.price ? Number(sub.price) : undefined, startsAt: new Date(sub.startsAt || s?.startsAt || Date.now()).toISOString(), endsAt: new Date(sub.endsAt ? `${sub.endsAt}T23:59:59` : s!.endsAt).toISOString(), graceDays: Number(sub.graceDays) } })); }}>
            <Field label={t('plan')}>
              <Select value={sub.planId} onChange={(e) => setSub({ ...sub, planId: e.target.value })}>
                <option value="">{s?.plan.name ?? '—'}</option>
                {(plans.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label={t('maxBranches')}><Input type="number" min={1} value={sub.maxBranches} onChange={(e) => setSub({ ...sub, maxBranches: e.target.value })} placeholder={String(s?.maxBranches ?? '')} /></Field>
            <Field label={t('price')}><Input type="number" min={0} value={sub.price} onChange={(e) => setSub({ ...sub, price: e.target.value })} placeholder={String(s?.price ?? '')} /></Field>
            <Field label={t('validFrom')}><Input type="date" value={sub.startsAt} onChange={(e) => setSub({ ...sub, startsAt: e.target.value })} /></Field>
            <Field label={t('validTo')}><Input type="date" value={sub.endsAt} onChange={(e) => setSub({ ...sub, endsAt: e.target.value })} /></Field>
            <Field label={t('graceDays')}><Input type="number" min={0} value={sub.graceDays} onChange={(e) => setSub({ ...sub, graceDays: e.target.value })} /></Field>
            <div className="sm:col-span-3"><Button type="submit" variant="secondary">{t('save')}</Button></div>
          </form>
        </Card>

        <Card title={t('recordPayment')}>
          <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void act(() => withMfa(apiPath`/admin/organizations/${id}/subscription/payments`, { method: 'POST', body: { amount: Number(pay.amount), paidAt: new Date().toISOString(), method: pay.method, reference: pay.reference || undefined, extendTo: pay.extendTo ? new Date(`${pay.extendTo}T23:59:59`).toISOString() : undefined } })); }}>
            <Field label={t('amount')}><Input type="number" min={0} required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
            <Field label={t('method')}>
              <Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                {['kaspi', 'bank_transfer', 'cash', 'card', 'other'].map((m) => <option key={m} value={m}>{t(`pay_${m}` as 'pay_kaspi')}</option>)}
              </Select>
            </Field>
            <Field label={t('paymentRef')}><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
            <Field label={t('extendTo')}><Input type="date" value={pay.extendTo} onChange={(e) => setPay({ ...pay, extendTo: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Button type="submit">{t('recordPayment')}</Button></div>
          </form>
        </Card>

        <Card title={t('owners')}>
          <ul className="mb-3 text-sm">{o.members.map((m) => <li key={m.user.id}>{m.user.name} · {m.user.email} · <Badge>{t(`role_${m.roleCode}` as 'role_OWNER')}</Badge></li>)}</ul>
          <form className="grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void act(() => api(apiPath`/admin/organizations/${id}/owners`, { method: 'POST', body: owner })); }}>
            <Input type="email" placeholder={t('email')} required value={owner.email} onChange={(e) => setOwner({ ...owner, email: e.target.value })} />
            <Input placeholder={t('personName')} required value={owner.name} onChange={(e) => setOwner({ ...owner, name: e.target.value })} />
            <Input placeholder={t('temporaryPassword')} required minLength={10} value={owner.temporaryPassword} onChange={(e) => setOwner({ ...owner, temporaryPassword: e.target.value })} />
            <div className="sm:col-span-3"><Button type="submit" variant="secondary">{t('add')}</Button></div>
          </form>
        </Card>

        <Card title={t('branches')}>
          <ul className="mb-3 text-sm">{o.branches.map((b) => <li key={b.id} className="flex justify-between"><a className="text-brand-700 underline" href={`/ru/b/${b.slug}`} target="_blank" rel="noreferrer">{b.name}</a>{b.page && <Badge tone={b.page.moderationBlocked ? 'red' : statusTone(b.page.status)}>{st(b.page.moderationBlocked ? 'blocked' : b.page.status)}</Badge>}</li>)}</ul>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void act(() => api(apiPath`/admin/organizations/${id}/branches`, { method: 'POST', body: { name: branch.name, address: branch.address || undefined } })); }}>
            <Input placeholder={t('name')} required value={branch.name} onChange={(e) => setBranch({ ...branch, name: e.target.value })} />
            <Input placeholder={t('address')} value={branch.address} onChange={(e) => setBranch({ ...branch, address: e.target.value })} />
            <Button type="submit" variant="secondary">{t('add')}</Button>
          </form>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('history')}>
          <Table head={[t('date'), t('actions'), t('status'), '']} empty={!hist.data?.history.length}>
            {(hist.data?.history ?? []).map((h) => <tr key={h.id}><Td className="whitespace-nowrap">{new Date(h.createdAt).toLocaleString('ru-RU')}</Td><Td>{st(h.action)}</Td><Td>{h.fromStatus ? st(h.fromStatus) : '—'} → {h.toStatus ? st(h.toStatus) : '—'}</Td><Td className="text-xs">{h.note}</Td></tr>)}
          </Table>
        </Card>
        <Card title={t('payments')}>
          <Table head={[t('date'), t('amount'), t('method'), t('paymentRef')]} empty={!hist.data?.payments.length}>
            {(hist.data?.payments ?? []).map((p) => <tr key={p.id}><Td>{new Date(p.paidAt).toLocaleDateString('ru-RU')}</Td><Td>{money(p.amount)}</Td><Td>{t(`pay_${p.method}` as 'pay_kaspi')}</Td><Td>{p.reference}</Td></tr>)}
          </Table>
        </Card>
      </div>
    </div>
  );
}
