'use client';

import { useOrg } from '@/components/dashboard/OrgContext';
import { useT } from '@/lib/i18n-dashboard';
import { Card, PageHeader } from '@/components/ui';
import { ResourcesTab } from '@/components/dashboard/BranchStaffTabs';

/** Ресурсы выбранного филиала: кабинеты, залы, места, оборудование, посты (§6). */
export default function ResourcesPage() {
  const { branch } = useOrg();
  const { t } = useT();
  return (
    <div>
      <PageHeader title={t('resources')} subtitle={branch ? `${branch.name} · ${t('resourcesHint')}` : undefined} />
      {branch ? <ResourcesTab branchId={branch.id} /> : <Card><p className="text-sm text-slate-500">{t('noBranchSelected')}</p></Card>}
    </div>
  );
}
