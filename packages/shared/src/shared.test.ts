import {
  calculateVisitPrice,
  applyDiscount,
  validatePromoRules,
  resolveServicePrice,
  computeSubscriptionStatus,
  resolvePublicAvailability,
  isManagementAllowed,
  canTransition,
  normalizePhone,
  normalizeKzMobile,
  maskPhone,
  hasPermission,
  branchesWithPermission,
  slugify,
  detectSocialPlatform,
  isSafeHttpUrl,
  CreateHoldSchema,
  PromotionInputSchema,
  WeeklyScheduleSchema,
} from './index';

const d = (s: string) => new Date(s);

describe('pricing', () => {
  it('percent and fixed discounts are bounded', () => {
    expect(applyDiscount(10000, { discountType: 'percent', value: 15 })).toBe(1500);
    expect(applyDiscount(10000, { discountType: 'percent', value: 150 })).toBe(10000);
    expect(applyDiscount(1000, { discountType: 'fixed', value: 5000 })).toBe(1000);
    expect(applyDiscount(0, { discountType: 'fixed', value: 5000 })).toBe(0);
  });

  it('sums visit without discounts', () => {
    const r = calculateVisitPrice([
      { key: 'a', serviceId: 's1', basePrice: 5000, sales: [] },
      { key: 'b', serviceId: 's2', basePrice: 3000, sales: [] },
    ]);
    expect(r.baseTotal).toBe(8000);
    expect(r.total).toBe(8000);
    expect(r.promoError).toBeNull();
  });

  it('applies the best sale per item, then promo on subtotal', () => {
    const r = calculateVisitPrice(
      [
        {
          key: 'a',
          serviceId: 's1',
          basePrice: 10000,
          sales: [
            { promotionId: 'p1', discountType: 'percent', value: 10 },
            { promotionId: 'p2', discountType: 'fixed', value: 2000 },
          ],
        },
        { key: 'b', serviceId: 's2', basePrice: 5000, sales: [] },
      ],
      { promotionId: 'pc', code: 'X', discountType: 'percent', value: 10, minAmount: null, serviceIds: null },
    );
    expect(r.items[0]!.saleDiscount).toBe(2000);
    expect(r.items[0]!.salePromotionId).toBe('p2');
    expect(r.subtotal).toBe(13000);
    expect(r.promoDiscountTotal).toBe(1300);
    expect(r.total).toBe(11700);
    expect(r.items.reduce((s, i) => s + i.finalPrice, 0)).toBe(r.total);
  });

  it('promo limited to services and min amount', () => {
    const items = [
      { key: 'a', serviceId: 's1', basePrice: 4000, sales: [] },
      { key: 'b', serviceId: 's2', basePrice: 6000, sales: [] },
    ];
    const r = calculateVisitPrice(items, {
      promotionId: 'pc',
      code: 'X',
      discountType: 'fixed',
      value: 1000,
      minAmount: null,
      serviceIds: ['s2'],
    });
    expect(r.items[0]!.promoDiscount).toBe(0);
    expect(r.items[1]!.promoDiscount).toBe(1000);
    const r2 = calculateVisitPrice(items, {
      promotionId: 'pc',
      code: 'X',
      discountType: 'fixed',
      value: 1000,
      minAmount: 20000,
      serviceIds: null,
    });
    expect(r2.promoError).toBe('PROMO_MIN_AMOUNT');
    expect(r2.total).toBe(10000);
    const r3 = calculateVisitPrice(items, {
      promotionId: 'pc',
      code: 'X',
      discountType: 'fixed',
      value: 1000,
      minAmount: null,
      serviceIds: ['other'],
    });
    expect(r3.promoError).toBe('PROMO_NOT_APPLICABLE');
  });

  it('distributes promo with rounding remainder and never below zero', () => {
    const r = calculateVisitPrice(
      [
        { key: 'a', serviceId: 's1', basePrice: 333, sales: [] },
        { key: 'b', serviceId: 's2', basePrice: 333, sales: [] },
        { key: 'c', serviceId: 's3', basePrice: 334, sales: [] },
      ],
      { promotionId: 'pc', code: 'X', discountType: 'fixed', value: 100000, minAmount: null, serviceIds: null },
    );
    expect(r.total).toBe(0);
    expect(r.items.every((i) => i.finalPrice >= 0)).toBe(true);
  });

  it('validates promo rules', () => {
    const base = { isActive: true, startsAt: null, endsAt: null, branchIds: null, usageLimit: null, perClientLimit: null };
    const ctx = { now: d('2026-06-01T00:00:00Z'), branchId: 'b1', usedTotal: 0, usedByClient: 0 };
    expect(validatePromoRules(base, ctx)).toBeNull();
    expect(validatePromoRules({ ...base, isActive: false }, ctx)).toBe('PROMO_INACTIVE');
    expect(validatePromoRules({ ...base, startsAt: d('2026-07-01T00:00:00Z') }, ctx)).toBe('PROMO_NOT_STARTED');
    expect(validatePromoRules({ ...base, endsAt: d('2026-06-01T00:00:00Z') }, ctx)).toBe('PROMO_EXPIRED');
    expect(validatePromoRules({ ...base, branchIds: ['b2'] }, ctx)).toBe('PROMO_BRANCH_NOT_ALLOWED');
    expect(validatePromoRules({ ...base, usageLimit: 5 }, { ...ctx, usedTotal: 5 })).toBe('PROMO_USAGE_LIMIT');
    expect(validatePromoRules({ ...base, perClientLimit: 1 }, { ...ctx, usedByClient: 1 })).toBe('PROMO_CLIENT_LIMIT');
  });

  it('resolves price overrides', () => {
    expect(resolveServicePrice({ servicePrice: 100, branchPrice: null, specialistPrice: null, specialistPricingEnabled: true })).toBe(100);
    expect(resolveServicePrice({ servicePrice: 100, branchPrice: 120, specialistPrice: null, specialistPricingEnabled: true })).toBe(120);
    expect(resolveServicePrice({ servicePrice: 100, branchPrice: 120, specialistPrice: 150, specialistPricingEnabled: true })).toBe(150);
    expect(resolveServicePrice({ servicePrice: 100, branchPrice: 120, specialistPrice: 150, specialistPricingEnabled: false })).toBe(120);
  });
});

