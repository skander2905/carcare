import { Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Notification } from '../prisma/model.types.js';
import { type Alert } from './domain/alerts.js';
import { Mailer } from './mail/mailer.js';
import { NotificationsRepository } from './notifications.repository.js';

/** One alert for everyone who can see the car it is about. */
export interface Delivery {
  vehicleId: string;
  recipientIds: string[];
  alert: Alert;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsRepository,
    private readonly mailer: Mailer,
  ) {}

  list(
    userId: string,
    query: { unreadOnly: boolean; page: number; limit: number },
  ): Promise<{ notifications: Notification[]; total: number }> {
    return this.notifications.list(userId, {
      unreadOnly: query.unreadOnly,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  }

  unreadCount(userId: string): Promise<number> {
    return this.notifications.unreadCount(userId);
  }

  /** Someone else's notification is absent, not forbidden. */
  async markRead(userId: string, id: string): Promise<Notification> {
    const existing = await this.notifications.findOwn(id, userId);
    if (!existing) throw new NotFoundException('Notification not found');
    await this.notifications.markRead(id, userId, new Date());
    return (await this.notifications.findOwn(id, userId)) ?? existing;
  }

  markAllRead(userId: string): Promise<number> {
    return this.notifications.markAllRead(userId, new Date());
  }

  /**
   * Writes each alert once per recipient; anything already said is skipped.
   *
   * Whether it is owed an email is settled here, at creation: someone who has
   * email off or has not confirmed their address, or a server with no
   * transport, gets `SKIPPED` — so turning
   * email on later does not unleash a backlog of stale reminders.
   */
  async deliver(deliveries: Delivery[]): Promise<number> {
    const recipientIds = [...new Set(deliveries.flatMap((d) => d.recipientIds))];
    if (recipientIds.length === 0) return 0;

    const wantsEmail = new Set(
      this.mailer.enabled
        ? (
            await this.prisma.user.findMany({
              where: { id: { in: recipientIds }, emailNotifications: true, emailVerifiedAt: { not: null } },
              select: { id: true },
            })
          ).map((u) => u.id)
        : [],
    );

    return this.notifications.insertNew(
      deliveries.flatMap(({ vehicleId, recipientIds, alert }) =>
        recipientIds.map((userId) => ({
          userId,
          vehicleId,
          type: alert.type,
          title: alert.title,
          body: alert.body,
          data: alert.data as unknown as Prisma.InputJsonValue,
          dedupeKey: alert.dedupeKey,
          emailStatus: wantsEmail.has(userId) ? ('PENDING' as const) : ('SKIPPED' as const),
        })),
      ),
    );
  }

  /** Turns reminder emails off; what a signed unsubscribe link does. */
  async unsubscribe(userId: string): Promise<void> {
    await this.prisma.user.updateMany({ where: { id: userId }, data: { emailNotifications: false } });
  }

  usersAwaitingEmail(): Promise<{ id: string; timezone: string }[]> {
    return this.notifications.usersAwaitingEmail();
  }
}
