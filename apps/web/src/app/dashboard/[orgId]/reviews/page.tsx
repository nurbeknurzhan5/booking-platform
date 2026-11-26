'use client';

import { useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Input, PageHeader, Spinner, statusTone } from '@/components/ui';
import { apiPath } from '@/lib/api-path';

interface Review {
  id: string;
  rating: number;
  text: string | null;
  authorName: string;
  status: string;
  reply: string | null;
  reportedAt: string | null;
  createdAt: string;
  appointment: { startAt: string; items: Array<{ serviceNameSnapshot: string; specialistNameSnapshot: string | null }> };
}

/** Отзывы: ответ организации и жалоба модератору; изменить текст отзыва нельзя (§14). */
export default function ReviewsPage() {
  const { base, branch } = useOrg();
  const { t, st } = useT();
  const list = useApi<Review[]>(branch ? apiPath`${base}/reviews?branchId=${branch.id}` : null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <PageHeader title={t('reviews')} />
      <Alert>{error}</Alert>
      {list.loading ? <Spinner /> : (
        <div className="space-y-3">
          {(list.data ?? []).length === 0 && <Card><p className="text-sm text-slate-500">{t('empty')}</p></Card>}
          {(list.data ?? []).map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-amber-500">{'★'.repeat(r.rating)}<span className="text-slate-200">{'★'.repeat(5 - r.rating)}</span></div>
                  <p className="mt-1">{r.text ?? '—'}</p>
                  <p className="mt-1 text-xs text-slate-500">{r.authorName} · {new Date(r.createdAt).toLocaleDateString('ru-RU')} · {r.appointment.items.map((i) => i.serviceNameSnapshot).join(', ')}</p>
                </div>
                <div className="flex gap-1">
                  <Badge tone={statusTone(r.status)}>{st(r.status)}</Badge>
                  {r.reportedAt && <Badge tone="amber">{t('report')}</Badge>}
                </div>
              </div>
              {r.reply && <p className="mt-2 border-l-2 border-brand-500 pl-2 text-sm text-slate-700">{r.reply}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Input value={reply[r.id] ?? ''} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} placeholder={t('reply')} className="max-w-md" />
                <Button size="sm" disabled={!reply[r.id]} onClick={async () => { try { await api(apiPath`${base}/reviews/${r.id}/reply`, { method: 'POST', body: { text: reply[r.id] } }); setReply({ ...reply, [r.id]: '' }); await list.reload(); } catch (e) { setError(errorMessage(e)); } }}>{t('reply')}</Button>
                {!r.reportedAt && (
                  <Button size="sm" variant="ghost" onClick={async () => { const reason = prompt(t('reason')); if (!reason) return; try { await api(apiPath`${base}/reviews/${r.id}/report`, { method: 'POST', body: { reason } }); await list.reload(); } catch (e) { setError(errorMessage(e)); } }}>{t('report')}</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
