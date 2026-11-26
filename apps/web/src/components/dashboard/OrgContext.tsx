'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { Spinner } from '@/components/ui';
import { apiPath, type ApiPath } from '@/lib/api-path';

export interface OrgInfo {
  id: string;
  name: string;
  defaultLocale: string;
  subscriptionStatus: 'active' | 'grace_period' | 'expired' | 'suspended';
  access: { role: 'OWNER' | 'BRANCH_ADMIN' | 'SUPERADMIN'; branchPermissions: Record<string, string[]> };
}

export interface BranchInfo {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  page: { id: string; status: string; publishedPublicationId: string | null } | null;
}

interface OrgCtx {
  org: OrgInfo;
  branches: BranchInfo[];
  branchId: string | null;
  branch: BranchInfo | null;
  setBranchId: (id: string) => void;
  reloadBranches: () => Promise<void>;
  isOwner: boolean;
  /** Проверка права для отображения UI (сервер проверяет независимо). */
  can: (permission: string, branchId?: string | null) => boolean;
  canManage: boolean;
  /** Путь организации в API (/organizations/:id) — основа для apiPath`${base}/…`. */
  base: ApiPath;
}

const Ctx = createContext<OrgCtx | null>(null);
const ORG_PERMISSIONS = new Set(['org.manage', 'branches.manage', 'users.manage', 'promotions.manage', 'booking_settings.manage', 'notifications.manage', 'integrations.manage', 'audit.view', 'subscription.view']);

export function OrgProvider({ orgId, children }: { orgId: string; children: ReactNode }) {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchId, setBranchIdState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadBranches = useCallback(async () => {
    const list = await api<BranchInfo[]>(apiPath`/organizations/${orgId}/branches`);
    setBranches(list);
    setBranchIdState((cur) => {
      const saved = cur ?? localStorage.getItem(`bk_branch_${orgId}`);
      return list.find((b) => b.id === saved)?.id ?? list[0]?.id ?? null;
    });
  }, [orgId]);

  useEffect(() => {
    api<OrgInfo>(apiPath`/organizations/${orgId}`)
      .then(setOrg)
      .catch((e) => setError(e.message));
    reloadBranches().catch(() => undefined);
  }, [orgId, reloadBranches]);

  const setBranchId = useCallback(
    (id: string) => {
      localStorage.setItem(`bk_branch_${orgId}`, id);
      setBranchIdState(id);
    },
    [orgId],
  );

  const value = useMemo<OrgCtx | null>(() => {
    if (!org) return null;
    const isOwner = org.access.role === 'OWNER' || org.access.role === 'SUPERADMIN';
    const can = (p: string, b?: string | null) => {
      if (isOwner) return true;
      if (ORG_PERMISSIONS.has(p)) return false;
      const perms = org.access.branchPermissions;
      return b ? (perms[b] ?? []).includes(p) : Object.values(perms).some((l) => l.includes(p));
    };
    return {
      org,
      branches,
      branchId,
      branch: branches.find((b) => b.id === branchId) ?? null,
      setBranchId,
      reloadBranches,
      isOwner,
      can,
      canManage: org.access.role === 'SUPERADMIN' || org.subscriptionStatus === 'active' || org.subscriptionStatus === 'grace_period',
      base: apiPath`/organizations/${org.id}`,
    };
  }, [org, branches, branchId, setBranchId, reloadBranches]);

  if (error) return <p className="p-6 text-rose-600">{error}</p>;
  if (!value) return <Spinner />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrg(): OrgCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('OrgProvider missing');
  return v;
}
