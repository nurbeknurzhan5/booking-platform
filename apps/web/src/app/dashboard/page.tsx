'use client';

import Link from 'next/link';
import { useStaff } from '@/components/dashboard/StaffContext';
import { useT } from '@/lib/i18n-dashboard';
import { Card } from '@/components/ui';

export default function SelectOrgPage() {
  const me = useStaff();
  const { t } = useT();
  return (
    <main className="mx-auto max-w-xl p-6">
      <Card title={t('selectOrg')}>
        <ul className="divide-y divide-slate-100">
          {me.memberships.map((m) => (
            <li key={m.organizationId}>
              <Link href={`/dashboard/${m.organizationId}`} className="flex items-center justify-between py-3 hover:text-brand-700">
                <span className="font-medium">{m.organizationName}</span>
                <span className="text-xs text-slate-500">{t(`role_${m.role}`)}</span>
              </Link>
            </li>
          ))}
          {me.isSuperadmin && (
            <li>
              <Link href="/admin" className="block py-3 font-medium text-brand-700">{t('admin')} →</Link>
            </li>
          )}
        </ul>
      </Card>
    </main>
  );
}
