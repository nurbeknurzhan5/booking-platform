import { DateTime } from 'luxon';
import { API, createOrgWithOwner, Http, type TestContext } from './helpers';
import { NotificationDispatcher } from '../src/notifications/dispatcher.service';

export const TZ = 'Asia/Almaty';

/** Дата через N дней в часовом поясе филиала. */
export function futureDate(days = 3): string {
  return DateTime.now().setZone(TZ).plus({ days }).toISODate()!;
}

/** ISO-время локального часа филиала. */
export function localTime(date: string, hhmm: string): string {
  return DateTime.fromISO(`${date}T${hhmm}`, { zone: TZ }).toISO()!;
}

let phoneCounter = 1000000;
export function nextPhone(): string {
  phoneCounter += 1;
  return `+7701${String(phoneCounter).padStart(7, '0')}`;
}

export async function publishPageDirect(ctx: TestContext, organizationId: string, branchId: string) {
  const tpl = await ctx.prisma.pageTemplate.findFirstOrThrow({ where: { key: 'classic' }, include: { currentVersion: true } });
  const page = await ctx.prisma.publicPage.findUniqueOrThrow({ where: { branchId } });
  const content = { title: { ru: 'Тест' }, galleryAssetIds: [], socials: [], hiddenSections: [] };
  await ctx.prisma.pageDraft.upsert({
    where: { pageId: page.id },
    create: {
      organizationId,
      pageId: page.id,
      content,
      templateId: tpl.id,
      templateVersionId: tpl.currentVersionId!,
      colorScheme: 'ivory',
      bookingButtonPosition: 'header',
      primaryLocale: 'ru',
    },
    update: {},
  });
  const pub = await ctx.prisma.pagePublication.create({
    data: {
      organizationId,
      pageId: page.id,
      version: 1,
      content,
      templateId: tpl.id,
      templateVersionId: tpl.currentVersionId!,
      colorScheme: 'ivory',
      bookingButtonPosition: 'header',
      primaryLocale: 'ru',
    },
  });
  await ctx.prisma.publicPage.update({ where: { id: page.id }, data: { publishedPublicationId: pub.id } });
}

export interface BookableBranch {
  orgId: string;
  owner: Http;
  branchId: string;
  slug: string;
  services: { haircut: string; color: string; massage: string };
  specialists: { anna: string; bolat: string; ivan: string; petr: string };
  cabinet: string;
}

/**
 * Филиал, готовый к записи: расписание 10:00–20:00 ежедневно,
 * услуги (стрижка, окрашивание, массаж с кабинетом), специалисты, один кабинет.
 */
export async function createBookableBranch(ctx: TestContext, admin: Http, opts: { name?: string } = {}): Promise<BookableBranch> {
  const { orgId, owner } = await createOrgWithOwner(ctx, admin, { name: opts.name ?? 'Салон' });
  const branch = (await owner.post(`${API}/organizations/${orgId}/branches`, { name: `${opts.name ?? 'Салон'} Центр`, timezone: TZ })).body;
  const b = branch.id as string;
  const mk = async (body: object) => {
    const r = await owner.post(`${API}/organizations/${orgId}/services`, body);
    if (r.status !== 201) throw new Error(`service: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.id as string;
  };
  const haircut = await mk({ name: 'Стрижка', price: 5000, durationMinutes: 60, branches: [{ branchId: b }] });
  const color = await mk({ name: 'Окрашивание', price: 15000, durationMinutes: 90, branches: [{ branchId: b }] });
  const massage = await mk({
    name: 'Массаж',
    price: 8000,
    durationMinutes: 60,
    bufferAfterMinutes: 15,
    branches: [{ branchId: b }],
    resourceRequirements: [{ resourceType: 'cabinet', quantity: 1 }],
  });
  const sp = async (name: string, services: string[]) => {
    const r = await owner.post(`${API}/organizations/${orgId}/branches/${b}/specialists`, { name, services: services.map((serviceId) => ({ serviceId })) });
    if (r.status !== 201) throw new Error(`specialist: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.id as string;
  };
  const anna = await sp('Анна', [haircut, color]);
  const bolat = await sp('Болат', [haircut]);
  const ivan = await sp('Иван', [massage]);
  const petr = await sp('Пётр', [massage]);
  const cab = await owner.post(`${API}/organizations/${orgId}/branches/${b}/resources`, { name: 'Кабинет 1', type: 'cabinet', serviceIds: [massage] });
  if (cab.status !== 201) throw new Error(`resource: ${cab.status} ${JSON.stringify(cab.body)}`);
  const days = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, intervals: [{ start: '10:00', end: '20:00' }], breaks: [] }));
  const sch = await owner.put(`${API}/organizations/${orgId}/branches/${b}/schedule/weekly`, { resourceId: null, days });
  if (sch.status !== 200) throw new Error(`schedule: ${sch.status} ${JSON.stringify(sch.body)}`);
  const settings = await owner.put(`${API}/organizations/${orgId}/branches/${b}/booking-settings`, {
    slotIntervalMinutes: 30,
    holdMinutes: 5,
    holdExtensionAllowed: true,
    minLeadMinutes: 0,
    maxHorizonDays: 60,
    rescheduleDeadlineMinutes: 120,
    cancelDeadlineMinutes: 120,
    allowLateCancelException: false,
    maxActiveAppointmentsPerClient: 3,
    allowRebookWithActive: true,
    adminCanOverrideClientLimits: true,
    multiServiceMode: 'sequential',
    loadBalancing: true,
    specialistPricingEnabled: false,
    reminderHoursBefore: 24,
    onlineBookingEnabled: true,
  });
  if (settings.status !== 200) throw new Error(`settings: ${settings.status} ${JSON.stringify(settings.body)}`);
  await publishPageDirect(ctx, orgId, b);
  return { orgId, owner, branchId: b, slug: branch.slug, services: { haircut, color, massage }, specialists: { anna, bolat, ivan, petr }, cabinet: cab.body.id };
}

export async function drainNotifications(ctx: TestContext): Promise<number> {
  return ctx.app.get(NotificationDispatcher).drain();
}

/** Полный публичный сценарий: резерв → OTP из dev_inbox → подтверждение. */
export async function bookAndConfirm(
  ctx: TestContext,
  slug: string,
  body: { startAt: string; items: Array<{ serviceId: string; specialistId?: string | null }>; phone?: string; promoCode?: string },
) {
  const http = new Http(ctx.app);
  const phone = body.phone ?? nextPhone();
  const hold = await http.post(`${API}/public/branches/${slug}/bookings`, {
    startAt: body.startAt,
    items: body.items,
    client: { name: 'Клиент', phone },
    consents: { personalData: true },
    promoCode: body.promoCode,
  });
  if (hold.status !== 201) return { hold, confirm: null, phone, http };
  await drainNotifications(ctx);
  const msg = await ctx.prisma.devInboxMessage.findFirstOrThrow({ where: { recipient: phone, type: 'otp' }, orderBy: { createdAt: 'desc' } });
  const code = /(\d{6})/.exec(msg.text)![1]!;
  const confirm = await http.post(`${API}/public/bookings/${hold.body.appointmentId}/confirm`, { holdToken: hold.body.holdToken, code });
  return { hold, confirm, phone, http };
}
