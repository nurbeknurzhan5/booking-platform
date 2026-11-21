'use client';

import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { Badge, Card, PageHeader, Spinner } from '@/components/ui';
import { money } from '@/lib/format';

interface Stats {
  organizations: number;
  subscriptions: Record<string, number>;
  branches: number;
  users: number;
  appointmentsLast30Days: number;
  appointmentsByStatus: Record<string, number>;
  notificationQueue: Record<string, number>;
  paymentsLast30Days: number;
}
interface Integrations {
  notificationChannels: string[];
  otpChannels: string[];
  whatsapp: { configured: boolean; webhookSecretConfigured: boolean; apiVersion: string };
  sms: { provider: string; configured: boolean };
  translation: { configured: boolean };
  storage: { driver: string; s3Configured: boolean };
  environment: string;
}

export default function AdminHome() {
  const { t, st } = useT();
  const stats = useApi<Stats>('/admin/stats');
  const integ = useApi<Integrations>('/admin/integrations');
  if (!stats.data) return <Spinner />;
  const s = stats.data;
  const tile = (label: string, v: string | number) => (
    <Card key={label}><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-semibold">{v}</p></Card>
  );
  return (
    <div className="space-y-4">
      <PageHeader title={t('systemStats')} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tile(t('organizations'), s.organizations)}
        {tile(t('branches'), s.branches)}
        {tile(t('usersTotal'), s.users)}
        {tile(`${t('appointments')} · 30 ${t('daysShort')}`, s.appointmentsLast30Days)}
        {tile(`${t('payments')} · 30 ${t('daysShort')}`, money(s.paymentsLast30Days))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('subscription')}>{Object.entries(s.subscriptions).map(([k, v]) => <p key={k} className="flex justify-between text-sm"><span>{st(k)}</span><b>{v}</b></p>)}</Card>
        <Card title={t('appointments')}>{Object.entries(s.appointmentsByStatus).map(([k, v]) => <p key={k} className="flex justify-between text-sm"><span>{st(k)}</span><b>{v}</b></p>)}</Card>
        <Card title={t('queues')}>{Object.entries(s.notificationQueue).map(([k, v]) => <p key={k} className="flex justify-between text-sm"><span>{st(k)}</span><b className={k === 'dead' ? 'text-rose-600' : ''}>{v}</b></p>)}</Card>
      </div>
      {integ.data && (
        <Card title={t('integrations')}>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {([
              [`WhatsApp Cloud API ${integ.data.whatsapp.apiVersion}`, integ.data.whatsapp.configured, true],
              [t('adminWebhookSignature'), integ.data.whatsapp.webhookSecretConfigured, true],
              [`SMS (${integ.data.sms.provider})`, integ.data.sms.configured, false],
              ['Google Translate', integ.data.translation.configured, false],
              [t('adminObjectStorage'), integ.data.storage.driver === 's3' && integ.data.storage.s3Configured, true],
            ] as const).map(([label, ok, important]) => (
              <div key={label} className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5">
                <dt>{label}</dt>
                <dd><Badge tone={ok ? 'green' : important ? 'amber' : 'slate'}>{ok ? t('integrationConnected') : t('integrationNotConnected')}</Badge></dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5">
              <dt>{t('adminEnvironment')}</dt>
              <dd><Badge>{integ.data.environment}</Badge></dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5">
              <dt>{t('adminChannels')}</dt>
              <dd className="text-right">{integ.data.notificationChannels.map(st).join(', ') || '—'}</dd>
            </div>
          </dl>
        </Card>
      )}
    </div>
  );
}
