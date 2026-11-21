'use client';

import { useOrg } from '@/components/dashboard/OrgContext';
import { useT } from '@/lib/i18n-dashboard';
import { Card, PageHeader } from '@/components/ui';
import { SpecialistsTab } from '@/components/dashboard/BranchStaffTabs';

/** Специалисты выбранного филиала: добавление, изменение, услуги, фото (§6). */
export default function SpecialistsPage() {
  const { branch } = useOrg();
  const { t } = useT();
  return (
    <div>
      <PageHeader title={t('specialists')} subtitle={branch ? `${branch.name} · ${t('specialistsHint')}` : undefined} />
      {branch ? <SpecialistsTab branchId={branch.id} /> : <Card><p className="text-sm text-slate-500">{t('noBranchSelected')}</p></Card>}
    </div>
  );
}
