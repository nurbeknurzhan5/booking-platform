import { z } from 'zod';
import {
  BOOKING_BUTTON_POSITIONS,
  DISCOUNT_TYPES,
  LOCALES,
  MULTI_SERVICE_MODES,
  PAGE_SECTIONS,
  PAGE_STATUSES,
  PROMOTION_KINDS,
  RESOURCE_TYPES,
  ANALYTICS_EVENT_TYPES,
  DASHBOARD_LOCALES,
  WAITLIST_AFTER_EXPIRY,
  WAITLIST_ENTRY_STATUSES,
  WAITLIST_PRIORITY_MODES,
} from './enums';
import { BRANCH_PERMISSIONS } from './permissions';
import { normalizePhone, normalizeKzMobile, isKzPhone } from './phone';
import { SLUG_REGEX, isSafeHttpUrl } from './text';

/**
 * Схема частичного обновления (PATCH): все поля необязательны и БЕЗ значений по умолчанию.
 * В Zod 4 `.partial()` сохраняет `.default()`, и отсутствующее поле получало бы значение по умолчанию:
 * например, `branches: []` отвязывал услугу от всех филиалов, а `isActive: true` включал отключённый тариф.
 */
export function updateSchemaOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    shape[key] = field instanceof z.ZodDefault ? (field.removeDefault() as z.ZodType) : (field as z.ZodType);
  }
  return z.object(shape).partial() as unknown as ReturnType<z.ZodObject<T>['partial']>;
}

// ---------- примитивы ----------
export const zId = z.uuid();
export const zLocale = z.enum(LOCALES);
export const zDashboardLocale = z.enum(DASHBOARD_LOCALES);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата YYYY-MM-DD');
export const zTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Ожидается время HH:MM');
export const zDateTime = z.iso.datetime({ offset: true });
export const zMoney = z.number().int().min(0).max(100_000_000);
export const zMinutes = z.number().int().min(0).max(24 * 60);
export const zHttpUrl = z.string().max(500).refine(isSafeHttpUrl, 'Допустимы только http(s)-ссылки');
export const zTimezone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Неизвестный часовой пояс');

/** Мобильный номер РК, нормализуется в +77XXXXXXXXX. */
export const zKzMobile = z
  .string()
  .max(32)
  .transform((v, ctx) => {
    const n = normalizeKzMobile(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Некорректный мобильный номер Казахстана' });
      return z.NEVER;
    }
    return n;
  });

/** Любой номер РК (городской или мобильный). */
export const zKzPhone = z
  .string()
  .max(32)
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n || !isKzPhone(n)) {
      ctx.addIssue({ code: 'custom', message: 'Некорректный номер телефона' });
      return z.NEVER;
    }
    return n;
  });

export const zEmail = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const zPassword = z.string().min(10, 'Минимум 10 символов').max(128);
export const zSlug = z.string().regex(SLUG_REGEX, 'Только латиница, цифры и дефисы (3–60 символов)');
export const zName = z.string().trim().min(1).max(200);
export const zText = z.string().max(5000);
export const zPagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Многоязычный текст: основной язык обязателен на уровне бизнес-логики. */
export const zI18nText = z.object({ ru: z.string().max(5000).optional(), kk: z.string().max(5000).optional(), en: z.string().max(5000).optional() });

// ---------- auth ----------
export const StaffLoginSchema = z.object({
  email: zEmail,
  password: z.string().min(1).max(128),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});
export const ChangePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: zPassword });
export const ClientOtpRequestSchema = z.object({ phone: zKzMobile });
export const ClientOtpVerifySchema = z.object({
  phone: zKzMobile,
  code: z.string().regex(/^\d{6}$/),
  name: zName.optional(),
});

// ---------- организации и филиалы ----------
export const ContactsSchema = z.object({
  phone: zKzPhone.optional(),
  email: zEmail.optional(),
  website: zHttpUrl.optional(),
});

export const UpdateOrganizationSchema = z.object({
  name: zName.optional(),
  description: zText.optional(),
  contacts: ContactsSchema.optional(),
  defaultLocale: zLocale.optional(),
});

export const WorkingIntervalSchema = z
  .object({ start: zTime, end: zTime })
  .refine((v) => v.start < v.end, 'Начало должно быть раньше конца');

