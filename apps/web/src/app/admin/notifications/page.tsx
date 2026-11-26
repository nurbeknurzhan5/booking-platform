'use client';

import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, PageHeader, Select, Spinner, Table, Td, statusTone } from '@/components/ui';
import { apiPath, apiQuery } from '@/lib/api-path';

interface Row {
  id: string;
  type: string;
  channel: string;
  recipient: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  attemptsLog: Array<{ attemptNo: number; success: boolean; errorCode: string | null }>;
}

/** Очереди сообщений, ошибки доставки, DLQ и ручной повтор (§3.4, §15.2). */
export default function NotificationsAdmin() {
  const { t, st } = useT();
  const [status, setStatus] = useState('dead');
  const list = useApi<Row[]>(apiPath`/admin/notifications${apiQuery({ status })}`);
  const stats = useApi<Array<{ status: string; channel: string; count: number }>>(apiPath`/admin/notifications/stats`);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <PageHeader title={t('queues')} />
      <Alert>{error}</Alert>
      <Card className="mb-4">
        <div className="flex flex-wrap gap-2 text-sm">
          {(stats.data ?? []).map((s) => <Badge key={`${s.status}-${s.channel}`} tone={statusTone(s.status)}>{st(s.channel)} · {st(s.status)}: {s.count}</Badge>)}
        </div>
      </Card>
      <Card actions={
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label={t('status')}>
          {['', 'pending', 'sending', 'sent', 'delivered', 'read', 'failed', 'dead', 'cancelled'].map((s) => <option key={s} value={s}>{s ? st(s) : `${t('status')}: —`}</option>)}
        </Select>
      }>
        {list.loading ? <Spinner /> : (
          <Table head={[t('date'), t('type'), t('channel'), t('phone'), t('status'), t('errors'), '']} empty={!list.data?.length}>
            {(list.data ?? []).map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{new Date(r.createdAt).toLocaleString('ru-RU')}</Td>
                <Td>{st(r.type)}</Td>
                <Td>{st(r.channel)}</Td>
                <Td>{r.recipient}</Td>
                <Td><Badge tone={statusTone(r.status)}>{st(r.status)}</Badge> <span className="text-xs text-slate-400">{r.attempts}/{r.maxAttempts}</span></Td>
                <Td className="max-w-sm text-xs text-rose-700">{r.lastError}</Td>
                <Td>{r.status === 'dead' && <Button size="sm" variant="secondary" onClick={async () => { setError(null); try { await api(apiPath`/admin/notifications/${r.id}/retry`, { method: 'POST' }); await list.reload(); } catch (e) { setError(errorMessage(e)); } }}>{t('retry')}</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
