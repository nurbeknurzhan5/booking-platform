'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { Spinner } from '@/components/ui';

export interface StaffProfile {
  id: string;
  name: string;
  email: string | null;
  isSuperadmin: boolean;
  mustChangePassword: boolean;
  sessionKind: 'staff' | 'client';
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    role: 'OWNER' | 'BRANCH_ADMIN';
    branches: Array<{ branchId: string; branchName: string; permissions: string[] }> | null;
  }>;
}

const Ctx = createContext<StaffProfile | null>(null);

/** Проверка входа сотрудника; права всё равно проверяются на сервере. */
export function StaffGate({ children, requireSuperadmin }: { children: ReactNode; requireSuperadmin?: boolean }) {
  const router = useRouter();
  const [me, setMe] = useState<StaffProfile | null>(null);
  useEffect(() => {
    api<StaffProfile>('/auth/me')
      .then((p) => {
        if (p.sessionKind !== 'staff' || p.mustChangePassword || (requireSuperadmin && !p.isSuperadmin)) router.replace('/login');
        else setMe(p);
      })
      .catch(() => router.replace('/login'));
  }, [router, requireSuperadmin]);
  if (!me) return <Spinner />;
  return <Ctx.Provider value={me}>{children}</Ctx.Provider>;
}

export function useStaff(): StaffProfile {
  const me = useContext(Ctx);
  if (!me) throw new Error('StaffGate missing');
  return me;
}