export const BranchInputSchema = z.object({
  name: zName,
  slug: zSlug.optional(),
  address: z.string().max(500).optional(),
  phone: zKzPhone.optional(),
  timezone: zTimezone.default('Asia/Almaty'),
  description: zText.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  mapUrl: zHttpUrl.optional(),
  mapEnabled: z.boolean().optional(),
});
export const UpdateBranchSchema = updateSchemaOf(BranchInputSchema).omit({ slug: true });

// ---------- пользователи ----------
export const BranchAccessSchema = z.object({
  branchId: zId,
  permissions: z.array(z.enum(BRANCH_PERMISSIONS)).max(BRANCH_PERMISSIONS.length),
});
export const CreateStaffUserSchema = z.object({
  email: zEmail,
  name: zName,
  phone: zKzMobile.optional(),
  temporaryPassword: zPassword,
  role: z.enum(['OWNER', 'BRANCH_ADMIN']),
  branchAccess: z.array(BranchAccessSchema).max(100).default([]),
});
export const UpdateStaffAccessSchema = z.object({ branchAccess: z.array(BranchAccessSchema).max(100) });

// ---------- услуги ----------
export const ServiceResourceRequirementSchema = z.object({
  resourceType: z.enum(RESOURCE_TYPES).exclude(['specialist']),
  quantity: z.number().int().min(1).max(5).default(1),
});

export const ServiceInputSchema = z.object({
  name: zName,
  description: zText.optional(),
  categoryId: zId.nullable().optional(),
  photoAssetId: zId.nullable().optional(),
  price: zMoney,
  durationMinutes: z.number().int().min(5).max(24 * 60),
  bufferBeforeMinutes: zMinutes.default(0),
  bufferAfterMinutes: zMinutes.default(0),
  requiresSpecialist: z.boolean().default(true),
  isActive: z.boolean().default(true),
  onlineBookingEnabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100000).default(0),
  resourceRequirements: z.array(ServiceResourceRequirementSchema).max(10).default([]),
  branches: z
    .array(z.object({ branchId: zId, priceOverride: zMoney.nullable().optional() }))
    .max(100)
    .default([]),
});
export const UpdateServiceSchema = updateSchemaOf(ServiceInputSchema);

export const ServiceCategoryInputSchema = z.object({ name: zName, sortOrder: z.number().int().min(0).default(0) });

// ---------- ресурсы и специалисты ----------
export const ResourceInputSchema = z.object({
  name: zName,
  type: z.enum(RESOURCE_TYPES).exclude(['specialist']),
  description: zText.optional(),
  /** Показывать на публичной странице: места, залы, оборудование. */
  isPublic: z.boolean().default(false),
  photoAssetId: zId.nullable().optional(),
  isActive: z.boolean().default(true),
  serviceIds: z.array(zId).max(500).default([]),
  sortOrder: z.number().int().min(0).default(0),
});
export const UpdateResourceSchema = updateSchemaOf(ResourceInputSchema).omit({ type: true });

// ---------- смены (задача 21) ----------
export const SCHEDULE_MODES = ['weekly', 'shifts'] as const;
const zMinute = z.number().int().min(0).max(1440);
/** Смена специалиста на дату; force — подтвердить, несмотря на записи вне новой смены. */
export const ShiftUpsertSchema = z
  .object({
    resourceId: zId,
    date: zDate,
    startMinute: zMinute,
    endMinute: zMinute,
    breakStart: zMinute.nullable().optional(),
    breakEnd: zMinute.nullable().optional(),
    force: z.boolean().default(false),
  })
  .refine((v) => v.endMinute > v.startMinute, { message: 'Окончание смены должно быть позже начала', path: ['endMinute'] })
  .refine((v) => (v.breakStart === null || v.breakStart === undefined) === (v.breakEnd === null || v.breakEnd === undefined), { message: 'Укажите начало и конец перерыва', path: ['breakEnd'] })
  .refine((v) => v.breakStart === null || v.breakStart === undefined || (v.breakStart >= v.startMinute && v.breakEnd! <= v.endMinute && v.breakEnd! > v.breakStart), {
    message: 'Перерыв должен быть внутри смены',
    path: ['breakStart'],
  });
