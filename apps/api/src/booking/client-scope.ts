import type { PrismaService, Tx } from '../common/prisma.service';
import type { Prisma } from '../generated/prisma/client';

/**
 * Связь «платформенный профиль ↔ карточки клиента в организациях» по номеру телефона (§10, §18.1).
 *
 * Номер у профиля сотрудника или владельца задаётся без подтверждения кодом, поэтому одно совпадение номера
 * не доказывает владение им. По номеру ищутся и привязываются карточки только для профиля с подтверждённым
 * номером (`phoneVerifiedAt`); карточки, уже привязанные к профилю (`client.userId`), доступны всегда.
 */
export async function verifiedPhoneOf(db: Tx | PrismaService, userId: string): Promise<string | null> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { phone: true, phoneVerifiedAt: true } });
  return u?.phone && u.phoneVerifiedAt ? u.phone : null;
}

/** Условие «карточки клиента текущего пользователя» для кабинета /me. */
export async function ownClientsWhere(db: Tx | PrismaService, userId: string): Promise<Prisma.ClientWhereInput> {
  const phone = await verifiedPhoneOf(db, userId);
  return { OR: [{ userId }, ...(phone ? [{ phone, userId: null }] : [])] };
}

/** Профиль, к которому можно привязать карточку с этим номером: только с подтверждённым номером. */
export async function verifiedUserIdByPhone(db: Tx | PrismaService, phone: string): Promise<string | null> {
  const u = await db.user.findUnique({ where: { phone }, select: { id: true, phoneVerifiedAt: true } });
  return u?.phoneVerifiedAt ? u.id : null;
}
