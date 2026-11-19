import type { DiscountType } from './enums';

/** Все суммы — целые тенге (решение D-22). */

export interface Discount {
  discountType: DiscountType;
  /** Процент (1..100) или фиксированная сумма в тенге. */
  value: number;
}

export interface SaleOffer extends Discount {
  promotionId: string;
}

export interface PriceItemInput {
  key: string;
  serviceId: string;
  /** Цена после выбора: цена специалиста ?? цена филиала ?? базовая цена услуги. */
  basePrice: number;
  /** Уже отфильтрованные по сроку/филиалу/услуге действующие акции. */
  sales: readonly SaleOffer[];
}

export interface PromoCodeInput extends Discount {
  promotionId: string;
  code: string;
  minAmount: number | null;
  /** null = на все услуги. */
  serviceIds: readonly string[] | null;
}

export interface PricedItem {
  key: string;
  serviceId: string;
  basePrice: number;
  saleDiscount: number;
  salePromotionId: string | null;
  promoDiscount: number;
  finalPrice: number;
}

export interface PriceResult {
  items: PricedItem[];
  /** Сумма базовых цен. */
  baseTotal: number;
  /** Сумма после акций (до промокода). */
  subtotal: number;
  saleDiscountTotal: number;
  promoDiscountTotal: number;
  total: number;
  promoError: PromoError | null;
}

export type PromoError = 'PROMO_MIN_AMOUNT' | 'PROMO_NOT_APPLICABLE';

export function applyDiscount(amount: number, d: Discount): number {
  if (amount <= 0) return 0;
  const raw = d.discountType === 'percent' ? Math.round((amount * Math.min(Math.max(d.value, 0), 100)) / 100) : d.value;
  return Math.min(Math.max(Math.round(raw), 0), amount);
}

/**
 * Расчёт стоимости визита (D-14):
 * 1) к каждой услуге применяется одна лучшая акция;
 * 2) промокод применяется к сумме подходящих услуг после акций и распределяется по позициям пропорционально;
 * 3) итог не меньше 0.
 * Если промокод неприменим, цена считается без него и возвращается promoError.
 */
export function calculateVisitPrice(items: readonly PriceItemInput[], promo?: PromoCodeInput | null): PriceResult {
  const priced: PricedItem[] = items.map((it) => {
    let best = 0;
    let bestId: string | null = null;
    for (const s of it.sales) {
      const d = applyDiscount(it.basePrice, s);
      if (d > best) {
        best = d;
        bestId = s.promotionId;
      }
    }
    return {
      key: it.key,
      serviceId: it.serviceId,
      basePrice: it.basePrice,
      saleDiscount: best,
      salePromotionId: bestId,
      promoDiscount: 0,
      finalPrice: it.basePrice - best,
    };
  });

  const baseTotal = priced.reduce((s, i) => s + i.basePrice, 0);
  const subtotal = priced.reduce((s, i) => s + i.finalPrice, 0);
  let promoError: PromoError | null = null;

  if (promo) {
    const eligible = priced.filter((i) => promo.serviceIds === null || promo.serviceIds.includes(i.serviceId));
    const eligibleSum = eligible.reduce((s, i) => s + i.finalPrice, 0);
    if (eligible.length === 0 || eligibleSum === 0) {
      promoError = 'PROMO_NOT_APPLICABLE';
    } else if (promo.minAmount !== null && subtotal < promo.minAmount) {
      promoError = 'PROMO_MIN_AMOUNT';
    } else {
      const totalDiscount = applyDiscount(eligibleSum, promo);
      // Пропорциональное распределение; остаток от округления — на последнюю позицию.
      let distributed = 0;
      eligible.forEach((item, idx) => {
        const share =
          idx === eligible.length - 1
            ? totalDiscount - distributed
            : Math.floor((totalDiscount * item.finalPrice) / eligibleSum);
        const applied = Math.min(share, item.finalPrice);
        item.promoDiscount = applied;
        item.finalPrice -= applied;
        distributed += applied;
      });
    }
  }

  const saleDiscountTotal = priced.reduce((s, i) => s + i.saleDiscount, 0);
  const promoDiscountTotal = priced.reduce((s, i) => s + i.promoDiscount, 0);
  const total = priced.reduce((s, i) => s + i.finalPrice, 0);
  return { items: priced, baseTotal, subtotal, saleDiscountTotal, promoDiscountTotal, total, promoError };
}

export interface PromoRules {
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  branchIds: readonly string[] | null;
  usageLimit: number | null;
  perClientLimit: number | null;
}

export type PromoValidationError =
  | 'PROMO_INACTIVE'
  | 'PROMO_NOT_STARTED'
  | 'PROMO_EXPIRED'
  | 'PROMO_BRANCH_NOT_ALLOWED'
  | 'PROMO_USAGE_LIMIT'
  | 'PROMO_CLIENT_LIMIT';

/** Проверка правил промокода (без суммы). Счётчики использований передаются из БД. */
export function validatePromoRules(
  promo: PromoRules,
  ctx: { now: Date; branchId: string; usedTotal: number; usedByClient: number },
): PromoValidationError | null {
  if (!promo.isActive) return 'PROMO_INACTIVE';
  if (promo.startsAt && ctx.now < promo.startsAt) return 'PROMO_NOT_STARTED';
  if (promo.endsAt && ctx.now >= promo.endsAt) return 'PROMO_EXPIRED';
  if (promo.branchIds && !promo.branchIds.includes(ctx.branchId)) return 'PROMO_BRANCH_NOT_ALLOWED';
  if (promo.usageLimit !== null && ctx.usedTotal >= promo.usageLimit) return 'PROMO_USAGE_LIMIT';
  if (promo.perClientLimit !== null && ctx.usedByClient >= promo.perClientLimit) return 'PROMO_CLIENT_LIMIT';
  return null;
}

/** Цена услуги с учётом переопределений (ТЗ §5). */
export function resolveServicePrice(args: {
  servicePrice: number;
  branchPrice: number | null;
  specialistPrice: number | null;
  specialistPricingEnabled: boolean;
}): number {
  if (args.specialistPricingEnabled && args.specialistPrice !== null) return args.specialistPrice;
  if (args.branchPrice !== null) return args.branchPrice;
  return args.servicePrice;
}