export const ShiftDeleteSchema = z.object({ resourceId: zId, date: zDate, force: z.boolean().default(false) });
export const ShiftRangeQuerySchema = z
  .object({ from: zDate, to: zDate })
  .refine((v) => v.from <= v.to, { message: 'Неверный период', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400_000 <= 62, { message: 'Не больше 62 дней', path: ['to'] });
/** Заполнить смены по недельному графику на период (существующие смены не трогаются, если overwrite = false). */
export const ShiftFillSchema = z
  .object({ from: zDate, to: zDate, resourceIds: z.array(zId).max(200).optional(), overwrite: z.boolean().default(false) })
  .refine((v) => v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) / 86400_000 <= 62, { message: 'Период до 62 дней', path: ['to'] });
/** Скопировать смены дня на другие даты. */
export const ShiftCopySchema = z.object({ fromDate: zDate, toDates: z.array(zDate).min(1).max(62), overwrite: z.boolean().default(false) });

export const SpecialistInputSchema = z.object({
  name: zName,
  specialization: z.string().max(200).optional(),
  description: zText.optional(),
  photoAssetId: zId.nullable().optional(),
  isActive: z.boolean().default(true),
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  services: z
    .array(z.object({ serviceId: zId, priceOverride: zMoney.nullable().optional() }))
    .max(500)
    .default([]),
});
export const UpdateSpecialistSchema = updateSchemaOf(SpecialistInputSchema);
/** Какие специалисты филиала оказывают услугу (назначение из карточки услуги). */
export const ServiceSpecialistsSchema = z.object({ specialistIds: z.array(zId).max(500) });

// ---------- расписание ----------
export const WeeklyScheduleSchema = z.object({
  /** null — расписание филиала; иначе — ресурса (в т.ч. специалиста). */
  resourceId: zId.nullable(),
  days: z
    .array(
      z.object({
        weekday: z.number().int().min(1).max(7), // ISO: 1 = понедельник
        intervals: z.array(WorkingIntervalSchema).max(6),
        breaks: z.array(WorkingIntervalSchema).max(6).default([]),
      }),
    )
    .max(7),
});

export const ScheduleExceptionInputSchema = z
  .object({
    resourceId: zId.nullable(),
    dateFrom: zDate,
    dateTo: zDate,
    /** closed — выходной/праздник/закрытие; custom_hours — особые часы. */
    kind: z.enum(['closed', 'custom_hours']),
    intervals: z.array(WorkingIntervalSchema).max(6).default([]),
    reason: z.string().max(300).optional(),
  })
  .refine((v) => v.dateFrom <= v.dateTo, 'dateFrom должна быть не позже dateTo')
  .refine((v) => v.kind === 'closed' || v.intervals.length > 0, 'Для особых часов нужны интервалы');

// ---------- настройки бронирования ----------
export const BookingSettingsSchema = z.object({
  slotIntervalMinutes: z.number().int().min(5).max(240),
  holdMinutes: z.number().int().min(1).max(30),
  holdExtensionAllowed: z.boolean(),
  minLeadMinutes: z.number().int().min(0).max(60 * 24 * 14),
  maxHorizonDays: z.number().int().min(1).max(365),
  rescheduleDeadlineMinutes: z.number().int().min(0).max(60 * 24 * 14),
  cancelDeadlineMinutes: z.number().int().min(0).max(60 * 24 * 14),
  allowLateCancelException: z.boolean(),
  maxActiveAppointmentsPerClient: z.number().int().min(1).max(50),
  allowRebookWithActive: z.boolean(),
  adminCanOverrideClientLimits: z.boolean(),
  multiServiceMode: z.enum(MULTI_SERVICE_MODES),
  loadBalancing: z.boolean(),
  specialistPricingEnabled: z.boolean(),
  reminderHoursBefore: z.number().int().min(0).max(168),
  onlineBookingEnabled: z.boolean(),
  // Лист ожидания (§9). Необязательны: не переданное поле не меняется.
  waitlistEnabled: z.boolean().optional(),
  waitlistOfferMinutes: z.number().int().min(5).max(24 * 60).optional(),
  waitlistRecipients: z.number().int().min(1).max(10).optional(),
  waitlistPriority: z.enum(WAITLIST_PRIORITY_MODES).optional(),
  waitlistAfterExpiry: z.enum(WAITLIST_AFTER_EXPIRY).optional(),
  /** weekly — по недельному графику; shifts — специалисты работают только в назначенные смены (задача 21). */
  scheduleMode: z.enum(SCHEDULE_MODES).optional(),
});
export type BookingSettings = z.infer<typeof BookingSettingsSchema>;

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  slotIntervalMinutes: 15,
  holdMinutes: 5,
  holdExtensionAllowed: true,
  minLeadMinutes: 60,
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
  waitlistEnabled: false,
  waitlistOfferMinutes: 15,
  waitlistRecipients: 3,
  waitlistPriority: 'fifo',
  waitlistAfterExpiry: 'offer_next',
  scheduleMode: 'weekly',
};

