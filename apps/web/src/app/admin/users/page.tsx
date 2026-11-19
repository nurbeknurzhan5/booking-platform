'use client';

import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { errorMessage } from '@/lib/api';
import { withMfa } from '@/components/admin/mfa';
import { Alert, Badge, Button, Card, Input, PageHeader, Spinner, Table, Td } from '@/components/ui';

interface U {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isSuperadmin: boolean;
  blockedAt: string | null;
  lastLoginAt: string | null;
  orgRoles: Array<{ organizationId: string; roleCode: string }>;
}

export default function AdminUsers() {
  const { t } = useT();
  const [s, setS] = useState('');
  const list = useApi<U[]>(`/admin/users${s ? `?search=${encodeURIComponent(s)}` : ''}`);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (u: U) => {
    const reason = prompt(t('reason'));
    if (!reason) return;
    setError(null);
    try {
      await withMfa(`/admin/users/${u.id}/${u.blockedAt ? 'unblock' : 'block'}`, { method: 'POST', body: { reason } });
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div>
      <PageHeader title={t('users')} />
      <Alert>{error}</Alert>
      <Card>
        <Input value={s} onChange={(e) => setS(e.target.value)} placeholder={t('search')} className="mb-3 max-w-sm" />
        {list.loading ? <Spinner /> : (
          <Table head={[t('personName'), t('email'), t('phone'), 'roles', t('status'), '']} empty={!list.data?.length}>
            {(list.data ?? []).map((u) => (
              <tr key={u.id}>
                <Td>{u.name}</Td>
                <Td>{u.email}</Td>
                <Td>{u.phone}</Td>
                <Td className="text-xs">{u.isSuperadmin ? 'SUPERADMIN ' : ''}{u.orgRoles.map((r) => r.roleCode).join(', ')}</Td>
                <Td>{u.blockedAt ? <Badge tone="red">blocked</Badge> : <Badge tone="green">ok</Badge>}</Td>
                <Td>{!u.isSuperadmin && <Button size="sm" variant={u.blockedAt ? 'secondary' : 'danger'} onClick={() => toggle(u)}>{u.blockedAt ? t('unblock') : t('block')}</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
