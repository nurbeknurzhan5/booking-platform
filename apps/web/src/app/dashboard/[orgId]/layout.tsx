'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { OrgProvider, useOrg } from '@/components/dashboard/OrgContext';
import { useStaff } from '@/components/dashboard/StaffContext';
import { useT, type DashKey } from '@/lib/i18n-dashboard';
import { api } from '@/lib/api';
import { Alert, Select, cx } from '@/components/ui';

interface NavItem {
  href: string;
  label: DashKey;
  show: boolean;
}

function Shell({ children }: { children: ReactNode }) {
  const { org, branches, branchId, setBranchId, can, isOwner } = useOrg();
  const me = useStaff();
  const { t, lang, setLang } = useT();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const base = `/dashboard/${org.id}`;

  const nav: NavItem[] = [
    { href: base, label: 'overview', show: true },
    { href: `${base}/appointments`, label: 'appointments', show: can('appointments.view') },
    { href: `${base}/waitlist`, label: 'waitlist', show: can('appointments.view') },
    { href: `${base}/clients`, label: 'clients', show: can('clients.view') },
    { href: `${base}/services`, label: 'services', show: true },
    { href: `${base}/branches`, label: isOwner ? 'branches' : 'branch', show: true },
    { href: `${base}/reviews`, label: 'reviews', show: can('reviews.manage') },
    { href: `${base}/analytics`, label: 'analytics', show: can('analytics.view') },
    { href: `${base}/promotions`, label: 'promotions', show: isOwner },
    { href: `${base}/users`, label: 'users', show: isOwner },
    { href: `${base}/settings`, label: 'organization', show: isOwner },
  ];

  return (
    <div className="min-h-screen lg:flex">
      <aside className={cx('fixed inset-y-0 left-0 z-40 w-64 transform border-r border-slate-200 bg-white p-4 transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="mb-4">
          <div className="truncate font-semibold">{org.name}</div>
          <div className="text-xs text-slate-500">{me.name} · {t(`role_${org.access.role}`)}</div>
        </div>
        {branches.length > 0 && (
          <Select value={branchId ?? ''} onChange={(e) => setBranchId(e.target.value)} className="mb-4" aria-label={t('branch')}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        )}
        <nav className="space-y-0.5">
          {nav.filter((n) => n.show).map((n) => {
            const active = n.href === base ? path === base : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={cx('block rounded-lg px-3 py-2 text-sm', active ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-100')}>
                {t(n.label)}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6 space-y-2 border-t border-slate-200 pt-4 text-sm">
          {me.memberships.length > 1 && <Link href="/dashboard" className="block text-slate-600 hover:text-slate-900">⇄ {t('selectOrg')}</Link>}
          <button onClick={() => setLang(lang === 'ru' ? 'kk' : 'ru')} className="block text-slate-600 hover:text-slate-900">🌐 {lang === 'ru' ? 'Қазақша' : 'Русский'}</button>
          <button
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' });
              router.push('/login');
            }}
            className="block text-slate-600 hover:text-slate-900"
          >
            ⎋ {t('logout')}
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="menu" className="rounded p-1 text-xl">☰</button>
          <span className="truncate font-semibold">{org.name}</span>
        </header>
        <div className="mx-auto max-w-6xl p-4 sm:p-6">
          {(org.subscriptionStatus === 'expired' || org.subscriptionStatus === 'suspended') && <div className="mb-4"><Alert tone="red">{t('subInactive')}</Alert></div>}
          {org.subscriptionStatus === 'grace_period' && <div className="mb-4"><Alert tone="amber">{t('subGrace')}</Alert></div>}
          {children}
        </div>
      </div>
    </div>
  );
}

export default function OrgLayout({ children }: { children: ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  return (
    <OrgProvider orgId={orgId}>
      <Shell>{children}</Shell>
    </OrgProvider>
  );
}
