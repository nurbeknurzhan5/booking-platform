import type { AppointmentStatus } from './enums';

export type StatusActor = 'system' | 'client' | 'admin';

interface Transition {
  from: AppointmentStatus;
  to: AppointmentStatus;
  actors: readonly StatusActor[];
}

/** Разрешённые переходы статусов записи (ТЗ §8.2, решение D-15). */
export const APPOINTMENT_TRANSITIONS: readonly Transition[] = [
  { from: 'pending_otp', to: 'confirmed', actors: ['system'] },
  { from: 'pending_otp', to: 'expired_otp', actors: ['system'] },
  { from: 'pending_otp', to: 'cancelled_by_client', actors: ['client'] },
  { from: 'confirmed', to: 'completed', actors: ['admin'] },
  { from: 'confirmed', to: 'no_show', actors: ['admin'] },
  { from: 'confirmed', to: 'cancelled_by_client', actors: ['client'] },
  { from: 'confirmed', to: 'cancelled_by_admin', actors: ['admin'] },
  { from: 'no_show', to: 'completed', actors: ['admin'] },
];

export function canTransition(from: AppointmentStatus, to: AppointmentStatus, actor: StatusActor): boolean {
  return APPOINTMENT_TRANSITIONS.some((t) => t.from === from && t.to === to && t.actors.includes(actor));
}

/** Статусы, при которых запись занимает ресурсы. */
export const OCCUPYING_STATUSES: readonly AppointmentStatus[] = ['pending_otp', 'confirmed', 'completed', 'no_show'];

/** Активная запись — будущая или ожидающая (для лимитов клиента). */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['pending_otp', 'confirmed'];

export function isOccupying(status: AppointmentStatus): boolean {
  return OCCUPYING_STATUSES.includes(status);
}

/** Окно исправления no_show → completed (D-15). */
export const NO_SHOW_CORRECTION_WINDOW_HOURS = 24;
