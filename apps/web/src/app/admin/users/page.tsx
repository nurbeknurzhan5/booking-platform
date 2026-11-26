'use client';

import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { errorMessage } from '@/lib/api';
import { withMfa } from '@/components/admin/mfa';
import { Alert, Badge, Button, Card, Input, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { apiPath, apiQuery } from '@/lib/api-path';

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
  const list = useApi<U[]>(apiPath`/admin/users${apiQuery({ search: s })}`);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Восстановление доступа (§3.4): временный пароль сообщается сотруднику лично, при входе он его сменит. */
  const resetPassword = async (u: U) => {
    const temporaryPassword = prompt(t('temporaryPasswordPrompt'));
    if (!temporaryPassword) return;
    const reason = prompt(t('reason'));
    if (!reason) return;
    setError(null);
    setNotice(null);
    try {
      await withMfa(apiPath`/admin/users/${u.id}/reset-password`, { method: 'POST', body: { temporaryPassword, reason } });
      setNotice(t('passwordResetDone'));
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const toggle = async (u: U) => {
    const reason = prompt(t('reason'));
    if (!reason) return;
    setError(null);
    try {
      await withMfa(apiPath`/admin/users/${u.id}/${u.blockedAt ? 'unblock' : 'block'}`, { method: 'POST', body: { reason } });
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div>
      <PageHeader title={t('users')} />
      <Alert>{error}</Alert>
      <Alert tone="green">{notice}</Alert>
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
                <Td className="space-x-2 whitespace-nowrap">
                  {u.email && !u.isSuperadmin && (
                    <Button size="sm" variant="secondary" onClick={() => resetPassword(u)}>{t('resetPassword')}</Button>
                  )}
                  {!u.isSuperadmin && <Button size="sm" variant={u.blockedAt ? 'secondary' : 'danger'} onClick={() => toggle(u)}>{u.blockedAt ? t('unblock') : t('block')}</Button>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
