import { Injectable } from '@nestjs/common';
import { isbot } from 'isbot';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { AnalyticsEventSchema } from '@booking/shared';
import { PrismaService } from '../common/prisma.service';
import { hmacSha256 } from '../common/crypto';
import { getConfig } from '../config/config';
import { AppError } from '../common/errors';
import type { AuthUser } from '../common/request-context';

type EventInput = z.infer<typeof AnalyticsEventSchema>;

/**
 * Аналитика публичной страницы и записей (§17). Правила — docs/ANALYTICS.md:
 * • уникальный посетитель — дневной HMAC(IP, User-Agent, филиал) без cookies;
 * • боты (User-Agent) и внутренние просмотры (сотрудники организации, предпросмотр) исключаются;
 * • источник — utm_source, иначе домен referrer, иначе «direct».
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  visitorHash(ip: string, userAgent: string, branchId: string, day: string): string {
    return hmacSha256(getConfig().ANALYTICS_SECRET, `${day}|${ip}|${userAgent}|${branchId}`);
  }

  async record(input: EventInput, ctx: { ip: string; userAgent: string; user?: AuthUser; host?: string }): Promise<void> {
    const branch = await this.prisma.branch.findFirst({ where: { slug: input.slug, archivedAt: null }, select: { id: true, organizationId: true, timezone: true } });
    if (!branch) throw AppError.notFound('Страница');
    const day = DateTime.now().setZone(branch.timezone).toISODate()!;

    let isInternal = (input.path ?? '').includes('preview=');
    if (ctx.user && ctx.user.sessionKind === 'staff') {
      if (ctx.user.isSuperadmin) isInternal = true;
      else {
        const m = await this.prisma.userOrganizationRole.count({ where: { userId: ctx.user.id, organizationId: branch.organizationId, revokedAt: null } });
        if (m > 0) isInternal = true;
      }
    }
    let referrerHost: string | null = null;
    if (input.referrer) {
      try {
        const h = new URL(input.referrer).hostname.toLowerCase().replace(/^www\./, '');
        if (!ctx.host || h !== ctx.host.replace(/^www\./, '').split(':')[0]) referrerHost = h.slice(0, 200);
      } catch {
        /* некорректный referrer игнорируется */
      }
    }
    await this.prisma.analyticsEvent.create({
      data: {
        organizationId: branch.organizationId,
        branchId: branch.id,
        type: input.type,
        visitorHash: this.visitorHash(ctx.ip, ctx.userAgent, branch.id, day),
        sessionId: input.sessionId,
        utmSource: input.utm?.source?.toLowerCase() ?? null,
        utmMedium: input.utm?.medium?.toLowerCase() ?? null,
        utmCampaign: input.utm?.campaign ?? null,
        utmTerm: input.utm?.term ?? null,
        utmContent: input.utm?.content ?? null,
        referrerHost,
        isBot: !ctx.userAgent || isbot(ctx.userAgent),
        isInternal,
        serviceIds: input.serviceIds ?? [],
      },
    });
  }

  /** Пересчёт дневных агрегатов за период (идемпотентно, upsert). День — локальный для филиала. */
  async aggregate(from: Date, to: Date, branchId?: string): Promise<number> {
    return this.prisma.$executeRaw`
      WITH ev AS (
        SELECT e.*, (e.occurred_at AT TIME ZONE b.timezone)::date AS d,
               COALESCE(e.utm_source, e.referrer_host, 'direct') AS src
        FROM analytics_events e JOIN branches b ON b.id = e.branch_id
        WHERE NOT e.is_bot AND NOT e.is_internal
          AND e.occurred_at >= ${from} AND e.occurred_at < ${to}
          AND (${branchId ?? null}::uuid IS NULL OR e.branch_id = ${branchId ?? null}::uuid)
      ),
      src AS (
        SELECT branch_id, d, src,
               count(*) FILTER (WHERE type = 'page_view') AS views,
               count(DISTINCT visitor_hash) FILTER (WHERE type = 'page_view') AS uniques,
               count(*) FILTER (WHERE type = 'booking_completed') AS bookings
        FROM ev GROUP BY 1, 2, 3
      ),
      src_json AS (
        SELECT branch_id, d, jsonb_object_agg(src, jsonb_build_object('views', views, 'uniques', uniques, 'bookings', bookings)) AS sources
        FROM src GROUP BY 1, 2
      ),
      agg AS (
        SELECT organization_id, branch_id, d,
               count(*) FILTER (WHERE type = 'page_view') AS page_views,
               count(DISTINCT visitor_hash) FILTER (WHERE type = 'page_view') AS unique_visitors,
               count(*) FILTER (WHERE type = 'booking_click') AS booking_clicks,
               count(*) FILTER (WHERE type = 'booking_started') AS booking_starts,
               count(*) FILTER (WHERE type = 'booking_completed') AS bookings_created,
               count(*) FILTER (WHERE type = 'booking_cancelled') AS cancellations
        FROM ev GROUP BY 1, 2, 3
      )
      INSERT INTO analytics_daily_aggregates
        (organization_id, branch_id, date, page_views, unique_visitors, booking_clicks, booking_starts, bookings_created, cancellations, sources, updated_at)
      SELECT a.organization_id, a.branch_id, a.d, a.page_views, a.unique_visitors, a.booking_clicks, a.booking_starts, a.bookings_created, a.cancellations,
             COALESCE(s.sources, '{}'::jsonb), now()
      FROM agg a LEFT JOIN src_json s ON s.branch_id = a.branch_id AND s.d = a.d
      ON CONFLICT (branch_id, date) DO UPDATE SET
        page_views = EXCLUDED.page_views, unique_visitors = EXCLUDED.unique_visitors, booking_clicks = EXCLUDED.booking_clicks,
        booking_starts = EXCLUDED.booking_starts, bookings_created = EXCLUDED.bookings_created, cancellations = EXCLUDED.cancellations,
        sources = EXCLUDED.sources, updated_at = now()`;
  }

  /** Воркер: последние 2 суток (поздние события и отмены). */
  aggregateRecent(): Promise<number> {
    return this.aggregate(new Date(Date.now() - 2 * 86400_000), new Date(Date.now() + 86400_000));
  }

  /** Отчёт для владельца/администратора: только филиалы организации (и права пользователя). */
  async report(organizationId: string, branchIds: string[] | null, q: { from: string; to: string; granularity: 'day' | 'week' | 'month' }) {
    const from = new Date(`${q.from}T00:00:00Z`);
    const to = new Date(`${q.to}T00:00:00Z`);
    if (!(from <= to)) throw AppError.badRequest('VALIDATION_ERROR', 'Неверный период');
    if (to.getTime() - from.getTime() > 400 * 86400_000) throw AppError.badRequest('VALIDATION_ERROR', 'Период не более 400 дней');
    const toExclusive = new Date(to.getTime() + 86400_000);
    // Актуализируем агрегаты периода (минус/плюс сутки — на часовые пояса).
    await this.aggregate(new Date(from.getTime() - 86400_000), new Date(toExclusive.getTime() + 86400_000));

    const branchCond = branchIds ? { branchId: { in: branchIds } } : {};
    const rows = await this.prisma.analyticsDailyAggregate.findMany({
      where: { organizationId, ...branchCond, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });

    const bucketOf = (d: Date) => {
      const dt = DateTime.fromJSDate(d, { zone: 'utc' });
      return q.granularity === 'day' ? dt.toISODate()! : q.granularity === 'week' ? dt.startOf('week').toISODate()! : dt.startOf('month').toISODate()!;
    };
    const empty = () => ({ pageViews: 0, uniqueVisitors: 0, bookingClicks: 0, bookingStarts: 0, bookingsCreated: 0, cancellations: 0 });
    const series = new Map<string, ReturnType<typeof empty>>();
    const totals = empty();
    const sources = new Map<string, { views: number; uniques: number; bookings: number }>();
    for (const r of rows) {
      const k = bucketOf(r.date);
      const b = series.get(k) ?? empty();
      for (const key of Object.keys(totals) as Array<keyof ReturnType<typeof empty>>) {
        b[key] += r[key];
        totals[key] += r[key];
      }
      series.set(k, b);
      for (const [src, v] of Object.entries((r.sources as Record<string, { views: number; uniques: number; bookings: number }>) ?? {})) {
        const s = sources.get(src) ?? { views: 0, uniques: 0, bookings: 0 };
        s.views += Number(v.views ?? 0);
        s.uniques += Number(v.uniques ?? 0);
        s.bookings += Number(v.bookings ?? 0);
        sources.set(src, s);
      }
    }

    const apptWhere = { organizationId, ...branchCond, startAt: { gte: from, lt: toExclusive } };
    const [popularServices, popularSpecialists, statusCounts] = await Promise.all([
      this.prisma.appointmentItem.groupBy({
        by: ['serviceId', 'serviceNameSnapshot'],
        where: { organizationId, appointment: { ...apptWhere, status: { in: ['confirmed', 'completed'] } } },
        _count: { _all: true },
        _sum: { finalPrice: true },
        orderBy: { _count: { serviceId: 'desc' } },
        take: 10,
      }),
      this.prisma.appointmentItem.groupBy({
        by: ['specialistId', 'specialistNameSnapshot'],
        where: { organizationId, specialistId: { not: null }, appointment: { ...apptWhere, status: { in: ['confirmed', 'completed'] } } },
        _count: { _all: true },
        orderBy: { _count: { specialistId: 'desc' } },
        take: 10,
      }),
      this.prisma.appointment.groupBy({ by: ['status'], where: apptWhere, _count: { _all: true } }),
    ]);

    const conv = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10000) / 100 : 0);
    return {
      period: { from: q.from, to: q.to, granularity: q.granularity },
      totals: {
        ...totals,
        conversionVisitorToBooking: conv(totals.bookingsCreated, totals.uniqueVisitors),
        conversionClickToBooking: conv(totals.bookingsCreated, totals.bookingClicks),
      },
      series: [...series.entries()].map(([bucket, v]) => ({ bucket, ...v })),
      sources: [...sources.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.views - a.views),
      popularServices: popularServices.map((p) => ({ serviceId: p.serviceId, name: p.serviceNameSnapshot, count: p._count._all, revenue: p._sum.finalPrice ?? 0 })),
      popularSpecialists: popularSpecialists.map((p) => ({ specialistId: p.specialistId, name: p.specialistNameSnapshot, count: p._count._all })),
      appointmentsByStatus: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])),
    };
  }
}