describe('subscription', () => {
  const sub = { suspended: false, startsAt: d('2026-01-01T00:00:00Z'), endsAt: d('2026-02-01T00:00:00Z'), graceDays: 7 };
  it('computes statuses over time', () => {
    expect(computeSubscriptionStatus(null, d('2026-01-10T00:00:00Z'))).toBe('expired');
    expect(computeSubscriptionStatus(sub, d('2025-12-31T00:00:00Z'))).toBe('expired');
    expect(computeSubscriptionStatus(sub, d('2026-01-10T00:00:00Z'))).toBe('active');
    expect(computeSubscriptionStatus(sub, d('2026-02-03T00:00:00Z'))).toBe('grace_period');
    expect(computeSubscriptionStatus(sub, d('2026-02-08T00:00:01Z'))).toBe('expired');
    expect(computeSubscriptionStatus({ ...sub, graceDays: 0 }, d('2026-02-01T00:00:00Z'))).toBe('expired');
    expect(computeSubscriptionStatus({ ...sub, suspended: true }, d('2026-01-10T00:00:00Z'))).toBe('suspended');
  });
  it('management allowed only when active or grace', () => {
    expect(isManagementAllowed('active')).toBe(true);
    expect(isManagementAllowed('grace_period')).toBe(true);
    expect(isManagementAllowed('expired')).toBe(false);
    expect(isManagementAllowed('suspended')).toBe(false);
  });
  it('public availability matrix', () => {
    const base = { moderationBlocked: false, hasPublication: true };
    expect(resolvePublicAvailability({ ...base, subscriptionStatus: 'active', pageStatus: 'active' })).toMatchObject({ bookingEnabled: true, mode: 'open' });
    expect(resolvePublicAvailability({ ...base, subscriptionStatus: 'grace_period', pageStatus: 'active' }).bookingEnabled).toBe(true);
    expect(resolvePublicAvailability({ ...base, subscriptionStatus: 'suspended', pageStatus: 'active' })).toMatchObject({ visible: true, bookingEnabled: false, reason: 'subscription_suspended' });
    expect(resolvePublicAvailability({ ...base, subscriptionStatus: 'expired', pageStatus: 'active' })).toMatchObject({ visible: false, reason: 'subscription_expired' });
    expect(resolvePublicAvailability({ ...base, subscriptionStatus: 'active', pageStatus: 'temporarily_closed' })).toMatchObject({ visible: true, bookingEnabled: false, mode: 'closed_notice' });
    expect(resolvePublicAvailability({ ...base, subscriptionStatus: 'active', pageStatus: 'disabled' })).toMatchObject({ visible: false, reason: 'page_disabled' });
    expect(resolvePublicAvailability({ ...base, moderationBlocked: true, subscriptionStatus: 'active', pageStatus: 'active' })).toMatchObject({ visible: false, reason: 'moderation_blocked' });
    expect(resolvePublicAvailability({ moderationBlocked: false, hasPublication: false, subscriptionStatus: 'active', pageStatus: 'active' }).visible).toBe(false);
  });
});

describe('appointment status transitions', () => {
  it('allows only defined transitions per actor', () => {
    expect(canTransition('pending_otp', 'confirmed', 'system')).toBe(true);
    expect(canTransition('pending_otp', 'confirmed', 'client')).toBe(false);
    expect(canTransition('confirmed', 'completed', 'admin')).toBe(true);
    expect(canTransition('confirmed', 'completed', 'client')).toBe(false);
    expect(canTransition('confirmed', 'cancelled_by_client', 'client')).toBe(true);
    expect(canTransition('cancelled_by_admin', 'confirmed', 'admin')).toBe(false);
    expect(canTransition('completed', 'no_show', 'admin')).toBe(false);
    expect(canTransition('no_show', 'completed', 'admin')).toBe(true);
    expect(canTransition('expired_otp', 'confirmed', 'system')).toBe(false);
  });
});

