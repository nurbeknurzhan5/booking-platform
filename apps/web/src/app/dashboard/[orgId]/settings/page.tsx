'use client';

import { useEffect, useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, PageHeader, Spinner, Table, Tabs, Td, Textarea, statusTone } from '@/components/ui';
import { money } from '@/lib/format';
import { apiPath, type ApiPath } from '@/lib/api-path';

type Tab = 'profile' | 'subscription' | 'notifications' | 'audit';

interface Sub {
  status: string;
  subscription: null | { plan: { name: string }; maxBranches: number; branchesUsed: number; price: number; startsAt: string; endsAt: string; graceEndsAt: string; lastPaymentAt: string | null; lastPaymentAmount: number | null; suspendedReason: string | null };
}

/** Настройки организации: профиль, подписка (только просмотр), уведомления, журнал действий. */
export default function SettingsPage() {
  const { base, org } = useOrg();
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('profile');
  return (
    <div>
      <PageHeader title={t('organization')} subtitle={org.name} />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'profile', label: t('settings') }, { value: 'subscription', label: t('subscription') }, { value: 'notifications', label: t('notifications') }, { value: 'audit', label: t('audit') }]} />
      {tab === 'profile' && <Profile />}
      {tab === 'subscription' && <Subscription base={base} />}
      {tab === 'notifications' && <Notifications base={base} />}
      {tab === 'audit' && <Audit base={base} />}
    </div>
  );
}

