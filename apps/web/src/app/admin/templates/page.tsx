'use client';

import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Spinner, Textarea, statusTone } from '@/components/ui';
import { apiPath } from '@/lib/api-path';

interface Tpl {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  version: number | null;
  config: unknown;
  publications: number;
}

/** Каталог шаблонов (§13.4): создание, новая версия конфигурации, публикация, отключение. */
export default function TemplatesAdmin() {
  const { t, st } = useT();
  const list = useApi<Tpl[]>(apiPath`/admin/templates`);
  const [editing, setEditing] = useState<{ id?: string; key: string; name: string; description: string; config: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setStatus = async (id: string, status: 'published' | 'disabled') => {
    setError(null);
    try {
      await api(apiPath`/admin/templates/${id}/status`, { method: 'POST', body: { status } });
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div>
      <PageHeader title={t('templates')} actions={<Button onClick={() => setEditing({ key: '', name: '', description: '', config: JSON.stringify(list.data?.[0]?.config ?? {}, null, 2) })}>+ {t('create')}</Button>} />
      <Alert>{error}</Alert>
      {list.loading ? <Spinner /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {(list.data ?? []).map((x) => (
            <Card key={x.id} title={<span>{x.name} <span className="text-xs text-slate-400">v{x.version}</span></span>} actions={<Badge tone={statusTone(x.status)}>{st(x.status)}</Badge>}>
              <p className="text-sm text-slate-600">{x.description}</p>
              <p className="mt-1 text-xs text-slate-400">{t('templateKey')}: {x.key} · {t('templateUsedBy')}: {x.publications}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing({ id: x.id, key: x.key, name: x.name, description: x.description ?? '', config: JSON.stringify(x.config, null, 2) })}>{t('edit')}</Button>
                {x.status !== 'published' && <Button size="sm" onClick={() => setStatus(x.id, 'published')}>{t('publish')}</Button>}
                {x.status === 'published' && <Button size="sm" variant="danger" onClick={() => { if (confirm(t('templateDisableConfirm'))) void setStatus(x.id, 'disabled'); }}>{t('disableAction')}</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <Card title={editing.id ? t('edit') : t('create')} className="mt-4">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('templateKey')}><Input value={editing.key} disabled={!!editing.id} onChange={(e) => setEditing({ ...editing, key: e.target.value })} /></Field>
              <Field label={t('name')}><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label={t('description')}><Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            </div>
            <Field label={t('templateConfig')}><Textarea rows={14} className="font-mono text-xs" value={editing.config} onChange={(e) => setEditing({ ...editing, config: e.target.value })} /></Field>
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  setError(null);
                  try {
                    const config = JSON.parse(editing.config);
                    if (editing.id) await api(apiPath`/admin/templates/${editing.id}`, { method: 'PATCH', body: { name: editing.name, description: editing.description, config } });
                    else await api(apiPath`/admin/templates`, { method: 'POST', body: { key: editing.key, name: editing.name, description: editing.description, config } });
                    setEditing(null);
                    await list.reload();
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                {t('save')}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