describe('phone', () => {
  it('normalizes KZ formats', () => {
    expect(normalizePhone('+7 (701) 123-45-67')).toBe('+77011234567');
    expect(normalizePhone('87011234567')).toBe('+77011234567');
    expect(normalizePhone('7011234567')).toBe('+77011234567');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizeKzMobile('+79161234567')).toBeNull();
    expect(normalizeKzMobile('+7 727 123 45 67')).toBeNull(); // городской Алматы
    expect(normalizeKzMobile('+7 747 123 45 67')).toBe('+77471234567');
    expect(normalizeKzMobile('+7 778 123 45 67')).toBe('+77781234567');
    expect(maskPhone('+77011234567')).toBe('+7701*****67');
  });
});

describe('permissions', () => {
  const admin = { role: 'BRANCH_ADMIN' as const, branchPermissions: { b1: ['appointments.view', 'appointments.manage'], b2: ['clients.view'] } };
  it('checks branch scoped permissions', () => {
    expect(hasPermission(admin, 'appointments.manage', 'b1')).toBe(true);
    expect(hasPermission(admin, 'appointments.manage', 'b2')).toBe(false);
    expect(hasPermission(admin, 'appointments.manage', 'b3')).toBe(false);
    expect(hasPermission(admin, 'users.manage')).toBe(false);
    expect(hasPermission(admin, 'clients.view')).toBe(true);
    expect(hasPermission({ role: 'OWNER', branchPermissions: {} }, 'users.manage')).toBe(true);
    expect(branchesWithPermission(admin, 'appointments.view')).toEqual(['b1']);
    expect(branchesWithPermission({ role: 'OWNER', branchPermissions: {} }, 'appointments.view')).toBeNull();
  });
});

describe('text helpers', () => {
  it('slugifies cyrillic and kazakh', () => {
    expect(slugify('Салон «Әсем» Алматы')).toBe('salon-asem-almaty');
    expect(slugify('   ')).toBe('branch');
  });
  it('detects social platforms', () => {
    expect(detectSocialPlatform('https://www.instagram.com/salon')?.platform).toBe('instagram');
    expect(detectSocialPlatform('https://wa.me/77011234567')?.platform).toBe('whatsapp');
    expect(detectSocialPlatform('https://t.me/salon')?.platform).toBe('telegram');
    expect(detectSocialPlatform('https://example.kz')).toBeNull();
    expect(detectSocialPlatform('javascript:alert(1)')).toBeNull();
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('schemas', () => {
  it('normalizes phone in hold schema and requires consent', () => {
    const ok = CreateHoldSchema.parse({
      startAt: '2026-06-01T10:00:00+05:00',
      items: [{ serviceId: '0b6c4b8e-2a4f-4f7f-9b8a-3c1d2e3f4a5b' }],
      client: { name: 'Айгерим', phone: '8 701 123 45 67' },
      consents: { personalData: true },
    });
    expect(ok.client.phone).toBe('+77011234567');
    expect(() =>
      CreateHoldSchema.parse({
        startAt: '2026-06-01T10:00:00+05:00',
        items: [{ serviceId: '0b6c4b8e-2a4f-4f7f-9b8a-3c1d2e3f4a5b' }],
        client: { name: 'A', phone: '87011234567' },
        consents: { personalData: false },
      }),
    ).toThrow();
  });
  it('honeypot must be empty', () => {
    expect(
      CreateHoldSchema.safeParse({
        startAt: '2026-06-01T10:00:00+05:00',
        items: [{ serviceId: '0b6c4b8e-2a4f-4f7f-9b8a-3c1d2e3f4a5b' }],
        client: { name: 'A', phone: '87011234567' },
        consents: { personalData: true },
        website: 'spam',
      }).success,
    ).toBe(false);
  });
  it('promotion requires code for promo_code and percent <= 100', () => {
    expect(PromotionInputSchema.safeParse({ kind: 'promo_code', name: 'x', discountType: 'percent', discountValue: 10 }).success).toBe(false);
    expect(PromotionInputSchema.safeParse({ kind: 'promo_code', name: 'x', code: 'spring', discountType: 'percent', discountValue: 110 }).success).toBe(false);
    const p = PromotionInputSchema.parse({ kind: 'promo_code', name: 'x', code: 'spring', discountType: 'percent', discountValue: 10 });
    expect(p.code).toBe('SPRING');
  });
  it('rejects inverted working intervals', () => {
    expect(
      WeeklyScheduleSchema.safeParse({ resourceId: null, days: [{ weekday: 1, intervals: [{ start: '18:00', end: '09:00' }] }] })
        .success,
    ).toBe(false);
  });
});
