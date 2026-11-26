'use client';

import { useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, PageHeader, Tabs } from '@/components/ui';
import { ScheduleTab } from '@/components/dashboard/ScheduleTab';
import { ShiftsBoard } from '@/components/dashboard/ShiftsBoard';
import { apiPath } from '@/lib/api-path';

type Settings = Record<string, unknown> & { scheduleMode: 'weekly' | 'shifts' };

/**
 * График филиала (§7, задача 21): смены специалистов по датам и недельный график филиала, специалистов и ресурсов.
 * Режим «по сменам»: специалист доступен для записи только в назначенные смены.
 */
export default function SchedulePage() {
  const { base, branch, can, isOwner } = useOrg();
  const { t } = useT();
  const settingsUrl = branch ? apiPath`${base}/branches/${branch.id}/booking-settings` : null;
  const settings = useApi<Settings>(settingsUrl);
  const mode = settings.data?.scheduleMode ?? 'weekly';
  const [tab, setTab] = useState<'shifts' | 'weekly' | null>(null);
  const current = tab ?? (mode === 'shifts' ? 'shifts' : 'weekly');
  const [err, setErr] = useState<string | null>(null);
  const canSwitch = isOwner && !!branch && can('booking_settings.manage', branch.id);

  if (!branch) return <Card><p className="text-sm text-slate-500">{t('noBranchSelected')}</p></Card>;

  const switchMode = async () => {
    if (!settings.data || !settingsUrl) return;
    const next = mode === 'shifts' ? 'weekly' : 'shifts';
    if (!confirm(next === 'shifts' ? t('shiftsModeConfirmOn') : t('shiftsModeConfirmOff'))) return;
    setErr(null);
    try {
      const body: Record<string, unknown> = { ...settings.data, scheduleMode: next };
      for (const k of ['id', 'branchId', 'organizationId', 'createdAt', 'updatedAt']) delete body[k];
      settings.setData(await api<Settings>(settingsUrl, { method: 'PUT', body }));
      setTab(next === 'shifts' ? 'shifts' : 'weekly');
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        title={t('resourcesSchedule')}
        subtitle={branch.name}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={mode === 'shifts' ? 'green' : 'slate'}>{mode === 'shifts' ? t('modeShifts') : t('modeWeekly')}</Badge>
            {canSwitch && settings.data && (
              <Button size="sm" variant="secondary" onClick={switchMode} data-testid="switch-schedule-mode">
                {mode === 'shifts' ? t('switchToWeekly') : t('switchToShifts')}
              </Button>
            )}
          </div>
        }
      />
      <Alert>{err}</Alert>
      <Tabs
        value={current}
        onChange={setTab}
        items={[
          { value: 'shifts', label: t('shiftsByDate') },
          { value: 'weekly', label: t('weeklySchedule') },
        ]}
      />
      {current === 'shifts' ? <ShiftsBoard branchId={branch.id} /> : <ScheduleTab branchId={branch.id} />}
    </div>
  );
}