// ---------- бронирование ----------
export const BookingItemSchema = z.object({
  serviceId: zId,
  /** null/не указан — автоматический подбор («любой специалист»). */
  specialistId: zId.nullable().optional(),
  /** Групповая бронь (D-41): сколько одинаковых мест занять (ПК, консоли). Только для услуг без специалиста. */
  seats: z.number().int().min(1).max(10).optional(),
  /** Места должны идти подряд по нумерации («сидеть рядом»). */
  together: z.boolean().optional(),
});

export const AvailabilitySearchSchema = z.object({
  date: zDate,
  items: z.array(BookingItemSchema).min(1).max(10),
});

export const UtmSchema = z.object({
  source: z.string().max(100).optional(),
  medium: z.string().max(100).optional(),
  campaign: z.string().max(100).optional(),
  term: z.string().max(100).optional(),
  content: z.string().max(100).optional(),
});

export const CreateHoldSchema = z.object({
  startAt: zDateTime,
  items: z.array(BookingItemSchema).min(1).max(10),
  client: z.object({ name: zName, phone: zKzMobile }),
  promoCode: z.string().trim().max(50).optional(),
  locale: zLocale.default('ru'),
  consents: z.object({
    personalData: z.literal(true, { error: 'Требуется согласие на обработку персональных данных' }),
    notifications: z.boolean().default(true),
    whatsapp: z.boolean().default(true),
    /** Рекламные сообщения (D-34). Отметка — новое согласие; без отметки прежнее решение клиента не меняется. */
    marketing: z.boolean().default(false),
  }),
  comment: z.string().max(1000).optional(),
  utm: UtmSchema.optional(),
  visitorSession: z.string().max(64).optional(),
  /** Антибот: скрытое поле, должно быть пустым. */
  website: z.string().max(0).optional(),
  /** Антибот: время заполнения формы, мс. */
  formElapsedMs: z.number().int().min(0).optional(),
});

export const HoldTokenSchema = z.object({ holdToken: z.string().min(20).max(200) });
/** Подтверждение записи по ссылке из сообщения (D-42): токен `<id>.<секрет>`. */
export const ConfirmLinkSchema = z.object({ token: z.string().min(40).max(200) });

export const RescheduleSchema = z.object({
  startAt: zDateTime,
  items: z.array(BookingItemSchema).min(1).max(10).optional(),
});
export const CancelSchema = z.object({ reason: z.string().max(500).optional() });

export const QuoteSchema = z.object({
  items: z.array(BookingItemSchema).min(1).max(10),
  promoCode: z.string().trim().max(50).optional(),
  phone: zKzMobile.optional(),
});

export const ManualAppointmentSchema = z.object({
  branchId: zId,
  startAt: zDateTime,
  items: z.array(BookingItemSchema).min(1).max(10),
  client: z.object({ name: zName, phone: zKzMobile }),
  promoCode: z.string().trim().max(50).optional(),
  comment: z.string().max(1000).optional(),
  overrideClientLimits: z.boolean().default(false),
  notifyClient: z.boolean().default(true),
});

export const AdminStatusChangeSchema = z.object({
  status: z.enum(['completed', 'no_show', 'cancelled_by_admin']),
  reason: z.string().max(500).optional(),
});

export const AppointmentListQuerySchema = zPagination.extend({
  branchId: zId.optional(),
  from: zDateTime.optional(),
  to: zDateTime.optional(),
  status: z.string().max(200).optional(),
  specialistId: zId.optional(),
  clientId: zId.optional(),
});

