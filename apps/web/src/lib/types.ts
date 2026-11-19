export interface ColorScheme {
  key: string;
  name: string;
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
}

export interface PublicPageData {
  slug: string;
  version: number | null;
  preview?: boolean;
  locale: 'ru' | 'kk' | 'en';
  primaryLocale: string;
  availableLocales: string[];
  autoTranslated: boolean;
  missingTranslation: boolean;
  availability: { mode: 'open' | 'closed_notice' | 'hidden'; bookingEnabled: boolean; reason: string | null };
  template: { key: string; layout: 'classic' | 'modern' | 'minimal' | 'bold'; sectionOrder: string[]; colors: ColorScheme; bookingButtonPosition: string };
  branch: {
    id: string;
    name: string;
    organizationName: string;
    address: string | null;
    phone: string | null;
    timezone: string;
    map: { latitude: number | null; longitude: number | null; url: string | null } | null;
  };
  content: {
    title: string;
    tagline: string | null;
    about: string | null;
    closedMessage: string | null;
    logo: Record<string, string> | null;
    cover: Record<string, string> | null;
    gallery: Array<Record<string, string>>;
    socials: Array<{ url: string; platform: string; label: string }>;
  };
  schedule: Array<{ weekday: number; intervals: Array<{ start: string; end: string }> }>;
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    category: { id: string; name: string } | null;
    price: number;
    durationMinutes: number;
    onlineBooking: boolean;
    photo: Record<string, string> | null;
  }>;
  specialists: Array<{ id: string; name: string; specialization: string | null; description: string | null; photo: Record<string, string> | null; serviceIds: string[] }>;
  reviews: { average: number | null; count: number; items: Array<{ id: string; rating: number; text: string | null; authorName: string; reply: string | null; createdAt: string }> };
  promotions: Array<{ id: string; kind: string; name: string; description: string | null; code: string | null; discountType: string; discountValue: number; endsAt: string | null }>;
}

export interface AppointmentView {
  id: string;
  status: string;
  source: string;
  startAt: string;
  endAt: string;
  timezone: string;
  locale: string;
  comment: string | null;
  branch: { id: string; name: string; slug: string; address: string | null; phone: string | null };
  client: { id: string; name: string; phone: string };
  items: Array<{
    id: string;
    serviceId: string;
    serviceName: string;
    specialistId: string | null;
    specialistName: string | null;
    startAt: string;
    endAt: string;
    durationMinutes: number;
    basePrice: number;
    saleDiscount: number;
    promoDiscount: number;
    finalPrice: number;
  }>;
  price: { currency: string; baseTotal: number; saleDiscountTotal: number; promoDiscountTotal: number; total: number; promoCode: string | null };
  hold: { expiresAt: string; extensionCount: number } | null;
  cancelDeadline: string;
  rescheduleDeadline: string;
  canCancel: boolean;
  canReschedule: boolean;
  canReview: boolean;
  review: { id: string; rating: number } | null;
}

export interface SlotsResponse {
  date: string;
  timezone: string;
  slots: Array<{ startAt: string; endAt: string; items: Array<{ serviceId: string; specialistId: string | null; specialistName: string | null; startAt: string; endAt: string }> }>;
}
