import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { UpdateClientSchema, type Permission } from '@booking/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { AuditService } from '../common/audit.service';
import { allowedBranches } from '../common/tenant-access';
import type { ActorContext, TenantContext } from '../common/request-context';
import { Prisma } from '../generated/prisma/client';

const ANON_NAME = 'Удалённый клиент';
/** Поля карточки клиента с ПД: при обезличивании стираются и в журналах. */
const CLIENT_PII_KEYS: ReadonlySet<string> = new Set(['name', 'phone', 'notes', 'authorName', 'clientName']);

const anonPhone = (clientId: string) => `anon-${clientId.slice(0, 10)}`;

interface PiiScrub {
  clientIds: Set<string>;
  phones: string[];
  anon: string;
}

/** Строка без номеров обезличиваемого клиента (E.164 и только цифры). */
function scrubString(v: string, s: PiiScrub): string {
  let out = v;
  for (const p of s.phones) out = out.split(p).join(s.anon).split(p.replace(/^\+/, '')).join(s.anon);
  return out;
}

/**
 * Стирает ПД клиента в JSON журнала: объекты карточки (по id клиента или его номеру) теряют имя, телефон,
 * заметки; номера в любых строках заменяются. Остальное (id, суммы, даты) сохраняется.
 */
function scrubJson(value: unknown, s: PiiScrub, isClientObject = false): unknown {
  if (typeof value === 'string') return scrubString(value, s);
  if (Array.isArray(value)) return value.map((v) => scrubJson(v, s));
  if (value === null || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const own =
    isClientObject || (typeof obj.id === 'string' && s.clientIds.has(obj.id)) || (typeof obj.phone === 'string' && s.phones.includes(obj.phone));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (own && CLIENT_PII_KEYS.has(k)) out[k] = k === 'phone' ? s.anon : k === 'notes' ? null : ANON_NAME;
    else out[k] = scrubJson(v, s);
  }
  return out;
}

