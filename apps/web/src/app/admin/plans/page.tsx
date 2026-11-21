'use client';

import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { money } from '@/lib/format';

interface Plan {
  id: string;
  code: string;
  name: string;
  maxBranches: number;
  monthlyPrice: number;
  isActive: boolean;
}

/** Тарифы (§3.4): создание, изменение, включение и отключение. Изменение не затрагивает действующие подписки. */
export default function PlansPage() {
  const { t } = useT();
  const plans = useApi<Plan[]>('/admin/plans');
  const empty = { code: '', name: '', maxBranches: '1', monthlyPrice: '0' };
  const [f, setF] = useState(empty);
  const [edit, setEdit] = useState<{ id: string; name: string; maxBranches: string; monthlyPrice: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await plans.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div>
      <PageHeader title={t('plans')} subtitle={t('plansHint')} />
      <Alert>{error}</Alert>
      <Card>
        {plans.loading ? <Spinner /> : (
          <Table head={[t('templateKey'), t('name'), t('maxBranches'), t('pricePerMonth'), t('status'), '']}>
            {(plans.data ?? []).map((p) =>
              edit?.id === p.id ? (
                <tr key={p.id}>
                  <Td><code>{p.code}</code></Td>
                  <Td><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label={t('name')} /></Td>
                  <Td><Input type="number" min={1} value={edit.maxBranches} onChange={(e) => setEdit({ ...edit, maxBranches: e.target.value })} className="w-24" aria-label={t('maxBranches')} /></Td>
                  <Td><Input type="number" min={0} value={edit.monthlyPrice} onChange={(e) => setEdit({ ...edit, monthlyPrice: e.target.value })} className="w-32" aria-label={t('pricePerMonth')} /></Td>
                  <Td />
                  <Td className="space-x-2 whitespace-nowrap">
                    <Button size="sm" onClick={() => run(async () => { await api(`/admin/plans/${p.id}`, { method: 'PATCH', body: { name: edit.name, maxBranches: Number(edit.maxBranches), monthlyPrice: Number(edit.monthlyPrice) } }); setEdit(null); })}>{t('save')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>{t('cancel')}</Button>
                  </Td>
                </tr>
              ) : (
                <tr key={p.id}>
                  <Td><code>{p.code}</code></Td>
                  <Td>{p.name}</Td>
                  <Td>{p.maxBranches}</Td>
                  <Td>{money(p.monthlyPrice)}</Td>
                  <Td><Badge tone={p.isActive ? 'green' : 'slate'}>{p.isActive ? t('active') : t('integrationOff')}</Badge></Td>
                  <Td className="space-x-2 whitespace-nowrap">
                    <Button size="sm" variant="secondary" onClick={() => setEdit({ id: p.id, name: p.name, maxBranches: String(p.maxBranches), monthlyPrice: String(p.monthlyPrice) })}>{t('edit')}</Button>
                    <Button size="sm" variant={p.isActive ? 'ghost' : 'secondary'} onClick={() => run(() => api(`/admin/plans/${p.id}`, { method: 'PATCH', body: { isActive: !p.isActive } }))}>
                      {p.isActive ? t('disableAction') : t('enableAction')}
                    </Button>
                  </Td>
                </tr>
              ),
            )}
          </Table>
        )}
      </Card>
      <Card title={t('planNew')} className="mt-4">
        <form
          className="grid items-end gap-3 sm:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api('/admin/plans', { method: 'POST', body: { code: f.code, name: f.name, maxBranches: Number(f.maxBranches), monthlyPrice: Number(f.monthlyPrice) } });
              setF(empty);
            });
          }}
        >
          <Field label={t('templateKey')} hint={t('planCodeHint')}><Input required pattern="[a-z0-9_-]{2,40}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <Field label={t('name')}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('maxBranches')}><Input type="number" min={1} value={f.maxBranches} onChange={(e) => setF({ ...f, maxBranches: e.target.value })} /></Field>
          <Field label={t('pricePerMonth')}><Input type="number" min={0} value={f.monthlyPrice} onChange={(e) => setF({ ...f, monthlyPrice: e.target.value })} /></Field>
          <Button type="submit">{t('add')}</Button>
        </form>
      </Card>
    </div>
  );
}
