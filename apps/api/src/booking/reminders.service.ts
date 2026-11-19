import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { getConfig } from '../config/config';

/** Постановка напоминаний о визите (§16) за N часов (настройка филиала). */
@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async enqueueDue(limit = 200): Promise<number> {
    // Напоминание только для записей, сделанных до начала окна напоминания (не дублируем подтверждение).
    const due = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT a.id FROM appointments a
      JOIN booking_settings bs ON bs.branch_id = a.branch_id
      WHERE a.status = 'confirmed'
        AND a.reminder_sent_at IS NULL
        AND bs.reminder_hours_before > 0
        AND a.start_at > now()
        AND a.start_at <= now() + make_interval(hours => bs.reminder_hours_before)
        AND a.confirmed_at <= a.start_at - make_interval(hours => bs.reminder_hours_before)
      ORDER BY a.start_at
      LIMIT ${limit}`;
    let n = 0;
    for (const { id } of due) {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.appointment.updateMany({ where: { id, reminderSentAt: null, status: 'confirmed' }, data: { reminderSentAt: new Date() } });
        if (claimed.count !== 1) return;
        const a = await tx.appointment.findUniqueOrThrow({ where: { id }, include: { client: true, branch: true } });
        const dt = DateTime.fromJSDate(a.startAt, { zone: a.branch.timezone }).setLocale(a.locale);
        await this.notifications.enqueue(tx, {
          organizationId: a.organizationId,
          type: 'appointment_reminder',
          eventKey: `appointment:${a.id}:reminder:${a.startAt.toISOString()}`,
          recipient: a.client.phone,
          locale: a.locale,
          params: {
            clientName: a.client.name,
            branchName: a.branch.name,
            date: dt.toFormat('d MMMM yyyy'),
            time: dt.toFormat('HH:mm'),
            manageUrl: `${getConfig().PUBLIC_BASE_URL}/${a.locale}/cabinet`,
          },
          appointmentId: a.id,
          clientId: a.clientId,
        });
        n++;
      });
    }
    return n;
  }
}
