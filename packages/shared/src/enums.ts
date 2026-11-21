/** Общие перечисления домена. Значения совпадают со значениями enum в PostgreSQL. */

export const ROLES = ['SUPERADMIN', 'OWNER', 'BRANCH_ADMIN', 'CLIENT'] as const;
export type Role = (typeof ROLES)[number];

export const LOCALES = ['ru', 'kk', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
/** Языки интерфейса кабинетов (ТЗ §1.2). */
export const DASHBOARD_LOCALES = ['ru', 'kk'] as const;
export type DashboardLocale = (typeof DASHBOARD_LOCALES)[number];

export const APPOINTMENT_STATUSES = [
  'pending_otp',
  'confirmed',
  'completed',
  'no_show',
  'cancelled_by_client',
  'cancelled_by_admin',
  'expired_otp',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = ['active', 'grace_period', 'expired', 'suspended'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PAGE_STATUSES = ['active', 'temporarily_closed', 'disabled'] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

export const RESOURCE_TYPES = [
  'specialist',
  'cabinet',
  'hall',
  'equipment',
  'vehicle',
  'service_bay',
  'other',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const TRANSLATION_STATUSES = ['missing', 'auto_translated', 'verified', 'manually_edited'] as const;
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'otp',
  'appointment_confirmed',
  'appointment_reminder',
  'appointment_rescheduled',
  'appointment_cancelled',
  'appointment_completed',
  'review_request',
  'waitlist_offer',
  /** Реактивация клиента без визитов (§15.1, D-34): маркетинговая категория Meta, нужно согласие marketing. */
  'reactivation',
  /** Ответ на входящее сообщение в 24-часовом окне (D-32): обычный текст, не шаблон. */
  'whatsapp_auto_reply',
  'marketing_unsubscribed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['whatsapp', 'sms', 'email', 'dev_inbox'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = [
  'pending',
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
  'dead',
  'cancelled',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const DISCOUNT_TYPES = ['percent', 'fixed'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const PROMOTION_KINDS = ['promo_code', 'sale'] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export const MULTI_SERVICE_MODES = ['sequential', 'parallel'] as const;
export type MultiServiceMode = (typeof MULTI_SERVICE_MODES)[number];

/** Лист ожидания (§9). pending_otp — номер ещё не подтверждён. */
export const WAITLIST_ENTRY_STATUSES = ['pending_otp', 'waiting', 'offered', 'booked', 'cancelled', 'expired'] as const;
export type WaitlistEntryStatus = (typeof WAITLIST_ENTRY_STATUSES)[number];
export const WAITLIST_OFFER_STATUSES = ['pending', 'accepted', 'declined', 'expired', 'cancelled', 'lost'] as const;
export type WaitlistOfferStatus = (typeof WAITLIST_OFFER_STATUSES)[number];
/** fifo — по времени постановки; priority — сначала приоритет, назначенный администратором, затем время. */
export const WAITLIST_PRIORITY_MODES = ['fifo', 'priority'] as const;
export type WaitlistPriorityMode = (typeof WAITLIST_PRIORITY_MODES)[number];
/** После истечения срока предложений: offer_next — следующим в очереди; release — слот остаётся в общей записи. */
export const WAITLIST_AFTER_EXPIRY = ['offer_next', 'release'] as const;
export type WaitlistAfterExpiry = (typeof WAITLIST_AFTER_EXPIRY)[number];

export const REVIEW_STATUSES = ['published', 'hidden'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const ANALYTICS_EVENT_TYPES = [
  'page_view',
  'booking_click',
  'booking_started',
  'booking_completed',
  'booking_cancelled',
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export const BOOKING_BUTTON_POSITIONS = ['header', 'floating', 'after_services', 'bottom'] as const;
export type BookingButtonPosition = (typeof BOOKING_BUTTON_POSITIONS)[number];

export const PAGE_SECTIONS = [
  'hero',
  'about',
  'gallery',
  'services',
  'specialists',
  'promotions',
  'reviews',
  'schedule',
  'contacts',
  'map',
  'socials',
] as const;
export type PageSection = (typeof PAGE_SECTIONS)[number];
