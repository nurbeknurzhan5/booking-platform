import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CreateStaffUserSchema, UpdateStaffAccessSchema } from '@booking/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AppError, isUniqueViolation } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { PasswordService } from '../auth/password.service';
import type { ActorContext } from '../common/request-context';

type CreateStaff = z.infer<typeof CreateStaffUserSchema>;
type BranchAccessInput = z.infer<typeof UpdateStaffAccessSchema>['branchAccess'];

const USER_PUBLIC = { id: true, name: true, email: true, phone: true, blockedAt: true, lastLoginAt: true, createdAt: true } as const;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  async list(organizationId: string) {
    const members = await this.prisma.userOrganizationRole.findMany({
      where: { organizationId, revokedAt: null },
      include: {
        user: {
          select: {
            ...USER_PUBLIC,
            branchAccess: { where: { organizationId }, include: { permissions: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      userId: m.userId,
      role: m.roleCode,
      name: m.user.name,
      email: m.user.email,
      phone: m.user.phone,
      blocked: !!m.user.blockedAt,
      lastLoginAt: m.user.lastLoginAt,
      branchAccess: m.user.branchAccess.map((a) => ({ branchId: a.branchId, permissions: a.permissions.map((p) => p.permissionCode) })),
    }));
  }

  /**
   * Создание сотрудника. Владелец может создавать только BRANCH_ADMIN;
   * владельцев назначает суперадминистратор (allowOwner = true).
   */
  async create(organizationId: string, input: CreateStaff, actor: ActorContext, opts: { allowOwner: boolean }) {
    if (input.role === 'OWNER' && !opts.allowOwner) throw AppError.forbidden('Владельцев назначает суперадминистратор');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            phone: input.phone,
            passwordHash: await this.passwords.hash(input.temporaryPassword),
            mustChangePassword: true,
          },
          select: USER_PUBLIC,
        });
        await tx.userOrganizationRole.create({ data: { userId: user.id, organizationId, roleCode: input.role } });
        if (input.role === 'BRANCH_ADMIN') await this.replaceAccess(tx, organizationId, user.id, input.branchAccess);
        await this.audit.log(actor, 'staff.created', 'user', user.id, { after: { ...user, role: input.role, branchAccess: input.branchAccess }, organizationId }, tx);
        return { ...user, role: input.role };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.conflict('Пользователь с таким email или телефоном уже существует');
      throw e;
    }
  }

  async updateAccess(organizationId: string, userId: string, branchAccess: BranchAccessInput, actor: ActorContext) {
    const m = await this.membership(organizationId, userId);
    if (m.roleCode !== 'BRANCH_ADMIN') throw AppError.badRequest('VALIDATION_ERROR', 'Права по филиалам задаются только администраторам');
    const before = await this.list(organizationId).then((l) => l.find((x) => x.userId === userId));
    await this.prisma.$transaction(async (tx) => {
      await this.replaceAccess(tx, organizationId, userId, branchAccess);
      await this.audit.log(actor, 'staff.access_updated', 'user', userId, { before: before?.branchAccess, after: branchAccess, organizationId }, tx);
    });
    return this.list(organizationId).then((l) => l.find((x) => x.userId === userId));
  }

  async revoke(organizationId: string, userId: string, actor: ActorContext, opts: { allowOwner: boolean }) {
    const m = await this.membership(organizationId, userId);
    if (m.roleCode === 'OWNER' && !opts.allowOwner) throw AppError.forbidden('Владельца может отключить только суперадминистратор');
    if (actor.userId === userId) throw AppError.badRequest('VALIDATION_ERROR', 'Нельзя отозвать собственный доступ');
    await this.prisma.$transaction(async (tx) => {
      await tx.userOrganizationRole.update({ where: { id: m.id }, data: { revokedAt: new Date() } });
      await tx.userBranchAccess.deleteMany({ where: { organizationId, userId } });
      await this.audit.log(actor, 'staff.revoked', 'user', userId, { before: { role: m.roleCode }, organizationId }, tx);
    });
  }

  /**
   * Восстановление доступа администратору филиала владельцем (D-35): временный пароль, смена при входе,
   * отзыв сессий. Только для BRANCH_ADMIN этой организации, у которого нет ролей в других организациях и
   * который не суперадминистратор: пароль общий для всех организаций пользователя.
   */
  async resetPassword(organizationId: string, userId: string, temporaryPassword: string, actor: ActorContext) {
    if (actor.userId === userId) throw AppError.badRequest('VALIDATION_ERROR', 'Для своей учётной записи используйте смену пароля');
    const m = await this.membership(organizationId, userId);
    if (m.roleCode !== 'BRANCH_ADMIN') throw AppError.forbidden('Пароль владельца восстанавливает администратор платформы');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { isSuperadmin: true } });
    const elsewhere = await this.prisma.userOrganizationRole.count({ where: { userId, revokedAt: null, organizationId: { not: organizationId } } });
    if (user.isSuperadmin || elsewhere > 0) {
      throw AppError.forbidden('Сотрудник работает и в других организациях — пароль восстанавливает администратор платформы');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: await this.passwords.hash(temporaryPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(actor, 'staff.password_reset', 'user', userId, { organizationId }, tx);
    });
  }

  private async membership(organizationId: string, userId: string) {
    const m = await this.prisma.userOrganizationRole.findFirst({ where: { organizationId, userId, revokedAt: null } });
    if (!m) throw AppError.notFound('Сотрудник');
    return m;
  }

  /** Полная замена доступа по филиалам; все филиалы должны принадлежать организации. */
  private async replaceAccess(tx: Tx, organizationId: string, userId: string, access: BranchAccessInput) {
    const ids = [...new Set(access.map((a) => a.branchId))];
    if (ids.length !== access.length) throw AppError.badRequest('VALIDATION_ERROR', 'Филиал указан несколько раз');
    if (ids.length) {
      const found = await tx.branch.count({ where: { id: { in: ids }, organizationId, archivedAt: null } });
      if (found !== ids.length) throw AppError.notFound('Филиал');
    }
    await tx.userBranchAccess.deleteMany({ where: { organizationId, userId } });
    for (const a of access) {
      const row = await tx.userBranchAccess.create({ data: { organizationId, userId, branchId: a.branchId } });
      if (a.permissions.length) {
        await tx.userBranchPermission.createMany({
          data: [...new Set(a.permissions)].map((p) => ({ accessId: row.id, permissionCode: p })),
        });
      }
    }
  }
}
