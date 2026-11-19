import { branchesWithPermission, hasPermission, type Permission } from '@booking/shared';
import { AppError } from './errors';
import type { TenantContext } from './request-context';

/**
 * Проверка права на конкретный филиал, когда филиал определяется по сущности (запись, специалист…),
 * а не по URL. Нет доступа к филиалу → 404 (не раскрываем существование).
 */
export function assertBranchPermission(tenant: TenantContext, permission: Permission, branchId: string): void {
  if (!hasPermission(tenant.grant, permission, branchId)) {
    if (tenant.grant.role === 'BRANCH_ADMIN' && !(branchId in tenant.grant.branchPermissions)) {
      throw AppError.notFound();
    }
    throw AppError.forbidden();
  }
}

/** Фильтр списков: null — все филиалы организации, иначе — массив разрешённых. */
export function allowedBranches(tenant: TenantContext, permission: Permission): string[] | null {
  return branchesWithPermission(tenant.grant, permission);
}

/** Prisma-условие по филиалам для списков. */
export function branchFilter(tenant: TenantContext, permission: Permission, requestedBranchId?: string) {
  const allowed = allowedBranches(tenant, permission);
  if (requestedBranchId) {
    if (allowed && !allowed.includes(requestedBranchId)) throw AppError.forbidden();
    return { branchId: requestedBranchId };
  }
  return allowed ? { branchId: { in: allowed } } : {};
}
