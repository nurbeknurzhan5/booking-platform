'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { Alert, Badge, Card, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { apiPath } from '@/lib/api-path';

interface Delivery {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
}

interface Integrations {
  whatsapp: { platformConnected: boolean; enabledForOrg: boolean; inboundAutoReply: boolean; reactivationEnabled: boolean; last7Days: Delivery };
  sms: { platformConnected: boolean; enabledForOrg: boolean; last7Days: Delivery };
  email: { available: boolean };
  translation: { provider: string; autoAvailable: boolean };
  map: { provider: string; branches: Array<{ id: string; name: string; mapEnabled: boolean; hasCoordinates: boolean; hasMapUrl: boolean; hasAddress: boolean }> };
  testMode: boolean;
}

/**
 * Интеграции организации (§18.3). Доступы к провайдерам подключает платформа. Владелец видит их состояние,
 * включает каналы в настройках уведомлений и настраивает карту в карточке филиала.
 */
export default function IntegrationsPage() {
  const { base, org } = useOrg();
  const { t } = useT();
  const { data, loading, error } = useApi<Integrations>(apiPath`${base}/integrations`);
  const settingsHref = `/dashboard/${org.id}/settings`;

  const state = (ok: boolean, onLabel = t('integrationOn'), offLabel = t('integrationOff')) => (
    <Badge tone={ok ? 'green' : 'slate'}>{ok ? onLabel : offLabel}</Badge>
  );
  const row = (label: ReactNode, value: ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-600">{label}</span>
      <span>{value}</span>
    </div>
  );
  const delivery = (d: Delivery) => (
    <div className="mt-3 grid grid-cols-5 gap-2 text-center text-xs" data-testid="delivery">
      {([['sent', d.sent], ['delivered', d.delivered], ['read', d.read], ['failed', d.failed], ['pending', d.pending]] as const).map(([k, v]) => (
        <div key={k} className="rounded-lg bg-slate-50 p-2">
          <div className={`text-lg font-semibold ${k === 'failed' && v > 0 ? 'text-rose-600' : ''}`}>{v}</div>
          <div className="text-slate-500">{t(`delivery_${k}`)}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <PageHeader title={t('integrations')} subtitle={t('integrationsSubtitle')} />
      <Alert>{error}</Alert>
      {loading ? (
        <Spinner />
      ) : !data ? null : (
        <div className="space-y-4">
          {data.testMode && <Alert tone="amber">{t('integrationsTestMode')}</Alert>}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="WhatsApp Business Platform">
              {row(t('integrationPlatform'), state(data.whatsapp.platformConnected, t('integrationConnected'), t('integrationNotConnected')))}
              {row(<Link href={settingsHref} className="underline">{t('integrationForOrg')}</Link>, state(data.whatsapp.enabledForOrg))}
              {row(t('integrationAutoReply'), state(data.whatsapp.inboundAutoReply))}
              {row(<Link href={settingsHref} className="underline">{t('reactivation')}</Link>, state(data.whatsapp.reactivationEnabled))}
              <p className="mt-2 text-xs text-slate-500">{t('integrationLast7')}</p>
              {delivery(data.whatsapp.last7Days)}
            </Card>
            <Card title="SMS">
              {row(t('integrationPlatform'), state(data.sms.platformConnected, t('integrationConnected'), t('integrationNotConnected')))}
              {row(<Link href={settingsHref} className="underline">{t('integrationForOrg')}</Link>, state(data.sms.enabledForOrg))}
              <p className="mt-2 text-xs text-slate-500">{t('integrationLast7')}</p>
              {delivery(data.sms.last7Days)}
            </Card>
            <Card title={t('integrationTranslation')}>
              {row('Google Translate', state(data.translation.autoAvailable, t('integrationConnected'), t('integrationNotConnected')))}
              <p className="mt-2 text-xs text-slate-500">{data.translation.autoAvailable ? t('integrationTranslationOn') : t('integrationTranslationOff')}</p>
            </Card>
            <Card title="Email">
              {row(t('integrationStatus'), <Badge>{t('integrationEmailLater')}</Badge>)}
            </Card>
          </div>
          <Card title={t('integrationMap')}>
            <p className="mb-3 text-xs text-slate-500">{t('integrationMapHint')}</p>
            <Table head={[t('branch'), t('integrationMapShown'), t('integrationMapLink')]} empty={!data.map.branches.length}>
              {data.map.branches.map((b) => (
                <tr key={b.id}>
                  <Td>
                    <Link href={`/dashboard/${org.id}/branches/${b.id}`} className="underline">{b.name}</Link>
                  </Td>
                  <Td>{state(b.mapEnabled)}</Td>
                  <Td className="text-xs">
                    {b.hasMapUrl ? t('integrationMapOwnLink') : b.hasCoordinates ? t('integrationMapByCoords') : b.hasAddress ? t('integrationMapByAddress') : <span className="text-amber-700">{t('integrationMapMissing')}</span>}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
