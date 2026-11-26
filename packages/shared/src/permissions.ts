import type { Role } from './enums';

/**
 * Коды прав. Права уровня филиала (BRANCH_PERMISSIONS) могут выдаваться BRANCH_ADMIN
 * по каждому назначенному филиалу. Права уровня организации есть только у OWNER.
 */
export const BRANCH_PERMISSIONS = [
  'appointments.view',
  'appointments.manage',
  'clients.view',
  'services.manage',
  'specialists.manage',
  'resources.manage',
  'schedules.manage',
  'reviews.manage',
  'analytics.view',
  'pages.edit',
  'branch.settings.manage',
] as const;
export type BranchPermission = (typeof BRANCH_PERMISSIONS)[number];

export const ORG_PERMISSIONS = [
  'org.manage',
  'branches.manage',
  'users.manage',
  'promotions.manage',
  'booking_settings.manage',
  'notifications.manage',
  'integrations.manage',
  'audit.view',
  'subscription.view',
] as const;
export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

export type Permission = BranchPermission | OrgPermission;
export const ALL_PERMISSIONS: readonly Permission[] = [...BRANCH_PERMISSIONS, ...ORG_PERMISSIONS];

/** Права по умолчанию (role_permissions). OWNER имеет все права в своей организации. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Exclude<Role, 'SUPERADMIN' | 'CLIENT'>, readonly Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  BRANCH_ADMIN: ['appointments.view', 'appointments.manage', 'clients.view', 'resources.manage', 'analytics.view'],
};

export function isBranchPermission(p: string): p is BranchPermission {
  return (BRANCH_PERMISSIONS as readonly string[]).includes(p);
}

export function isPermission(p: string): p is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(p);
}

export interface AccessGrant {
  role: Exclude<Role, 'SUPERADMIN' | 'CLIENT'>;
  /** Для BRANCH_ADMIN: права по филиалам. Для OWNER не используется. */
  branchPermissions: Record<string, readonly string[]>;
}

/**
 * Чистая проверка права. Если branchId не указан, право организации проверяется так:
 * OWNER — всегда; BRANCH_ADMIN — только для права филиала в любом назначенном филиале
 * (используется для списков, которые затем фильтруются по филиалам).
 */
export function hasPermission(grant: AccessGrant, permission: Permission, branchId?: string): boolean {
  if (grant.role === 'OWNER') return true;
  if (!isBranchPermission(permission)) return false;
  // Только собственные ключи: branchId вида `constructor`/`__proto__` не должен попадать в Object.prototype (TypeError → 500).
  if (branchId) return Object.hasOwn(grant.branchPermissions, branchId) && (grant.branchPermissions[branchId] ?? []).includes(permission);
  return Object.values(grant.branchPermissions).some((perms) => perms.includes(permission));
}

/** Филиалы, в которых у пользователя есть право (для фильтрации списков). null = все филиалы. */
export function branchesWithPermission(grant: AccessGrant, permission: Permission): string[] | null {
  if (grant.role === 'OWNER') return null;
  return Object.entries(grant.branchPermissions)
    .filter(([, perms]) => perms.includes(permission))
    .map(([id]) => id);
}