/** Клиенты организации (§11). Администратор видит клиентов, у которых есть записи в его филиалах. */
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private scope(t: TenantContext, permission: Permission = 'clients.view'): Prisma.ClientWhereInput {
    const allowed = allowedBranches(t, permission);
    return {
      organizationId: t.organizationId,
      mergedIntoId: null,
      ...(allowed ? { appointments: { some: { branchId: { in: allowed } } } } : {}),
    };
  }

  private async stats(organizationId: string, clientIds: string[], branchIds: string[] | null) {
    if (!clientIds.length) return new Map<string, { visits: number; cancellations: number; noShows: number; lastVisitAt: Date | null }>();
    const rows = await this.prisma.appointment.groupBy({
      by: ['clientId', 'status'],
      where: { organizationId, clientId: { in: clientIds }, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
      _count: { _all: true },
      _max: { startAt: true },
    });
    const out = new Map<string, { visits: number; cancellations: number; noShows: number; lastVisitAt: Date | null }>();
    for (const id of clientIds) out.set(id, { visits: 0, cancellations: 0, noShows: 0, lastVisitAt: null });
    for (const r of rows) {
      const s = out.get(r.clientId)!;
      if (r.status === 'completed') {
        s.visits += r._count._all;
        if (r._max.startAt && (!s.lastVisitAt || r._max.startAt > s.lastVisitAt)) s.lastVisitAt = r._max.startAt;
      }
      if (r.status === 'cancelled_by_client' || r.status === 'cancelled_by_admin') s.cancellations += r._count._all;
      if (r.status === 'no_show') s.noShows += r._count._all;
    }
    return out;
  }

  async list(t: TenantContext, q: { search?: string; page: number; pageSize: number }) {
    const s = q.search?.trim();
    const digits = s?.replace(/\D/g, '');
    const where: Prisma.ClientWhereInput = {
      ...this.scope(t),
      anonymizedAt: null,
      ...(s
        ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, ...(digits && digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.client.count({ where }),
      this.prisma.client.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const stats = await this.stats(t.organizationId, rows.map((r) => r.id), allowedBranches(t, 'clients.view'));
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((c) => ({ id: c.id, name: c.name, phone: c.phone, locale: c.locale, registered: !!c.userId, createdAt: c.createdAt, ...stats.get(c.id) })),
    };
  }

  async card(t: TenantContext, id: string) {
    const c = await this.prisma.client.findFirst({ where: { id, ...this.scope(t) } });
    if (!c) throw AppError.notFound('Клиент');
    const branches = allowedBranches(t, 'clients.view');
    const [appointments, reviews, consents, stats] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { clientId: id, organizationId: t.organizationId, ...(branches ? { branchId: { in: branches } } : {}) },
        orderBy: { startAt: 'desc' },
        take: 200,
        include: { items: { select: { serviceNameSnapshot: true, specialistNameSnapshot: true, finalPrice: true } }, branch: { select: { id: true, name: true } } },
      }),
      // Отзывы — как и записи — только по филиалам, доступным сотруднику (администратор филиала не видит чужие).
      this.prisma.review.findMany({
        where: { clientId: id, organizationId: t.organizationId, ...(branches ? { branchId: { in: branches } } : {}) },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.clientConsent.findMany({ where: { phone: c.phone, OR: [{ organizationId: t.organizationId }, { organizationId: null }] }, orderBy: { createdAt: 'desc' } }),
      this.stats(t.organizationId, [id], branches),
    ]);
    const latest: Record<string, { granted: boolean; at: Date }> = {};
    for (const cs of consents) if (!latest[cs.consentType]) latest[cs.consentType] = { granted: cs.granted, at: cs.createdAt };
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      locale: c.locale,
      notes: c.notes,
      registered: !!c.userId,
      createdAt: c.createdAt,
      anonymized: !!c.anonymizedAt,
      stats: stats.get(id),
      consents: latest,
      appointments,
      reviews,
    };
  }

  async update(t: TenantContext, id: string, input: z.infer<typeof UpdateClientSchema>, actor: ActorContext) {
    // Право маршрута — appointments.manage: карточка должна относиться к филиалу, где оно есть.
    const before = await this.prisma.client.findFirst({ where: { id, anonymizedAt: null, ...this.scope(t, 'appointments.manage') } });
    if (!before) throw AppError.notFound('Клиент');
    const after = await this.prisma.client.update({ where: { id }, data: input });
    // В аудит — только изменённые поля (без служебных полей карточки).
    const keys = Object.keys(input) as Array<keyof typeof input & keyof typeof before>;
    const pick = (row: typeof before) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
    await this.audit.log(actor, 'client.updated', 'client', id, { before: pick(before), after: pick(after) });
    return after;
  }

  /** Объединение дублей с сохранением истории записей и аудита (§11). Только владелец. */
  async merge(t: TenantContext, sourceId: string, targetId: string, actor: ActorContext) {
    if (sourceId === targetId) throw AppError.badRequest('VALIDATION_ERROR', 'Нельзя объединить клиента с самим собой');
    const [source, target] = await Promise.all([
      this.prisma.client.findFirst({ where: { id: sourceId, organizationId: t.organizationId, mergedIntoId: null } }),
      this.prisma.client.findFirst({ where: { id: targetId, organizationId: t.organizationId, mergedIntoId: null } }),
    ]);
    if (!source || !target) throw AppError.notFound('Клиент');
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.appointment.updateMany({ where: { clientId: sourceId, organizationId: t.organizationId }, data: { clientId: targetId } });
      await tx.review.updateMany({ where: { clientId: sourceId, organizationId: t.organizationId }, data: { clientId: targetId } });
      await tx.promotionRedemption.updateMany({ where: { clientId: sourceId, organizationId: t.organizationId }, data: { clientId: targetId } });
      await tx.waitlistEntry.updateMany({ where: { clientId: sourceId, organizationId: t.organizationId }, data: { clientId: targetId } });
      await tx.client.update({ where: { id: sourceId }, data: { mergedIntoId: targetId } });
      if (!target.userId && source.userId) await tx.client.update({ where: { id: targetId }, data: { userId: source.userId } });
      await this.audit.log(actor, 'client.merged', 'client', targetId, {
        before: { source: { id: source.id, name: source.name, phone: source.phone }, target: { id: target.id, name: target.name, phone: target.phone } },
        after: { movedAppointments: moved.count },
      }, tx);
      return { targetId, movedAppointments: moved.count };
    });
  }

  /** Карточка и все дубли, объединённые в неё (в т.ч. по цепочке): это один и тот же человек. */
  private async mergedChain(db: Tx | PrismaService, organizationId: string, id: string): Promise<string[]> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE chain AS (
        SELECT id FROM clients WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid
        UNION
        SELECT c.id FROM clients c JOIN chain ON c.merged_into_id = chain.id WHERE c.organization_id = ${organizationId}::uuid
      ) SELECT id::text AS id FROM chain`;
    return rows.map((r) => r.id);
  }

  /**
   * Обезличивание по запросу субъекта персональных данных (§22). История визитов сохраняется без ПД.
   * В одной транзакции стираются ПД карточки и её дублей и все их следы в данных организации:
   * отзывы (имя автора), комментарии к записям, резервы, коды подтверждения записей, журнал уведомлений
   * (получатель, параметры, ключ дедупликации, статусы WhatsApp), «тестовый телефон», журнал аудита и
   * согласия организации (номер и IP маскируются, факт согласия остаётся). Исключения — docs/SECURITY.md.
   */
  async anonymize(t: TenantContext, id: string, actor: ActorContext) {
    const organizationId = t.organizationId;
    const c = await this.prisma.client.findFirst({ where: { id, organizationId, mergedIntoId: null, anonymizedAt: null } });
    if (!c) throw AppError.notFound('Клиент');
    const clientIds = await this.mergedChain(this.prisma, organizationId, id);
    const active = await this.prisma.appointment.count({
      where: { organizationId, clientId: { in: clientIds }, status: { in: ['pending_otp', 'confirmed'] }, endAt: { gt: new Date() } },
    });
    if (active > 0) throw AppError.conflict('У клиента есть активные записи — сначала отмените их');

    await this.prisma.$transaction(
      async (tx) => {
        // Разрешает стирание ПД в append-only журналах (аудит, согласия) только в этой транзакции (миграция pii_erasure).
        await tx.$queryRaw`SELECT set_config('app.pii_erasure', 'on', true)`;
        const clients = await tx.$queryRaw<Array<{ id: string; phone: string }>>`
          SELECT id::text AS id, phone FROM clients
          WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(clientIds.map((x) => Prisma.sql`${x}::uuid`))})
          FOR UPDATE`;
        const phones = [...new Set(clients.map((x) => x.phone).filter((p) => !p.startsWith('anon-')))];
        const scrub: PiiScrub = { clientIds: new Set(clientIds), phones, anon: anonPhone(id) };
        const now = new Date();

        for (const x of clients) {
          await tx.client.update({
            where: { id: x.id },
            data: { name: ANON_NAME, phone: anonPhone(x.id), notes: null, userId: null, anonymizedAt: now },
          });
        }
        await tx.review.updateMany({ where: { organizationId, clientId: { in: clientIds } }, data: { authorName: ANON_NAME } });
        // Лист ожидания: заявки и действующие предложения обезличенного клиента аннулируются (ПД заявки — в карточке).
        await tx.waitlistOffer.updateMany({ where: { organizationId, entry: { clientId: { in: clientIds } }, status: 'pending' }, data: { status: 'cancelled' } });
        await tx.waitlistEntry.updateMany({
          where: { organizationId, clientId: { in: clientIds }, status: { in: ['pending_otp', 'waiting', 'offered'] } },
          data: { status: 'cancelled', cancelledAt: now, tokenHash: null, offeredAt: null, offerExpiresAt: null },
        });

        const appointmentIds = (await tx.appointment.findMany({ where: { organizationId, clientId: { in: clientIds } }, select: { id: true } })).map((a) => a.id);
        // Комментарий к записи пишет клиент — свободный текст может содержать ПД.
        await tx.appointment.updateMany({ where: { organizationId, id: { in: appointmentIds }, comment: { not: null } }, data: { comment: null } });
        await tx.bookingHold.updateMany({
          where: { organizationId, OR: [{ appointmentId: { in: appointmentIds } }, ...(phones.length ? [{ phone: { in: phones } }] : [])] },
          data: { phone: scrub.anon, ip: null },
        });
        // Коды и ссылки подтверждения записей этой организации (активных записей нет — коды не нужны).
        if (appointmentIds.length) await tx.otpCode.deleteMany({ where: { appointmentId: { in: appointmentIds } } });

        const outbox = await tx.notificationOutbox.findMany({
          where: {
            organizationId,
            OR: [
              { clientId: { in: clientIds } },
              ...(appointmentIds.length ? [{ appointmentId: { in: appointmentIds } }] : []),
              ...(phones.length ? [{ recipient: { in: phones } }] : []),
            ],
          },
          select: { id: true, channel: true, providerMessageId: true },
        });
        if (outbox.length) {
          const outboxIds = outbox.map((o) => o.id);
          // «Тестовый телефон»: сообщения этой организации находятся по id доставки (dev-<id>).
          const devIds = outbox
            .map((o) => (o.channel === 'dev_inbox' ? /^dev-([0-9a-f-]{36})$/i.exec(o.providerMessageId ?? '')?.[1] : undefined))
            .filter((x): x is string => !!x);
          if (devIds.length) await tx.devInboxMessage.deleteMany({ where: { id: { in: devIds } } });
          await tx.whatsappMessageStatus.updateMany({ where: { outboxId: { in: outboxIds } }, data: { raw: {} } });
          // Неотправленные и DLQ (dead, в т.ч. с зашифрованными параметрами до повтора) больше не отправляются:
          // параметры стёрты, повтор из DLQ невозможен.
          await tx.notificationOutbox.updateMany({ where: { id: { in: outboxIds }, status: { in: ['pending', 'failed', 'dead'] } }, data: { status: 'cancelled' } });
          // Ключ дедупликации содержит номер получателя: заменяется уникальным обезличенным.
          await tx.$executeRaw`
            UPDATE notification_outbox
            SET recipient = ${scrub.anon}, payload = '{}'::jsonb, payload_encrypted = false,
                dedupe_key = 'anon:' || id::text, updated_at = now()
            WHERE id IN (${Prisma.join(outboxIds.map((x) => Prisma.sql`${x}::uuid`))})`;
        }

        // Согласия этой организации: факт, тип, версия текста и время остаются (основание обработки в прошлом),
        // номер и IP маскируются. Общие согласия платформы (organization_id IS NULL, «СТОП») не затрагиваются.
        await tx.clientConsent.updateMany({
          where: { organizationId, OR: [{ clientId: { in: clientIds } }, ...(phones.length ? [{ phone: { in: phones } }] : [])] },
          data: { phone: scrub.anon, ip: null },
        });

        await this.scrubAudit(tx, organizationId, scrub);
        await this.audit.log(actor, 'client.anonymized', 'client', id, { before: { id }, after: { mergedClients: clientIds.length - 1 } }, tx);
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  /** Журнал аудита организации: стирание имени, телефона и заметок клиента в before/after. */
  private async scrubAudit(tx: Tx, organizationId: string, scrub: PiiScrub): Promise<void> {
    const ids = [...scrub.clientIds];
    const needles = [...ids, ...scrub.phones].map((n) => `%${n}%`);
    const rows = await tx.$queryRaw<Array<{ id: string; entity_type: string; entity_id: string | null; before: unknown; after: unknown }>>`
      SELECT id::text AS id, entity_type, entity_id, before, after FROM audit_logs
      WHERE organization_id = ${organizationId}::uuid
        AND ((entity_type = 'client' AND entity_id IN (${Prisma.join(ids)}))
          OR before::text LIKE ANY (${needles}::text[])
          OR after::text LIKE ANY (${needles}::text[]))`;
    for (const r of rows) {
      const isClient = r.entity_type === 'client' && r.entity_id !== null && scrub.clientIds.has(r.entity_id);
      const before = r.before === null ? null : scrubJson(r.before, scrub, isClient);
      const after = r.after === null ? null : scrubJson(r.after, scrub, isClient);
      if (JSON.stringify(before) === JSON.stringify(r.before) && JSON.stringify(after) === JSON.stringify(r.after)) continue;
      await tx.$executeRaw`
        UPDATE audit_logs
        SET before = ${before === null ? null : JSON.stringify(before)}::jsonb, after = ${after === null ? null : JSON.stringify(after)}::jsonb
        WHERE id = ${r.id}::uuid`;
    }
  }
}
