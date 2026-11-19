'use client';

import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Input, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { money } from '@/lib/format';

interface Plan {
  id: string;
  code: string;
  name: string;
  maxBranches: number;
  monthlyPrice: number;
  isActive: boolean;
}

export default function PlansPage() {
  const { t } = useT();
  const plans = useApi<Plan[]>('/admin/plans');
  const [f, setF] = useState({ code: '', name: '', maxBranches: '1', monthlyPrice: '0' });
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <PageHeader title={t('plans')} />
      <Alert>{error}</Alert>
      <Card>
        {plans.loading ? <Spinner /> : (
          <Table head={['code', t('name'), t('maxBranches'), t('price'), t('status')]}>
            {(plans.data ?? []).map((p) => (
              <tr key={p.id}>
                <Td><code>{p.code}</code></Td>
                <Td>{p.name}</Td>
                <Td>{p.maxBranches}</Td>
                <Td>{money(p.monthlyPrice)}</Td>
                <Td>
                  <button onClick={async () => { await api(`/admin/plans/${p.id}`, { method: 'PATCH', body: { isActive: !p.isActive } }); await plans.reload(); }}>
                    <Badge tone={p.isActive ? 'green' : 'slate'}>{p.isActive ? t('active') : '—'}</Badge>
                  </button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <form className="mt-4 grid gap-2 sm:grid-cols-5" onSubmit={async (e) => { e.preventDefault(); setError(null); try { await api('/admin/plans', { method: 'POST', body: { code: f.code, name: f.name, maxBranches: Number(f.maxBranches), monthlyPrice: Number(f.monthlyPrice) } }); setF({ code: '', name: '', maxBranches: '1', monthlyPrice: '0' }); await plans.reload(); } catch (err) { setError(errorMessage(err)); } }}>
          <Input placeholder="code" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <Input placeholder={t('name')} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input type="number" min={1} value={f.maxBranches} onChange={(e) => setF({ ...f, maxBranches: e.target.value })} />
          <Input type="number" min={0} value={f.monthlyPrice} onChange={(e) => setF({ ...f, monthlyPrice: e.target.value })} />
          <Button type="submit">{t('add')}</Button>
        </form>
      </Card>
    </div>
  );
}
