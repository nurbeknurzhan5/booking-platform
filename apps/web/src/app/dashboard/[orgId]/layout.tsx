'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  ArrowLeftRight, BarChart3, Building2, CalendarClock, CalendarDays, Contact, Globe, Hourglass, LayoutDashboard, LogOut, Menu, Palette, Plug, Scissors, Settings, Star, TicketPercent, UserCog, Users, Wrench,
  type LucideIcon,
} from 'lucide-react';
import { OrgProvider, useOrg } from '@/components/dashboard/OrgContext';
import { useStaff } from '@/components/dashboard/StaffContext';
import { useT, type DashKey } from '@/lib/i18n-dashboard';
import { api } from '@/lib/api';
import { Alert, Select, cx } from '@/components/ui';

interface NavItem {
  href: string;
  label: DashKey;
  icon: LucideIcon;
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
    { href: base, label: 'overview', icon: LayoutDashboard, show: true },
    { href: `${base}/appointments`, label: 'appointments', icon: CalendarDays, show: can('appointments.view') },
    { href: `${base}/waitlist`, label: 'waitlist', icon: Hourglass, show: can('appointments.view') },
    { href: `${base}/clients`, label: 'clients', icon: Contact, show: can('clients.view') },
    { href: `${base}/services`, label: 'services', icon: Scissors, show: true },
    { href: `${base}/specialists`, label: 'specialists', icon: Users, show: true },
    { href: `${base}/schedule`, label: 'resourcesSchedule', icon: CalendarClock, show: true },
    { href: `${base}/resources`, label: 'resources', icon: Wrench, show: true },
    { href: `${base}/branches`, label: isOwner ? 'branches' : 'branch', icon: Building2, show: true },
    { href: `${base}/themes`, label: 'themesTitle', icon: Palette, show: isOwner || (!!branchId && can('pages.edit', branchId)) },
    { href: `${base}/reviews`, label: 'reviews', icon: Star, show: can('reviews.manage') },
    { href: `${base}/analytics`, label: 'analytics', icon: BarChart3, show: can('analytics.view') },
    { href: `${base}/promotions`, label: 'promotions', icon: TicketPercent, show: isOwner },
    { href: `${base}/users`, label: 'users', icon: UserCog, show: isOwner },
    { href: `${base}/integrations`, label: 'integrations', icon: Plug, show: can('integrations.manage') },
    { href: `${base}/settings`, label: 'organization', icon: Settings, show: isOwner },
  ];

  return (
    <div className="min-h-screen lg:flex">
      <aside className={cx('fixed inset-y-0 left-0 z-40 w-64 transform overflow-y-auto border-r border-slate-200 bg-white p-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-base font-bold text-white shadow-sm" aria-hidden>{org.name.replace(/[«»"']/g, '').trim().charAt(0).toUpperCase()}</span>
          <div className="min-w-0">
          <div className="truncate font-semibold">{org.name}</div>
          <div className="truncate text-xs text-slate-500">{me.name} · {t(`role_${org.access.role}`)}</div>
          </div>
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
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors', active ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}>
                <n.icon className={cx('h-[18px] w-[18px] shrink-0', active ? 'text-brand-600' : 'text-slate-400')} strokeWidth={1.8} aria-hidden />
                {t(n.label)}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6 space-y-1 border-t border-slate-200 pt-4 text-sm">
          {me.memberships.length > 1 && <Link href="/dashboard" className="flex items-center gap-3 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"><ArrowLeftRight className="h-[18px] w-[18px] text-slate-400" strokeWidth={1.8} aria-hidden />{t('selectOrg')}</Link>}
          <button onClick={() => setLang(lang === 'ru' ? 'kk' : 'ru')} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"><Globe className="h-[18px] w-[18px] text-slate-400" strokeWidth={1.8} aria-hidden />{lang === 'ru' ? 'Қазақша' : 'Русский'}</button>
          <button
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' });
              router.push('/login');
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <LogOut className="h-[18px] w-[18px] text-slate-400" strokeWidth={1.8} aria-hidden />
            {t('logout')}
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="menu" className="rounded-lg p-1.5 hover:bg-slate-100"><Menu className="h-5 w-5" /></button>
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
