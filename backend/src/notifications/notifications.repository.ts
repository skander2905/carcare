import { Injectable } from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { type PrismaLike } from '../odometer/odometer.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Notification } from '../prisma/model.types.js';

export type NewNotification = Omit<
  Prisma.NotificationUncheckedCreateInput,
  'id' | 'createdAt' | 'readAt' | 'emailedAt'
>;

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    { unreadOnly, skip, take }: { unreadOnly: boolean; skip: number; take: number },
  ): Promise<{ notifications: Notification[]; total: number }> {
    const where: Prisma.NotificationWhereInput = { userId, ...(unreadOnly ? { readAt: null } : {}) };
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { notifications, total };
  }

  /** Served by the partial index on unread rows. */
  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  findOwn(id: string, userId: string): Promise<Notification | null> {
    return this.prisma.notification.findFirst({ where: { id, userId } });
  }

  /** Keeps the first read time: reading twice is not news. */
  async markRead(id: string, userId: string, at: Date): Promise<void> {
    await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: at } });
  }

  async markAllRead(userId: string, at: Date): Promise<number> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: at },
    });
    return count;
  }

  /**
   * Inserts what is new and ignores what was already said: `ON CONFLICT DO
   * NOTHING` on `(userId, dedupeKey)`. Two workers sweeping at once both
   * attempt the insert, and exactly one row results.
   */
  async insertNew(rows: NewNotification[]): Promise<number> {
    if (rows.length === 0) return 0;
    const { count } = await this.prisma.notification.createMany({ data: rows, skipDuplicates: true });
    return count;
  }

  /** Everyone owed an email, with the clock their digest is timed by. */
  usersAwaitingEmail(): Promise<{ id: string; timezone: string }[]> {
    return this.prisma.user.findMany({
      where: { notifications: { some: { emailStatus: 'PENDING' } } },
      select: { id: true, timezone: true },
    });
  }

  /**
   * Locks this user's unsent rows for the length of the transaction.
   *
   * The lock is what stops two overlapping digests — a retry and a fresh one —
   * from emailing the same rows: without it both read PENDING and both send.
   * `SKIP LOCKED` only spares the second one a wait. Plain `FOR UPDATE` would
   * also be correct, since Postgres re-checks the WHERE once the lock is free
   * and finds the rows sent, but the second worker would sit blocked behind
   * the first one's SMTP call to learn that.
   */
  async claimUnsent(tx: Prisma.TransactionClient, userId: string): Promise<Notification[]> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM notifications
      WHERE "userId" = ${userId}::uuid AND "emailStatus" = 'PENDING'
      ORDER BY "createdAt", id
      FOR UPDATE SKIP LOCKED`;
    if (locked.length === 0) return [];
    return tx.notification.findMany({
      where: { id: { in: locked.map((row) => row.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async settleEmail(
    client: PrismaLike,
    ids: string[],
    outcome: { emailStatus: 'SENT'; emailedAt: Date } | { emailStatus: 'SKIPPED' },
  ): Promise<void> {
    if (ids.length === 0) return;
    await client.notification.updateMany({ where: { id: { in: ids } }, data: outcome });
  }
}
