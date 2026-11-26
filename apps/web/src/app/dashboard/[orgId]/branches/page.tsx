'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, statusTone } from '@/components/ui';
import { apiPath } from '@/lib/api-path';

export default function BranchesPage() {
  const { org, branches, reloadBranches, isOwner, canManage } = useOrg();
  const { t, st } = useT();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', phone: '', slug: '' });
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title={isOwner ? t('branches') : t('branch')} actions={isOwner && canManage && <Button onClick={() => setOpen(true)} data-testid="add-branch">+ {t('add')}</Button>} />
      <div className="grid gap-3 sm:grid-cols-2">
        {branches.map((b) => (
          <Link key={b.id} href={`/dashboard/${org.id}/branches/${b.id}`}>
            <Card className="h-full hover:border-brand-500">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{b.name}</div>
                  <div className="text-sm text-slate-500">{b.address ?? '—'}</div>
                  <div className="mt-1 text-xs text-slate-400">/b/{b.slug}</div>
                </div>
                {b.page && <Badge tone={statusTone(b.page.status)}>{b.page.publishedPublicationId ? t(`st_${b.page.status}` as 'st_active') : st('draft')}</Badge>}
              </div>
            </Card>
          </Link>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={t('add')}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await api(apiPath`/organizations/${org.id}/branches`, {
                method: 'POST',
                body: { name: form.name, address: form.address || undefined, phone: form.phone || undefined, slug: form.slug || undefined },
              });
              setOpen(false);
              setForm({ name: '', address: '', phone: '', slug: '' });
              await reloadBranches();
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <Alert>{error}</Alert>
          <Field label={t('name')}><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t('address')}><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label={t('phone')}><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label={t('slug')} hint={t('slugHint')}><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} pattern="[a-z0-9][a-z0-9-]{1,58}[a-z0-9]" /></Field>
          <div className="flex justify-end"><Button type="submit">{t('create')}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
