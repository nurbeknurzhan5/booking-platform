import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { computeSubscriptionStatus, CreateOrganizationSchema, AdminUpdateOrganizationSchema } from '@booking/shared';
import { PrismaService } from '../common/prisma.service';
import { AppError, isUniqueViolation } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { PasswordService } from '../auth/password.service';
import { assertSubscriptionPeriod, SubscriptionsService } from '../subscriptions/subscriptions.service';
import type { ActorContext } from '../common/request-context';
import type { Prisma } from '../generated/prisma/client';

type CreateOrg = z.infer<typeof CreateOrganizationSchema>;

@Injectable()
export class AdminOrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async list(search?: string) {
    const orgs = await this.prisma.organization.findMany({
      where: { archivedAt: null, ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}) },
      include: {
        subscription: { include: { plan: { select: { code: true, name: true } } } },
        _count: { select: { branches: { where: { archivedAt: null } } } },
        members: { where: { roleCode: 'OWNER', revokedAt: null }, include: { user: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const now = new Date();
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      businessCategoryCode: o.businessCategoryCode,
      createdAt: o.createdAt,
      branches: o._count.branches,
      owners: o.members.map((m) => m.user),
      subscription: o.subscription
        ? {
            status: computeSubscriptionStatus(o.subscription, now),
            plan: o.subscription.plan,
            maxBranches: o.subscription.maxBranches,
            endsAt: o.subscription.endsAt,
            price: o.subscription.price,
          }
        : null,
    }));
  }

  async get(id: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id, archivedAt: null },
      include: {
        businessCategory: true,
        branches: { where: { archivedAt: null }, include: { page: true } },
        members: { where: { revokedAt: null }, include: { user: { select: { id: true, name: true, email: true, phone: true, blockedAt: true } } } },
      },
    });
    if (!org) throw AppError.notFound('Организация');
    return { ...org, subscription: await this.subscriptions.summary(id) };
  }

  /** Создание организации суперадмином (§2.2): организация, владелец и подписка — одной транзакцией. */
  async create(input: CreateOrg, actor: ActorContext) {
    // До любых записей: неверный период не должен оставлять организацию без подписки.
    if (input.subscription) assertSubscriptionPeriod(input.subscription.startsAt, input.subscription.endsAt);
    const category = await this.prisma.businessCategory.findUnique({ where: { code: input.businessCategory } });
    if (!category) throw AppError.badRequest('VALIDATION_ERROR', 'Неизвестное направление деятельности');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: input.name,
            businessCategoryCode: input.businessCategory,
            contacts: input.contacts as Prisma.InputJsonValue,
            defaultLocale: input.defaultLocale,
          },
        });
        await this.audit.log(actor, 'organization.created', 'organization', org.id, { after: org, organizationId: org.id }, tx);
        if (input.owner) {
          const owner = await tx.user.create({
            data: {
              email: input.owner.email,
              name: input.owner.name,
              phone: input.owner.phone,
              passwordHash: await this.passwords.hash(input.owner.temporaryPassword),
              mustChangePassword: true,
            },
          });
          await tx.userOrganizationRole.create({ data: { userId: owner.id, organizationId: org.id, roleCode: 'OWNER' } });
          await this.audit.log(actor, 'owner.created', 'user', owner.id, { after: { email: owner.email, name: owner.name }, organizationId: org.id }, tx);
        }
        if (input.subscription) {
          await this.subscriptions.set(org.id, { ...input.subscription, note: 'Создание организации' }, { ...actor, organizationId: org.id }, tx);
        }
        return org;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.conflict('Пользователь с таким email или телефоном уже существует');
      throw e;
    }
  }

  async update(id: string, input: z.infer<typeof AdminUpdateOrganizationSchema>, actor: ActorContext) {
    const before = await this.prisma.organization.findFirst({ where: { id, archivedAt: null } });
    if (!before) throw AppError.notFound('Организация');
    const after = await this.prisma.organization.update({
      where: { id },
      data: {
        name: input.name,
        businessCategoryCode: input.businessCategory,
        contacts: input.contacts as Prisma.InputJsonValue | undefined,
      },
    });
    await this.audit.log(actor, 'organization.updated_by_admin', 'organization', id, { before, after, organizationId: id });
    return after;
  }

  /** Назначить владельца: новый пользователь или существующий по email. */
  async addOwner(organizationId: string, input: { email: string; name: string; phone?: string; temporaryPassword: string }, actor: ActorContext) {
    await this.get(organizationId);
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    return this.prisma.$transaction(async (tx) => {
      const user =
        existing ??
        (await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            phone: input.phone,
            passwordHash: await this.passwords.hash(input.temporaryPassword),
            mustChangePassword: true,
          },
        }));
      await tx.userOrganizationRole.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId } },
        create: { userId: user.id, organizationId, roleCode: 'OWNER' },
        update: { roleCode: 'OWNER', revokedAt: null },
      });
      await tx.userBranchAccess.deleteMany({ where: { userId: user.id, organizationId } });
      await this.audit.log(actor, 'owner.assigned', 'user', user.id, { after: { email: user.email }, organizationId }, tx);
      return { id: user.id, email: user.email, name: user.name };
    });
  }
}
