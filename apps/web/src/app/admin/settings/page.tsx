'use client';

import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { errorMessage } from '@/lib/api';
import { withMfa } from '@/components/admin/mfa';
import { Alert, Button, Card, Field, Input, PageHeader, Spinner } from '@/components/ui';

interface Settings {
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  otpMaxPerPhonePerHour: number;
  otpMaxPerIpPerHour: number;
  notificationMaxAttempts: number;
  defaultGraceDays: number;
}

export default function SystemSettingsPage() {
  const { t } = useT();
  const { data, setData } = useApi<Settings>('/admin/settings');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  if (!data) return <Spinner />;
  return (
    <div>
      <PageHeader title={t('systemSettings')} />
      <Card>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setMsg({});
            try {
              const r = await withMfa<Settings>('/admin/settings', { method: 'PUT', body: data });
              if (r) {
                setData(r);
                setMsg({ ok: t('saved') });
              }
            } catch (err) {
              setMsg({ err: errorMessage(err) });
            }
          }}
        >
          <div className="sm:col-span-3"><Alert>{msg.err}</Alert>{msg.ok && <Alert tone="green">{msg.ok}</Alert>}</div>
          {(Object.keys(data) as Array<keyof Settings>).map((k) => (
            <Field key={k} label={t(`sys_${k}` as 'sys_otpTtlSeconds')} hint={t(`sysHint_${k}` as 'sysHint_otpTtlSeconds')}>
              <Input type="number" min={0} value={data[k]} onChange={(e) => setData({ ...data, [k]: Number(e.target.value) })} />
            </Field>
          ))}
          <div className="sm:col-span-3"><Button type="submit">{t('save')}</Button></div>
        </form>
      </Card>
    </div>
  );
}
