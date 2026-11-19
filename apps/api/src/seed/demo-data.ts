import * as argon2 from 'argon2';
import type { PrismaClient } from '../generated/prisma/client';

export const DEMO = {
  ownerEmail: 'owner@demo.kz',
  ownerPassword: 'DemoOwner12345',
  adminEmail: 'admin@demo.kz',
  adminPassword: 'DemoAdmin12345',
  slug: 'demo-salon',
};

/**
 * Демо-данные для разработки и E2E (не для production): организация с подпиской,
 * филиал с расписанием, услуги, специалисты, кабинет, опубликованная страница, промокод.
 * Идемпотентно: если демо-организация существует — ничего не делает.
 */
export async function seedDemoData(prisma: PrismaClient): Promise<void> {
  if ((process.env.APP_ENV ?? 'development') === 'production') throw new Error('Demo seed is disabled in production');
  if (await prisma.branch.findUnique({ where: { slug: DEMO.slug } })) return;

  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'business' } });
  const hash = (p: string) => argon2.hash(p, { type: argon2.argon2id });
  const now = Date.now();

  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: 'Салон «Демо»',
        businessCategoryCode: 'beauty_salon',
        contacts: { phone: '+77272000000' },
        notificationSettings: { whatsappEnabled: true, smsEnabled: false, reminderEnabled: true, reviewRequestEnabled: true },
      },
    });
    await tx.subscription.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        maxBranches: plan.maxBranches,
        price: plan.monthlyPrice,
        startsAt: new Date(now - 86400_000),
        endsAt: new Date(now + 365 * 86400_000),
        graceDays: 7,
        status: 'active',
      },
    });
    const owner = await tx.user.create({ data: { email: DEMO.ownerEmail, name: 'Айгуль (владелец)', passwordHash: await hash(DEMO.ownerPassword) } });
    await tx.userOrganizationRole.create({ data: { userId: owner.id, organizationId: org.id, roleCode: 'OWNER' } });

    const branch = await tx.branch.create({
      data: {
        organizationId: org.id,
        name: 'Салон «Демо» на Абая',
        slug: DEMO.slug,
        address: 'Алматы, пр. Абая, 150',
        phone: '+77272000001',
        timezone: 'Asia/Almaty',
        description: 'Стрижки, окрашивание и массаж в центре Алматы.',
        latitude: 43.2389,
        longitude: 76.8897,
      },
    });
    await tx.bookingSettings.create({ data: { branchId: branch.id, organizationId: org.id, minLeadMinutes: 0, slotIntervalMinutes: 30 } });
    const admin = await tx.user.create({ data: { email: DEMO.adminEmail, name: 'Ерлан (администратор)', passwordHash: await hash(DEMO.adminPassword) } });
    await tx.userOrganizationRole.create({ data: { userId: admin.id, organizationId: org.id, roleCode: 'BRANCH_ADMIN' } });
    const access = await tx.userBranchAccess.create({ data: { organizationId: org.id, userId: admin.id, branchId: branch.id } });
    await tx.userBranchPermission.createMany({
      data: ['appointments.view', 'appointments.manage', 'clients.view', 'resources.manage', 'analytics.view', 'reviews.manage'].map((p) => ({ accessId: access.id, permissionCode: p })),
    });

    const cat = await tx.serviceCategory.create({ data: { organizationId: org.id, name: 'Волосы' } });
    const body = await tx.serviceCategory.create({ data: { organizationId: org.id, name: 'Тело', sortOrder: 1 } });
    const mk = async (name: string, price: number, durationMinutes: number, categoryId: string, extra: { bufferAfterMinutes?: number; cabinet?: boolean } = {}) => {
      const s = await tx.service.create({
        data: { organizationId: org.id, name, price, durationMinutes, categoryId, bufferAfterMinutes: extra.bufferAfterMinutes ?? 0 },
      });
      await tx.branchService.create({ data: { organizationId: org.id, branchId: branch.id, serviceId: s.id } });
      if (extra.cabinet) await tx.serviceResource.create({ data: { organizationId: org.id, serviceId: s.id, resourceType: 'cabinet', quantity: 1 } });
      return s;
    };
    const haircut = await mk('Женская стрижка', 8000, 60, cat.id);
    const men = await mk('Мужская стрижка', 5000, 45, cat.id);
    const color = await mk('Окрашивание', 20000, 120, cat.id);
    const massage = await mk('Классический массаж', 12000, 60, body.id, { bufferAfterMinutes: 15, cabinet: true });

    const sp = async (name: string, specialization: string, services: string[], sortOrder: number) => {
      const r = await tx.resource.create({ data: { organizationId: org.id, branchId: branch.id, type: 'specialist', name, sortOrder } });
      const s = await tx.specialist.create({ data: { organizationId: org.id, branchId: branch.id, resourceId: r.id, name, specialization, sortOrder } });
      await tx.specialistService.createMany({ data: services.map((serviceId) => ({ organizationId: org.id, specialistId: s.id, serviceId })) });
    };
    await sp('Анна', 'Стилист-колорист', [haircut.id, color.id, men.id], 0);
    await sp('Болат', 'Барбер', [men.id, haircut.id], 1);
    await sp('Дина', 'Массажист', [massage.id], 2);
    const cab = await tx.resource.create({ data: { organizationId: org.id, branchId: branch.id, type: 'cabinet', name: 'Массажный кабинет' } });
    await tx.resourceService.create({ data: { organizationId: org.id, resourceId: cab.id, serviceId: massage.id } });

    await tx.workingHours.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ organizationId: org.id, branchId: branch.id, weekday, startMinute: 9 * 60, endMinute: 21 * 60 })),
    });

    await tx.promotion.create({
      data: { organizationId: org.id, kind: 'promo_code', name: 'Скидка 10% новым клиентам', code: 'WELCOME10', discountType: 'percent', discountValue: 10, showOnPage: true, perClientLimit: 1 },
    });

    const tpl = await tx.pageTemplate.findUniqueOrThrow({ where: { key: 'modern' } });
    const page = await tx.publicPage.create({ data: { organizationId: org.id, branchId: branch.id } });
    const content = {
      title: { ru: 'Салон «Демо»' },
      tagline: { ru: 'Красота без очередей — запишитесь онлайн за минуту' },
      about: { ru: 'Мы работаем ежедневно с 9:00 до 21:00. Опытные мастера, премиальная косметика и уютная атмосфера.' },
      galleryAssetIds: [],
      socials: [{ url: 'https://instagram.com/demo_salon' }, { url: 'https://wa.me/77272000001' }],
      hiddenSections: [],
    };
    const common = { organizationId: org.id, pageId: page.id, content, templateId: tpl.id, templateVersionId: tpl.currentVersionId!, colorScheme: 'indigo', bookingButtonPosition: 'floating', primaryLocale: 'ru' };
    await tx.pageDraft.create({ data: { ...common, hasChanges: false } });
    const pub = await tx.pagePublication.create({ data: { ...common, version: 1, publishedByUserId: owner.id } });
    await tx.publicPage.update({ where: { id: page.id }, data: { publishedPublicationId: pub.id } });
  });
}