function Profile() {
  const { base } = useOrg();
  const { t } = useT();
  const { data } = useApi<{ name: string; description: string | null; contacts: { phone?: string; email?: string; website?: string }; defaultLocale: string }>(base);
  const [f, setF] = useState<{ name: string; description: string; phone: string; email: string; website: string; defaultLocale: string } | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  useEffect(() => {
    if (data) setF({ name: data.name, description: data.description ?? '', phone: data.contacts?.phone ?? '', email: data.contacts?.email ?? '', website: data.contacts?.website ?? '', defaultLocale: data.defaultLocale });
  }, [data]);
  if (!f) return <Spinner />;
  return (
    <Card>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); setMsg({}); try { await api(base, { method: 'PATCH', body: { name: f.name, description: f.description, defaultLocale: f.defaultLocale, contacts: { ...(f.phone ? { phone: f.phone } : {}), ...(f.email ? { email: f.email } : {}), ...(f.website ? { website: f.website } : {}) } } }); setMsg({ ok: t('saved') }); } catch (err) { setMsg({ err: errorMessage(err) }); } }}>
        <div className="sm:col-span-2"><Alert>{msg.err}</Alert>{msg.ok && <Alert tone="green">{msg.ok}</Alert>}</div>
        <Field label={t('name')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('primaryLocale')}>
          <select value={f.defaultLocale} onChange={(e) => setF({ ...f, defaultLocale: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="ru">Русский</option>
            <option value="kk">Қазақша</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field label={t('description')} className="sm:col-span-2"><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label={t('phone')}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label={t('email')}><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Web"><Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></Field>
        <div className="flex justify-end sm:col-span-2"><Button type="submit">{t('save')}</Button></div>
      </form>
    </Card>
  );
}

function Subscription({ base }: { base: ApiPath }) {
  const { t, st } = useT();
  const { data } = useApi<Sub>(apiPath`${base}/subscription`);
  if (!data) return <Spinner />;
  const s = data.subscription;
  return (
    <Card>
      <p className="mb-3"><Badge tone={statusTone(data.status)}>{st(data.status)}</Badge></p>
      {s && (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">{t('plan')}</dt><dd>{s.plan.name}</dd></div>
          <div><dt className="text-slate-500">{t('maxBranches')}</dt><dd>{s.branchesUsed} / {s.maxBranches}</dd></div>
          <div><dt className="text-slate-500">{t('price')}</dt><dd>{money(s.price)}</dd></div>
          <div><dt className="text-slate-500">{t('periodEnds')}</dt><dd>{new Date(s.endsAt).toLocaleDateString('ru-RU')}</dd></div>
          <div><dt className="text-slate-500">{t('graceUntil')}</dt><dd>{new Date(s.graceEndsAt).toLocaleDateString('ru-RU')}</dd></div>
          <div><dt className="text-slate-500">{t('lastPayment')}</dt><dd>{s.lastPaymentAt ? `${new Date(s.lastPaymentAt).toLocaleDateString('ru-RU')} · ${money(s.lastPaymentAmount ?? 0)}` : '—'}</dd></div>
          {s.suspendedReason && <div className="sm:col-span-2 text-rose-700">{s.suspendedReason}</div>}
        </dl>
      )}
    </Card>
  );
}

function Notifications({ base }: { base: ApiPath }) {
  const { t, st } = useT();
  const { data, setData } = useApi<{
    whatsappEnabled: boolean;
    smsEnabled: boolean;
    reminderEnabled: boolean;
    reviewRequestEnabled: boolean;
    reactivationEnabled: boolean;
    reactivationDays: number;
  }>(apiPath`${base}/notification-settings`);
  const log = useApi<Array<{ id: string; type: string; channel: string; recipient: string; status: string; attempts: number; lastError: string | null; createdAt: string }>>(apiPath`${base}/notifications`);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <Spinner />;
  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['whatsappEnabled', 'smsEnabled', 'reminderEnabled', 'reviewRequestEnabled'] as const).map((k) => (
            <Checkbox key={k} checked={data[k]} onChange={(e) => setData({ ...data, [k]: e.target.checked })} label={t(k)} />
          ))}
        </div>
        <fieldset className="mt-4 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium">{t('reactivation')}</legend>
          <Checkbox
            checked={data.reactivationEnabled}
            onChange={(e) => setData({ ...data, reactivationEnabled: e.target.checked })}
            label={t('reactivationEnabled')}
            data-testid="reactivation-enabled"
          />
          <Field label={t('reactivationDays')} hint={t('reactivationHint')} className="mt-2 max-w-xs">
            <Input
              type="number"
              min={30}
              max={365}
              value={data.reactivationDays}
              disabled={!data.reactivationEnabled}
              onChange={(e) => setData({ ...data, reactivationDays: Number(e.target.value) })}
              data-testid="reactivation-days"
            />
          </Field>
        </fieldset>
        {err && <div className="mt-3" data-testid="notification-settings-error"><Alert>{err}</Alert></div>}
        <div className="mt-3 flex items-center justify-end gap-3">
          {msg && <span className="text-sm text-emerald-600">{msg}</span>}
          <Button
            onClick={async () => {
              setErr(null);
              setMsg(null);
              try {
                await api(apiPath`${base}/notification-settings`, { method: 'PUT', body: data });
                setMsg(t('saved'));
              } catch (e) {
                setErr(errorMessage(e));
              }
            }}
          >
            {t('save')}
          </Button>
        </div>
      </Card>
      <Card title={t('notifications')}>
        <Table head={[t('date'), t('type'), t('channel'), t('phone'), t('status')]} empty={!log.data?.length}>
          {(log.data ?? []).map((n) => (
            <tr key={n.id}>
              <Td className="whitespace-nowrap">{new Date(n.createdAt).toLocaleString('ru-RU')}</Td>
              <Td>{st(n.type)}</Td>
              <Td>{st(n.channel)}</Td>
              <Td>{n.recipient}</Td>
              <Td><Badge tone={statusTone(n.status)}>{st(n.status)}</Badge>{n.lastError && <div className="max-w-xs truncate text-xs text-rose-600" title={n.lastError}>{n.lastError}</div>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function Audit({ base }: { base: ApiPath }) {
  const { t } = useT();
  const { data, loading } = useApi<Array<{ id: string; action: string; entityType: string; entityId: string | null; actorType: string; createdAt: string; actor: { name: string } | null }>>(apiPath`${base}/audit-logs`);
  if (loading) return <Spinner />;
  return (
    <Card>
      <Table head={[t('date'), t('actions'), '', '']} empty={!data?.length}>
        {(data ?? []).map((a) => (
          <tr key={a.id}>
            <Td className="whitespace-nowrap">{new Date(a.createdAt).toLocaleString('ru-RU')}</Td>
            <Td><code className="text-xs">{a.action}</code></Td>
            <Td className="text-xs text-slate-500">{a.entityType}</Td>
            <Td className="text-xs">{a.actor?.name ?? a.actorType}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
