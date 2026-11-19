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
  const { t } = useT();
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
        {tile(t('users'), s.users)}
        {tile(`${t('appointments')} (30d)`, s.appointmentsLast30Days)}
        {tile(`${t('payments')} (30d)`, money(s.paymentsLast30Days))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('subscription')}>{Object.entries(s.subscriptions).map(([k, v]) => <p key={k} className="flex justify-between text-sm"><span>{k}</span><b>{v}</b></p>)}</Card>
        <Card title={t('appointments')}>{Object.entries(s.appointmentsByStatus).map(([k, v]) => <p key={k} className="flex justify-between text-sm"><span>{k}</span><b>{v}</b></p>)}</Card>
        <Card title={t('queues')}>{Object.entries(s.notificationQueue).map(([k, v]) => <p key={k} className="flex justify-between text-sm"><span>{k}</span><b className={k === 'dead' ? 'text-rose-600' : ''}>{v}</b></p>)}</Card>
      </div>
      {integ.data && (
        <Card title={t('integrations')}>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone={integ.data.whatsapp.configured ? 'green' : 'red'}>WhatsApp Cloud API {integ.data.whatsapp.apiVersion}</Badge>
            <Badge tone={integ.data.whatsapp.webhookSecretConfigured ? 'green' : 'amber'}>Webhook signature</Badge>
            <Badge tone={integ.data.sms.configured ? 'green' : 'slate'}>SMS ({integ.data.sms.provider})</Badge>
            <Badge tone={integ.data.translation.configured ? 'green' : 'slate'}>Google Translate</Badge>
            <Badge tone={integ.data.storage.driver === 's3' ? 'green' : 'amber'}>Storage: {integ.data.storage.driver}</Badge>
            <Badge>{integ.data.environment}</Badge>
            <Badge>channels: {integ.data.notificationChannels.join(', ') || '—'}</Badge>
          </div>
        </Card>
      )}
    </div>
  );
}
