import type { PageStatus, SubscriptionStatus } from './enums';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionState {
  suspended: boolean;
  startsAt: Date;
  endsAt: Date;
  graceDays: number;
}

/** Эффективный статус подписки (ТЗ §2.3). Подписка, которая ещё не началась, считается expired. */
export function computeSubscriptionStatus(sub: SubscriptionState | null, now: Date): SubscriptionStatus {
  if (!sub) return 'expired';
  if (sub.suspended) return 'suspended';
  if (now < sub.startsAt) return 'expired';
  if (now < sub.endsAt) return 'active';
  if (sub.graceDays > 0 && now.getTime() < sub.endsAt.getTime() + sub.graceDays * DAY_MS) return 'grace_period';
  return 'expired';
}

export function graceEndsAt(sub: SubscriptionState): Date {
  return new Date(sub.endsAt.getTime() + sub.graceDays * DAY_MS);
}

/** Разрешены ли изменяющие операции владельцу/админу (решение D-12). */
export function isManagementAllowed(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'grace_period';
}

export type PublicUnavailableReason =
  | 'page_disabled'
  | 'moderation_blocked'
  | 'subscription_expired'
  | 'subscription_suspended'
  | 'page_temporarily_closed';

export interface PublicAvailability {
  /** Показывать ли страницу вообще. false → 404 для посетителя. */
  visible: boolean;
  /** Можно ли создать запись. */
  bookingEnabled: boolean;
  /** Режим отображения. */
  mode: 'open' | 'closed_notice' | 'hidden';
  reason: PublicUnavailableReason | null;
}

/**
 * Итоговая доступность публичной страницы (ТЗ §2.4, решение D-13).
 * Порядок проверок важен: сначала полное скрытие, затем ограничения записи.
 */
export function resolvePublicAvailability(args: {
  subscriptionStatus: SubscriptionStatus;
  pageStatus: PageStatus;
  moderationBlocked: boolean;
  hasPublication: boolean;
}): PublicAvailability {
  const hidden = (reason: PublicUnavailableReason): PublicAvailability => ({
    visible: false,
    bookingEnabled: false,
    mode: 'hidden',
    reason,
  });
  const notice = (reason: PublicUnavailableReason): PublicAvailability => ({
    visible: true,
    bookingEnabled: false,
    mode: 'closed_notice',
    reason,
  });

  if (args.pageStatus === 'disabled' || !args.hasPublication) return hidden('page_disabled');
  if (args.moderationBlocked) return hidden('moderation_blocked');
  if (args.subscriptionStatus === 'expired') return hidden('subscription_expired');
  if (args.subscriptionStatus === 'suspended') return notice('subscription_suspended');
  if (args.pageStatus === 'temporarily_closed') return notice('page_temporarily_closed');
  return { visible: true, bookingEnabled: true, mode: 'open', reason: null };
}