// ---------- лист ожидания (§9) ----------
const WaitlistRequestBase = z.object({
  items: z.array(z.object({ serviceId: zId })).min(1).max(5),
  /** Конкретный специалист для всех услуг или null — любой. */
  specialistId: zId.nullable().optional(),
  dateFrom: zDate,
  dateTo: zDate,
});
const dateRangeOk = (v: { dateFrom: string; dateTo: string }) => v.dateFrom <= v.dateTo;

export const JoinWaitlistSchema = WaitlistRequestBase.extend({
  client: z.object({ name: zName, phone: zKzMobile }),
  locale: zLocale.default('ru'),
  consents: z.object({
    personalData: z.literal(true, { error: 'Требуется согласие на обработку персональных данных' }),
    notifications: z.boolean().default(true),
    whatsapp: z.boolean().default(true),
  }),
  website: z.string().max(0).optional(),
  formElapsedMs: z.number().int().min(0).optional(),
}).refine(dateRangeOk, 'dateFrom должна быть не позже dateTo');

export const WaitlistTokenSchema = z.object({ token: z.string().min(20).max(200) });
export const ConfirmWaitlistSchema = WaitlistTokenSchema.extend({ code: z.string().regex(/^\d{6}$/) });
export const DeclineWaitlistOfferSchema = z.object({ leaveWaitlist: z.boolean().default(false) });

export const StaffWaitlistCreateSchema = WaitlistRequestBase.extend({
  branchId: zId,
  client: z.object({ name: zName, phone: zKzMobile }),
  priority: z.number().int().min(0).max(100).default(0),
}).refine(dateRangeOk, 'dateFrom должна быть не позже dateTo');
export const StaffWaitlistUpdateSchema = z.object({ priority: z.number().int().min(0).max(100) });
export const WaitlistListQuerySchema = zPagination.extend({
  branchId: zId.optional(),
  /** active = waiting + offered. Без фильтра — все, кроме неподтверждённых. */
  status: z.enum([...WAITLIST_ENTRY_STATUSES, 'active']).optional(),
});

// ---------- клиенты ----------
export const ClientListQuerySchema = zPagination.extend({ search: z.string().max(100).optional() });
export const UpdateClientSchema = z.object({
  name: zName.optional(),
  notes: z.string().max(2000).optional(),
  locale: zLocale.optional(),
});
export const MergeClientsSchema = z.object({ sourceClientId: zId, targetClientId: zId });
export const UpdateMyProfileSchema = z.object({
  name: zName.optional(),
  locale: zLocale.optional(),
  consents: z
    .object({ notifications: z.boolean().optional(), whatsapp: z.boolean().optional(), marketing: z.boolean().optional() })
    .optional(),
});

// ---------- отзывы ----------
export const CreateReviewSchema = z.object({ rating: z.number().int().min(1).max(5), text: z.string().trim().max(2000).optional() });
export const ReviewReplySchema = z.object({ text: z.string().trim().min(1).max(2000) });
export const ReviewModerationSchema = z.object({ status: z.enum(['published', 'hidden']), reason: z.string().min(3).max(500) });

