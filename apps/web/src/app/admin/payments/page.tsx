'use client';

import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { Card, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { money } from '@/lib/format';
import { apiPath } from '@/lib/api-path';

export default function PaymentsPage() {
  const { t } = useT();
  const { data, loading } = useApi<Array<{ id: string; amount: number; paidAt: string; method: string; reference: string | null; organization: { id: string; name: string } }>>(apiPath`/admin/payments`);
  return (
    <div>
      <PageHeader title={t('payments')} />
      <Card>
        {loading ? <Spinner /> : (
          <Table head={[t('date'), t('organization'), t('amount'), t('method'), 'Ref']} empty={!data?.length}>
            {(data ?? []).map((p) => (
              <tr key={p.id}>
                <Td>{new Date(p.paidAt).toLocaleDateString('ru-RU')}</Td>
                <Td><Link className="text-brand-700" href={`/admin/organizations/${p.organization.id}`}>{p.organization.name}</Link></Td>
                <Td>{money(p.amount)}</Td>
                <Td>{p.method}</Td>
                <Td>{p.reference}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
