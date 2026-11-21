import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { PrismaClient, ResourceType } from '../generated/prisma/client';
import { StorageService } from '../files/storage.service';
import { bathCover, beautySalon, clubCover, consoleRoom, finnishSauna, hammam, massageRoom, pcSetup, russianBanya } from './demo-art';

/** Демо-площадки для показа (разработка): компьютерный клуб и банный комплекс. Идемпотентно по slug. */
export const DEMO_VENUES = {
  club: { slug: 'demo-club', ownerEmail: 'club@demo.kz' },
  sauna: { slug: 'demo-sauna', ownerEmail: 'sauna@demo.kz' },
  password: 'DemoOwner12345',
};

const VARIANTS = { thumb: 320, medium: 960, large: 1920 } as const;

/** Растеризует SVG в WebP-варианты и сохраняет как загруженное изображение организации. */
async function image(prisma: PrismaClient, storage: StorageService, organizationId: string, kind: string, svgText: string): Promise<string> {
  const id = randomUUID();
  const variants: Record<string, string> = {};
  for (const [name, width] of Object.entries(VARIANTS)) {
    const out = await sharp(Buffer.from(svgText)).resize({ width, withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
    const key = `org/${organizationId}/${id}/${name}.webp`;
    await storage.put(key, out, 'image/webp');
    variants[name] = key;
  }
  await prisma.mediaAsset.create({
    data: { id, organizationId, kind, storageKey: variants.large!, mimeType: 'image/webp', width: 1200, height: 800, sizeBytes: 0, variants, originalName: `${kind}.webp` },
  });
  return id;
}

interface VenueSpec {
  slug: string;
  ownerEmail: string;
  ownerName: string;
  orgName: string;
  category: string;
  branch: { name: string; address: string; phone: string; description: string; latitude: number; longitude: number };
  page: { title: string; tagline: string; about: string; template: string; scheme: string; button: string; cover: string; gallery: string[] };
  categories: string[];
  resources: Array<{ key: string; name: string; type: ResourceType; description: string; photo?: string; count?: number }>;
  services: Array<{ name: string; category: number; price: number; minutes: number; resources?: { type: ResourceType; keys: string[] }; specialist?: boolean; description?: string }>;
  specialists?: Array<{ name: string; specialization: string; description: string }>;
  socials: string[];
}

async function seedVenue(prisma: PrismaClient, spec: VenueSpec) {
  if (await prisma.branch.findUnique({ where: { slug: spec.slug } })) return;
  const storage = new StorageService();
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'business' } });
  const now = Date.now();
  const org = await prisma.organization.create({
    data: {
      name: spec.orgName,
      businessCategoryCode: spec.category,
      contacts: { phone: spec.branch.phone },
      notificationSettings: { whatsappEnabled: true, smsEnabled: false, reminderEnabled: true, reviewRequestEnabled: true },
    },
  });
  await prisma.subscription.create({
    data: { organizationId: org.id, planId: plan.id, maxBranches: plan.maxBranches, price: plan.monthlyPrice, startsAt: new Date(now - 86400_000), endsAt: new Date(now + 365 * 86400_000), graceDays: 7, status: 'active' },
  });
  const owner = await prisma.user.upsert({
    where: { email: spec.ownerEmail },
    create: { email: spec.ownerEmail, name: spec.ownerName, passwordHash: await argon2.hash(DEMO_VENUES.password, { type: argon2.argon2id }) },
    update: {},
  });
  await prisma.userOrganizationRole.create({ data: { userId: owner.id, organizationId: org.id, roleCode: 'OWNER' } });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, slug: spec.slug, timezone: 'Asia/Almaty', ...spec.branch } });
  await prisma.bookingSettings.create({ data: { branchId: branch.id, organizationId: org.id, minLeadMinutes: 0, slotIntervalMinutes: 30, maxActiveAppointmentsPerClient: 3 } });
  await prisma.workingHours.createMany({ data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ organizationId: org.id, branchId: branch.id, weekday, startMinute: 10 * 60, endMinute: 24 * 60 })) });

  // изображения
  const pics = new Map<string, string>();
  const art: Record<string, () => string> = { club: clubCover, pc: () => pcSetup('standard'), vip: () => pcSetup('vip'), ps: consoleRoom, finnish: finnishSauna, banya: russianBanya, hammam, bath: bathCover };
  const need = new Set([spec.page.cover, ...spec.page.gallery, ...spec.resources.map((r) => r.photo).filter((x): x is string => !!x)]);
  for (const k of need) pics.set(k, await image(prisma, storage, org.id, k === spec.page.cover ? 'cover' : spec.page.gallery.includes(k) ? 'gallery' : 'resource', art[k]!()));

  const cats = [];
  for (const [i, name] of spec.categories.entries()) cats.push(await prisma.serviceCategory.create({ data: { organizationId: org.id, name, sortOrder: i } }));

  // ресурсы: несколько одинаковых мест — отдельные ресурсы с номерами
  const resByKey = new Map<string, string[]>();
  let sort = 0;
  for (const r of spec.resources) {
    const ids: string[] = [];
    const n = r.count ?? 1;
    for (let i = 1; i <= n; i++) {
      const res = await prisma.resource.create({
        data: { organizationId: org.id, branchId: branch.id, type: r.type, name: n > 1 ? `${r.name} ${i}` : r.name, description: r.description, isPublic: true, photoAssetId: r.photo ? pics.get(r.photo) : null, sortOrder: sort++ },
      });
      ids.push(res.id);
    }
    resByKey.set(r.key, ids);
  }

  const specialistServiceIds: string[] = [];
  for (const [i, s] of spec.services.entries()) {
    const svc = await prisma.service.create({
      data: { organizationId: org.id, name: s.name, description: s.description, price: s.price, durationMinutes: s.minutes, categoryId: cats[s.category]!.id, requiresSpecialist: !!s.specialist, sortOrder: i },
    });
    await prisma.branchService.create({ data: { organizationId: org.id, branchId: branch.id, serviceId: svc.id } });
    if (s.resources) {
      await prisma.serviceResource.create({ data: { organizationId: org.id, serviceId: svc.id, resourceType: s.resources.type, quantity: 1 } });
      for (const key of s.resources.keys) for (const resourceId of resByKey.get(key) ?? []) await prisma.resourceService.create({ data: { organizationId: org.id, resourceId, serviceId: svc.id } });
    }
    if (s.specialist) specialistServiceIds.push(svc.id);
  }
  for (const [i, sp] of (spec.specialists ?? []).entries()) {
    const r = await prisma.resource.create({ data: { organizationId: org.id, branchId: branch.id, type: 'specialist', name: sp.name, sortOrder: i } });
    const s = await prisma.specialist.create({ data: { organizationId: org.id, branchId: branch.id, resourceId: r.id, name: sp.name, specialization: sp.specialization, description: sp.description, sortOrder: i } });
    await prisma.specialistService.createMany({ data: specialistServiceIds.map((serviceId) => ({ organizationId: org.id, specialistId: s.id, serviceId })) });
  }

  const tpl = await prisma.pageTemplate.findUniqueOrThrow({ where: { key: spec.page.template } });
  const page = await prisma.publicPage.create({ data: { organizationId: org.id, branchId: branch.id } });
  const content = {
    title: { ru: spec.page.title },
    tagline: { ru: spec.page.tagline },
    about: { ru: spec.page.about },
    coverAssetId: pics.get(spec.page.cover),
    galleryAssetIds: spec.page.gallery.map((g) => pics.get(g)!),
    socials: spec.socials.map((url) => ({ url })),
    hiddenSections: [],
  };
  const common = { organizationId: org.id, pageId: page.id, content, templateId: tpl.id, templateVersionId: tpl.currentVersionId!, colorScheme: spec.page.scheme, bookingButtonPosition: spec.page.button, primaryLocale: 'ru' };
  await prisma.pageDraft.create({ data: { ...common, hasChanges: false } });
  const pub = await prisma.pagePublication.create({ data: { ...common, version: 1, publishedByUserId: owner.id } });
  await prisma.publicPage.update({ where: { id: page.id }, data: { publishedPublicationId: pub.id } });
}