// ---------- промокоды и акции ----------
export const PromotionInputSchema = z
  .object({
    kind: z.enum(PROMOTION_KINDS),
    name: zName,
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,50}$/, 'Код: латиница, цифры, _ и -')
      .optional(),
    description: zText.optional(),
    discountType: z.enum(DISCOUNT_TYPES),
    discountValue: z.number().int().min(1),
    startsAt: zDateTime.nullable().optional(),
    endsAt: zDateTime.nullable().optional(),
    branchIds: z.array(zId).max(100).nullable().optional(),
    serviceIds: z.array(zId).max(500).nullable().optional(),
    minAmount: zMoney.nullable().optional(),
    usageLimit: z.number().int().min(1).nullable().optional(),
    perClientLimit: z.number().int().min(1).nullable().optional(),
    isActive: z.boolean().default(true),
    showOnPage: z.boolean().default(false),
  })
  .refine((v) => v.kind !== 'promo_code' || !!v.code, { message: 'Для промокода нужен код', path: ['code'] })
  .refine((v) => v.discountType !== 'percent' || v.discountValue <= 100, {
    message: 'Процент не больше 100',
    path: ['discountValue'],
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.startsAt < v.endsAt, { message: 'Неверный период', path: ['endsAt'] });

// ---------- публичные страницы ----------
export const SocialLinkSchema = z.object({
  url: zHttpUrl,
  label: z.string().max(60).optional(),
});

export const PageContentSchema = z.object({
  title: zI18nText.optional(),
  tagline: zI18nText.optional(),
  about: zI18nText.optional(),
  logoAssetId: zId.nullable().optional(),
  coverAssetId: zId.nullable().optional(),
  galleryAssetIds: z.array(zId).max(30).default([]),
  socials: z.array(SocialLinkSchema).max(20).default([]),
  hiddenSections: z.array(z.enum(PAGE_SECTIONS)).max(PAGE_SECTIONS.length).default([]),
  closedMessage: zI18nText.optional(),
});
export type PageContent = z.infer<typeof PageContentSchema>;

export const SavePageDraftSchema = z.object({
  content: PageContentSchema,
  templateId: zId,
  colorScheme: z.string().max(40),
  bookingButtonPosition: z.enum(BOOKING_BUTTON_POSITIONS),
  primaryLocale: zLocale,
});

export const PageStatusSchema = z.object({ status: z.enum(PAGE_STATUSES) });

export const TranslationUpsertSchema = z.object({
  items: z
    .array(
      z.object({
        entityType: z.enum(['page', 'service', 'specialist', 'service_category', 'promotion']),
        entityId: zId,
        field: z.string().max(60),
        locale: zLocale,
        text: z.string().max(5000),
        verified: z.boolean().default(false),
      }),
    )
    .max(500),
});
export const AutoTranslateSchema = z.object({
  locale: zLocale,
  /** Перезаписать автопереводы (ручные не перезаписываются никогда без overwriteManual). */
  overwriteAuto: z.boolean().default(false),
  overwriteManual: z.boolean().default(false),
});

export const PageModerationSchema = z.object({ blocked: z.boolean(), reason: z.string().min(3).max(500) });

// ---------- шаблоны ----------
export const TEMPLATE_LAYOUTS = ['classic', 'modern', 'minimal', 'bold', 'neon', 'warm', 'luxe', 'fresh'] as const;
export const TemplateConfigSchema = z.object({
  layout: z.enum(TEMPLATE_LAYOUTS),
  /** Стиль поверх макета (задачи 23–24): шрифт заголовков, первый экран, карточки, скругления. */
  style: z
    .object({
      font: z.enum(['sans', 'serif', 'display', 'mono']),
      hero: z.enum(['cover', 'split', 'centered', 'minimal']),
      cards: z.enum(['shadow', 'outline', 'flat', 'glass']),
      radius: z.enum(['none', 'md', 'xl', '2xl']),
    })
    .partial()
    .optional(),
  /** Направления бизнеса, для которых тема рекомендуется в магазине оформлений. */
  tags: z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).max(20).optional(),
  sectionOrder: z.array(z.enum(PAGE_SECTIONS)).min(1),
  colorSchemes: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9_-]{2,40}$/),
        name: z.string().max(60),
        primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        surface: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
    )
    .min(1)
    .max(12),
  bookingButtonPositions: z.array(z.enum(BOOKING_BUTTON_POSITIONS)).min(1),
});
export type TemplateConfig = z.infer<typeof TemplateConfigSchema>;

export const TemplateInputSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: zName,
  description: zText.optional(),
  previewAssetId: zId.nullable().optional(),
  config: TemplateConfigSchema,
});
export const TemplateUpdateSchema = z.object({
  name: zName.optional(),
  description: zText.optional(),
  config: TemplateConfigSchema.optional(),
});

// ---------- аналитика ----------
export const AnalyticsEventSchema = z.object({
  slug: zSlug,
  type: z.enum(ANALYTICS_EVENT_TYPES),
  sessionId: z.string().max(64).optional(),
  utm: UtmSchema.optional(),
  referrer: z.string().max(500).optional(),
  path: z.string().max(500).optional(),
  serviceIds: z.array(zId).max(10).optional(),
});
export const AnalyticsQuerySchema = z.object({
  branchId: zId.optional(),
  from: zDate,
  to: zDate,
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});

// ---------- суперадмин ----------
export const PlanInputSchema = z.object({
  code: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  name: zName,
  description: zText.optional(),
  maxBranches: z.number().int().min(1).max(1000),
  monthlyPrice: zMoney,
  isActive: z.boolean().default(true),
});
export const UpdatePlanSchema = updateSchemaOf(PlanInputSchema).omit({ code: true });

