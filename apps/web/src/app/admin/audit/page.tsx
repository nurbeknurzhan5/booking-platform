'use client';

import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { Card, Input, PageHeader, Spinner, Table, Td } from '@/components/ui';

interface Row {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorType: string;
  organizationId: string | null;
  ip: string | null;
  createdAt: string;
  actor: { name: string; email: string | null } | null;
}

export default function AuditPage() {
  const { t } = useT();
  const [action, setAction] = useState('');
  const { data, loading } = useApi<Row[]>(`/admin/audit-logs${action ? `?action=${encodeURIComponent(action)}` : ''}`);
  return (
    <div>
      <PageHeader title={t('audit')} />
      <Card>
        <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="action prefix (organization., subscription., auth.)" className="mb-3 max-w-sm" />
        {loading ? <Spinner /> : (
          <Table head={[t('date'), t('actions'), 'entity', 'actor', 'IP']} empty={!data?.length}>
            {(data ?? []).map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{new Date(r.createdAt).toLocaleString('ru-RU')}</Td>
                <Td><code className="text-xs">{r.action}</code></Td>
                <Td className="text-xs">{r.entityType} {r.entityId?.slice(0, 8)}</Td>
                <Td className="text-xs">{r.actor?.email ?? r.actorType}</Td>
                <Td className="text-xs">{r.ip}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