/**
 * Обложка и галерея для основного демо-салона (demo-salon из demo-data): добавляются один раз, если у страницы
 * ещё нет обложки. Меняется черновик; публикация неизменяема — выпускается следующая версия.
 */
async function decorateDemoSalon(prisma: PrismaClient) {
  const branch = await prisma.branch.findUnique({ where: { slug: 'demo-salon' }, include: { page: { include: { draft: true } } } });
  const page = branch?.page;
  const draft = page?.draft;
  if (!branch || !page || !draft) return;
  const content = (draft.content ?? {}) as Record<string, unknown>;
  let pics = content.coverAssetId ? { cover: content.coverAssetId as string, gallery: (content.galleryAssetIds as string[] | undefined) ?? [] } : null;
  if (!pics) {
    const storage = new StorageService();
    const cover = await image(prisma, storage, branch.organizationId, 'cover', beautySalon());
    const gallery = [await image(prisma, storage, branch.organizationId, 'gallery', beautySalon()), await image(prisma, storage, branch.organizationId, 'gallery', massageRoom())];
    pics = { cover, gallery: [...((content.galleryAssetIds as string[] | undefined) ?? []), ...gallery] };
    await prisma.pageDraft.update({ where: { id: draft.id }, data: { content: { ...content, coverAssetId: pics.cover, galleryAssetIds: pics.gallery } } });
  }
  if (page.publishedPublicationId) {
    const pub = await prisma.pagePublication.findUnique({ where: { id: page.publishedPublicationId } });
    const pc = (pub?.content ?? {}) as Record<string, unknown>;
    if (pub && !pc.coverAssetId) {
      // публикации неизменяемы (append-only): выпускаем следующую версию с картинками
      const last = await prisma.pagePublication.findFirst({ where: { pageId: page.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const next = await prisma.pagePublication.create({
        data: {
          organizationId: pub.organizationId, pageId: pub.pageId, version: (last?.version ?? 0) + 1, content: { ...pc, coverAssetId: pics.cover, galleryAssetIds: pics.gallery },
          translations: pub.translations ?? {}, templateId: pub.templateId, templateVersionId: pub.templateVersionId, colorScheme: pub.colorScheme,
          bookingButtonPosition: pub.bookingButtonPosition, primaryLocale: pub.primaryLocale, publishedByUserId: pub.publishedByUserId,
        },
      });
      await prisma.publicPage.update({ where: { id: page.id }, data: { publishedPublicationId: next.id } });
    }
  }
}

export async function seedDemoVenues(prisma: PrismaClient): Promise<void> {
  if ((process.env.APP_ENV ?? 'development') === 'production') throw new Error('Demo seed is disabled in production');
  await decorateDemoSalon(prisma);
  await seedVenue(prisma, {
    slug: DEMO_VENUES.club.slug,
    ownerEmail: DEMO_VENUES.club.ownerEmail,
    ownerName: 'Тимур (владелец клуба)',
    orgName: 'Компьютерный клуб «Пиксель»',
    category: 'computer_club',
    branch: { name: 'Пиксель на Сатпаева', address: 'Алматы, ул. Сатпаева, 22', phone: '+77272000010', description: 'Игровые ПК и PlayStation 5, открыты до полуночи.', latitude: 43.2365, longitude: 76.9285 },
    page: {
      title: 'Компьютерный клуб «Пиксель»',
      tagline: 'Мощные ПК и PlayStation 5 — займите место онлайн, без звонков',
      about: 'Открыты каждый день с 10:00 до 24:00. Игровые места с RTX 4060 и RTX 4080, мониторы 165–240 Гц, отдельные залы PlayStation 5 с диванами.\nПриходите командой — забронируйте несколько мест на одно время.',
      template: 'neon',
      scheme: 'cyber',
      button: 'floating',
      cover: 'club',
      gallery: ['pc', 'vip', 'ps'],
    },
    categories: ['Компьютеры', 'PlayStation 5'],
    resources: [
      { key: 'std', name: 'ПК Стандарт', type: 'equipment', count: 6, photo: 'pc', description: 'Intel Core i5-13400F · RTX 4060 8 ГБ · 16 ГБ DDR5\nМонитор 27″ 165 Гц, механическая клавиатура, игровая гарнитура' },
      { key: 'vip', name: 'ПК VIP', type: 'equipment', count: 2, photo: 'vip', description: 'Intel Core i7-14700K · RTX 4080 Super 16 ГБ · 32 ГБ DDR5\nДва монитора 27″ 2K 240 Гц, кресло премиум-класса, отдельная зона' },
      { key: 'ps', name: 'Зал PlayStation 5', type: 'hall', count: 2, photo: 'ps', description: 'Телевизор 65″ 4K, 2 геймпада, диван до 4 человек\nFC 25, Mortal Kombat 1, Gran Turismo 7, Tekken 8 и другие игры' },
    ],
    services: [
      { name: 'ПК Стандарт · 1 час', category: 0, price: 800, minutes: 60, resources: { type: 'equipment', keys: ['std'] } },
      { name: 'ПК Стандарт · 3 часа', category: 0, price: 2000, minutes: 180, resources: { type: 'equipment', keys: ['std'] } },
      { name: 'ПК VIP · 1 час', category: 0, price: 1300, minutes: 60, resources: { type: 'equipment', keys: ['vip'] } },
      { name: 'ПК VIP · 3 часа', category: 0, price: 3500, minutes: 180, resources: { type: 'equipment', keys: ['vip'] } },
      { name: 'PlayStation 5 · 1 час', category: 1, price: 2500, minutes: 60, resources: { type: 'hall', keys: ['ps'] }, description: 'Цена за зал, до 4 игроков' },
      { name: 'PlayStation 5 · 3 часа', category: 1, price: 6500, minutes: 180, resources: { type: 'hall', keys: ['ps'] }, description: 'Цена за зал, до 4 игроков' },
    ],
    socials: ['https://instagram.com/pixel_club_demo', 'https://t.me/pixel_club_demo'],
  });
  await seedVenue(prisma, {
    slug: DEMO_VENUES.sauna.slug,
    ownerEmail: DEMO_VENUES.sauna.ownerEmail,
    ownerName: 'Сауле (владелец)',
    orgName: 'Банный комплекс «Тёплый берег»',
    category: 'bath_sauna',
    branch: { name: 'Тёплый берег', address: 'Алматы, ул. Розыбакиева, 77', phone: '+77272000020', description: 'Финская сауна, русская баня на дровах и хаммам.', latitude: 43.2269, longitude: 76.8987 },
    page: {
      title: 'Банный комплекс «Тёплый берег»',
      tagline: 'Финская сауна, русская баня на дровах и хаммам — бронируйте зал онлайн',
      about: 'Каждый зал — отдельный: парная, комната отдыха, душ, полотенца и тапочки включены.\nМожно заказать парение с вениками у нашего пармейстера.',
      template: 'warm',
      scheme: 'amber',
      button: 'floating',
      cover: 'bath',
      gallery: ['finnish', 'banya', 'hammam'],
    },
    categories: ['Аренда зала', 'Парение'],
    resources: [
      { key: 'fin', name: 'Финская сауна', type: 'hall', photo: 'finnish', description: 'До 8 гостей · бассейн 3×5 м · комната отдыха с телевизором' },
      { key: 'rus', name: 'Русская баня на дровах', type: 'hall', photo: 'banya', description: 'До 10 гостей · купель с холодной водой · дубовые и берёзовые веники' },
      { key: 'ham', name: 'Хаммам', type: 'hall', photo: 'hammam', description: 'До 6 гостей · мраморный камень · пенный массаж по запросу' },
    ],
    services: [
      { name: 'Финская сауна · 2 часа', category: 0, price: 18000, minutes: 120, resources: { type: 'hall', keys: ['fin'] } },
      { name: 'Финская сауна · 3 часа', category: 0, price: 25000, minutes: 180, resources: { type: 'hall', keys: ['fin'] } },
      { name: 'Русская баня · 2 часа', category: 0, price: 22000, minutes: 120, resources: { type: 'hall', keys: ['rus'] } },
      { name: 'Русская баня · 3 часа', category: 0, price: 30000, minutes: 180, resources: { type: 'hall', keys: ['rus'] } },
      { name: 'Хаммам · 2 часа', category: 0, price: 20000, minutes: 120, resources: { type: 'hall', keys: ['ham'] } },
      { name: 'Парение с вениками', category: 1, price: 10000, minutes: 60, specialist: true, description: 'Классическое парение дубовыми и берёзовыми вениками' },
    ],
    specialists: [{ name: 'Нурлан', specialization: 'Пармейстер', description: 'Стаж 8 лет, авторские программы парения' }],
    socials: ['https://instagram.com/teplyi_bereg_demo', 'https://wa.me/77272000020'],
  });
}
