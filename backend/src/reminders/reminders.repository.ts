import { Injectable } from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { type ReminderStatus } from '../generated/prisma/enums.js';
import { type PrismaLike } from '../odometer/odometer.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Reminder } from '../prisma/model.types.js';

export type NewReminder = Omit<Prisma.ReminderUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>;
export type ReminderChanges = Omit<
  Prisma.ReminderUncheckedUpdateInput,
  'id' | 'vehicleId' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class RemindersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The one lookup `ReminderAccessGuard` makes before membership is known. */
  async vehicleIdOf(id: string): Promise<string | null> {
    const row = await this.prisma.reminder.findUnique({ where: { id }, select: { vehicleId: true } });
    return row?.vehicleId ?? null;
  }

  findInVehicle(client: PrismaLike, id: string, vehicleId: string): Promise<Reminder | null> {
    return client.reminder.findFirst({ where: { id, vehicleId } });
  }

  async lock(tx: Prisma.TransactionClient, id: string, vehicleId: string): Promise<Reminder | null> {
    await tx.$queryRaw`SELECT id FROM reminders WHERE id = ${id}::uuid AND "vehicleId" = ${vehicleId}::uuid FOR UPDATE`;
    return this.findInVehicle(tx, id, vehicleId);
  }

  list(
    client: PrismaLike,
    vehicleId: string,
    filter: { status?: ReminderStatus; dueBefore?: Date },
  ): Promise<Reminder[]> {
    return client.reminder.findMany({
      where: {
        vehicleId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.dueBefore ? { dueDate: { lte: filter.dueBefore } } : {}),
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  create(client: PrismaLike, data: NewReminder): Promise<Reminder> {
    return client.reminder.create({ data });
  }

  update(client: PrismaLike, id: string, data: ReminderChanges): Promise<Reminder> {
    return client.reminder.update({ where: { id }, data });
  }

  async delete(client: PrismaLike, id: string): Promise<void> {
    await client.reminder.delete({ where: { id } });
  }

  /**
   * The next page of cars the sweep has to look at: not archived, with an
   * active schedule or a pending reminder. Keyset-paged by id, so a sweep over
   * many cars never holds more than one page in memory.
   */
  async vehiclesToSweep(afterId: string | null, take: number): Promise<{ id: string; name: string }[]> {
    const rows = await this.prisma.vehicle.findMany({
      where: {
        archivedAt: null,
        ...(afterId ? { id: { gt: afterId } } : {}),
        OR: [{ schedules: { some: { isActive: true } } }, { reminders: { some: { status: 'PENDING' } } }],
      },
      select: { id: true, make: true, model: true },
      orderBy: { id: 'asc' },
      take,
    });
    return rows.map((v) => ({ id: v.id, name: `${v.make} ${v.model}` }));
  }
}
