'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { DashI18nProvider, useT, type DashKey } from '@/lib/i18n-dashboard';
import { StaffGate } from '@/components/dashboard/StaffContext';
import { api } from '@/lib/api';
import { cx } from '@/components/ui';

const NAV: Array<[string, DashKey]> = [
  ['/admin', 'systemStats'],
  ['/admin/organizations', 'organizations'],
  ['/admin/plans', 'plans'],
  ['/admin/payments', 'payments'],
  ['/admin/users', 'users'],
  ['/admin/templates', 'templates'],
  ['/admin/moderation', 'moderation'],
  ['/admin/notifications', 'queues'],
  ['/admin/audit', 'audit'],
  ['/admin/settings', 'systemSettings'],
];

function Shell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useT();
  const path = usePathname();
  const router = useRouter();
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-slate-900 p-4 text-slate-200 md:min-h-screen md:w-60 md:border-b-0">
        <div className="mb-4 font-semibold text-white">{t('admin')}</div>
        <nav className="flex gap-1 overflow-x-auto md:block md:space-y-0.5">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className={cx('block whitespace-nowrap rounded-lg px-3 py-2 text-sm', (href === '/admin' ? path === href : path.startsWith(href)) ? 'bg-white/10 text-white' : 'hover:bg-white/5')}>
              {t(label)}
            </Link>
          ))}
        </nav>
        <div className="mt-4 hidden space-y-2 text-sm md:block">
          <button onClick={() => setLang(lang === 'ru' ? 'kk' : 'ru')}>🌐 {lang === 'ru' ? 'Қазақша' : 'Русский'}</button>
          <button className="block" onClick={async () => { await api('/auth/logout', { method: 'POST' }); router.push('/login'); }}>⎋ {t('logout')}</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <DashI18nProvider>
      <StaffGate requireSuperadmin>
        <Shell>{children}</Shell>
      </StaffGate>
    </DashI18nProvider>
  );
}
