'use client';

import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, PageHeader, Spinner, Table, Tabs, Td, statusTone } from '@/components/ui';

interface PageRow {
  id: string;
  status: string;
  moderationBlocked: boolean;
  moderationReason: string | null;
  branch: { name: string; slug: string; organization: { name: string } };
}
interface ReviewRow {
  id: string;
  rating: number;
  text: string | null;
  status: string;
  reportReason: string | null;
  reportedAt: string | null;
  branch: { name: string; slug: string };
}

/** Модерация публичного контента и отзывов с фиксацией причины (§13.8, §14). */
export default function Moderation() {
  const { t } = useT();
  const [tab, setTab] = useState<'pages' | 'reviews'>('pages');
  const pages = useApi<PageRow[]>('/admin/pages');
  const reviews = useApi<ReviewRow[]>('/admin/reviews');
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await Promise.all([pages.reload(), reviews.reload()]);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div>
      <PageHeader title={t('moderation')} />
      <Alert>{error}</Alert>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'pages', label: t('pages') }, { value: 'reviews', label: t('reviews') }]} />
      <Card>
        {tab === 'pages' && (pages.loading ? <Spinner /> : (
          <Table head={[t('organization'), t('branch'), t('status'), t('moderation'), '']}>
            {(pages.data ?? []).map((p) => (
              <tr key={p.id}>
                <Td>{p.branch.organization.name}</Td>
                <Td><a className="text-brand-700 underline" href={`/ru/b/${p.branch.slug}`} target="_blank" rel="noreferrer">{p.branch.name}</a></Td>
                <Td><Badge tone={statusTone(p.status)}>{p.status}</Badge></Td>
                <Td>{p.moderationBlocked ? <Badge tone="red">{p.moderationReason}</Badge> : '—'}</Td>
                <Td>
                  <Button size="sm" variant={p.moderationBlocked ? 'secondary' : 'danger'} onClick={() => { const reason = prompt(t('reason')); if (reason) void run(() => api(`/admin/pages/${p.id}/moderation`, { method: 'POST', body: { blocked: !p.moderationBlocked, reason } })); }}>
                    {p.moderationBlocked ? t('unblock') : t('block')}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        ))}
        {tab === 'reviews' && (reviews.loading ? <Spinner /> : (
          <Table head={[t('branch'), t('rating'), t('description'), t('report'), t('status'), '']}>
            {(reviews.data ?? []).map((r) => (
              <tr key={r.id}>
                <Td>{r.branch.name}</Td>
                <Td>{'★'.repeat(r.rating)}</Td>
                <Td className="max-w-xs">{r.text}</Td>
                <Td className="text-xs text-amber-700">{r.reportReason}</Td>
                <Td><Badge tone={statusTone(r.status)}>{r.status}</Badge></Td>
                <Td>
                  <Button size="sm" variant="secondary" onClick={() => { const reason = prompt(t('reason')); if (reason) void run(() => api(`/admin/reviews/${r.id}/moderate`, { method: 'POST', body: { status: r.status === 'published' ? 'hidden' : 'published', reason } })); }}>
                    {r.status === 'published' ? t('block') : t('publish')}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        ))}
      </Card>
    </div>
  );
}