export const CreateOrganizationSchema = z.object({
  name: zName,
  businessCategory: z.string().regex(/^[a-z0-9_]{2,40}$/),
  contacts: ContactsSchema.default({}),
  defaultLocale: zLocale.default('ru'),
  owner: z.object({ email: zEmail, name: zName, phone: zKzMobile.optional(), temporaryPassword: zPassword }).optional(),
  subscription: z
    .object({
      planId: zId,
      maxBranches: z.number().int().min(1).max(1000).optional(),
      price: zMoney.optional(),
      startsAt: zDateTime,
      endsAt: zDateTime,
      graceDays: z.number().int().min(0).max(90).default(7),
    })
    .optional(),
});
export const AdminUpdateOrganizationSchema = z.object({
  name: zName.optional(),
  businessCategory: z.string().regex(/^[a-z0-9_]{2,40}$/).optional(),
  contacts: ContactsSchema.optional(),
});

export const SetSubscriptionSchema = z
  .object({
    planId: zId,
    maxBranches: z.number().int().min(1).max(1000).optional(),
    price: zMoney.optional(),
    startsAt: zDateTime,
    endsAt: zDateTime,
    graceDays: z.number().int().min(0).max(90).default(7),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.startsAt < v.endsAt, { message: 'Неверный период', path: ['endsAt'] });

export const RecordPaymentSchema = z.object({
  amount: zMoney,
  paidAt: zDateTime,
  method: z.enum(['bank_transfer', 'kaspi', 'cash', 'card', 'other']),
  reference: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
  /** Продлить подписку до этой даты (подтверждение оплаты). */
  extendTo: zDateTime.optional(),
});

export const SuspendOrganizationSchema = z.object({ reason: z.string().min(3).max(500) });
export const AdminCreateUserSchema = z.object({
  email: zEmail,
  name: zName,
  phone: zKzMobile.optional(),
  temporaryPassword: zPassword,
});
export const BlockUserSchema = z.object({ reason: z.string().min(3).max(500) });
/** Восстановление доступа сотруднику (§3.4): временный пароль, смена при следующем входе. */
export const ResetUserPasswordSchema = z.object({ temporaryPassword: zPassword, reason: z.string().min(3).max(500) });
export const SystemSettingsSchema = z.object({
  otpTtlSeconds: z.number().int().min(60).max(900),
  otpMaxAttempts: z.number().int().min(3).max(10),
  otpResendCooldownSeconds: z.number().int().min(30).max(600),
  otpMaxPerPhonePerHour: z.number().int().min(1).max(20),
  otpMaxPerIpPerHour: z.number().int().min(1).max(200),
  notificationMaxAttempts: z.number().int().min(1).max(20),
  defaultGraceDays: z.number().int().min(0).max(90),
});
export type SystemSettings = z.infer<typeof SystemSettingsSchema>;
export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  otpTtlSeconds: 300,
  otpMaxAttempts: 5,
  otpResendCooldownSeconds: 60,
  otpMaxPerPhonePerHour: 5,
  otpMaxPerIpPerHour: 30,
  notificationMaxAttempts: 6,
  defaultGraceDays: 7,
};

/** Реактивация не раньше чем через 30 дней после визита и не чаще 1 раза в 30 дней на номер (D-34). */
export const REACTIVATION_MIN_DAYS = 30;
export const REACTIVATION_COOLDOWN_DAYS = 30;

export const NotificationSettingsSchema = z.object({
  whatsappEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  reminderEnabled: z.boolean(),
  reviewRequestEnabled: z.boolean(),
  /** Реактивация (§15.1, D-34): сообщение клиенту через N дней после последнего визита. Только с согласием marketing. */
  reactivationEnabled: z.boolean().default(false),
  reactivationDays: z.number().int().min(REACTIVATION_MIN_DAYS).max(365).default(60),
});
export const DEFAULT_NOTIFICATION_SETTINGS: z.infer<typeof NotificationSettingsSchema> = {
  whatsappEnabled: true,
  smsEnabled: false,
  reminderEnabled: true,
  reviewRequestEnabled: true,
  reactivationEnabled: false,
  reactivationDays: 60,
};
