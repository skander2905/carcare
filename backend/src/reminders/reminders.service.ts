import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type ReminderStatus } from '../generated/prisma/enums.js';
import { type PointDueState, URGENCY, addMonths, dueAt } from '../maintenance/domain/due.js';
import { type PrismaLike } from '../odometer/odometer.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Reminder } from '../prisma/model.types.js';
import { type CreateReminderDto, type UpdateReminderDto } from './dto/reminders.dto.js';
import { RemindersRepository } from './reminders.repository.js';

export interface ReminderWithDue {
  reminder: Reminder;
  /** Derived on every read, like a schedule's. Null once completed: it is no longer due. */
  due: PointDueState | null;
}

export interface Completion {
  completed: ReminderWithDue;
  /** The next occurrence, for a repeating reminder. */
  next: ReminderWithDue | null;
}

/**
 * One-off things that fall due on a date or at a mileage.
 *
 * The due point is fixed — unlike a schedule, nothing moves it but an edit —
 * so the status comes from `dueAt`, classified by the same windows as
 * maintenance. Repeating is done by succession: completing this year's
 * insurance creates next year's, and this year's keeps its completion date.
 */
@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: RemindersRepository,
  ) {}

  /** Pending first, most urgent first; completed after, most recently done first. */
  async list(
    vehicleId: string,
    filter: { status?: ReminderStatus; dueBefore?: string } = {},
    now = new Date(),
  ): Promise<ReminderWithDue[]> {
    const rows = await this.reminders.list(this.prisma, vehicleId, {
      status: filter.status,
      dueBefore: filter.dueBefore ? toDate(filter.dueBefore) : undefined,
    });
    const withDue = await this.withDue(this.prisma, vehicleId, rows, now);
    return withDue.sort(byPendingThenUrgency);
  }

  async findOne(vehicleId: string, id: string): Promise<ReminderWithDue> {
    const reminder = await this.reminders.findInVehicle(this.prisma, id, vehicleId);
    if (!reminder) throw new NotFoundException('Reminder not found');
    const [withDue] = await this.withDue(this.prisma, vehicleId, [reminder]);
    return withDue;
  }

  async create(vehicleId: string, userId: string, dto: CreateReminderDto): Promise<ReminderWithDue> {
    const dueDate = dto.dueDate ?? null;
    const dueOdometerKm = dto.dueOdometerKm ?? null;
    const repeatEveryMonths = dto.repeatEveryMonths ?? null;
    assertDuePoint(dueDate, dueOdometerKm, repeatEveryMonths);

    const reminder = await this.reminders.create(this.prisma, {
      vehicleId,
      createdById: userId,
      type: dto.type,
      title: dto.title,
      description: dto.description ?? null,
      dueDate: dueDate ? toDate(dueDate) : null,
      dueOdometerKm,
      repeatEveryMonths,
      ...(dto.notifyBeforeDays === undefined ? {} : { notifyBeforeDays: dto.notifyBeforeDays }),
      ...(dto.notifyBeforeKm === undefined ? {} : { notifyBeforeKm: dto.notifyBeforeKm }),
    });
    const [withDue] = await this.withDue(this.prisma, vehicleId, [reminder]);
    return withDue;
  }

  async update(vehicleId: string, id: string, dto: UpdateReminderDto): Promise<ReminderWithDue> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.reminders.lock(tx, id, vehicleId);
      if (!existing) throw new NotFoundException('Reminder not found');

      const dueDate = dto.dueDate === undefined ? dateOf(existing.dueDate) : dto.dueDate;
      const dueOdometerKm = dto.dueOdometerKm === undefined ? existing.dueOdometerKm : dto.dueOdometerKm;
      const repeat = dto.repeatEveryMonths === undefined ? existing.repeatEveryMonths : dto.repeatEveryMonths;
      assertDuePoint(dueDate, dueOdometerKm, repeat);

      const updated = await this.reminders.update(tx, id, {
        ...(dto.type === undefined ? {} : { type: dto.type }),
        ...(dto.title === undefined ? {} : { title: dto.title }),
        ...(dto.description === undefined ? {} : { description: dto.description }),
        ...(dto.dueDate === undefined ? {} : { dueDate: dto.dueDate === null ? null : toDate(dto.dueDate) }),
        ...(dto.dueOdometerKm === undefined ? {} : { dueOdometerKm: dto.dueOdometerKm }),
        ...(dto.repeatEveryMonths === undefined ? {} : { repeatEveryMonths: dto.repeatEveryMonths }),
        ...(dto.notifyBeforeDays === undefined ? {} : { notifyBeforeDays: dto.notifyBeforeDays }),
        ...(dto.notifyBeforeKm === undefined ? {} : { notifyBeforeKm: dto.notifyBeforeKm }),
      });
      const [withDue] = await this.withDue(tx, vehicleId, [updated]);
      return withDue;
    });
  }

  /**
   * Marks it done; a repeating one is succeeded by the next occurrence,
   * counted from the due date rather than from today — paying the insurance a
   * week late does not move next year's renewal.
   */
  async complete(vehicleId: string, id: string, now = new Date()): Promise<Completion> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.reminders.lock(tx, id, vehicleId);
      if (!existing) throw new NotFoundException('Reminder not found');
      // Completing twice would create two successors.
      if (existing.status === 'COMPLETED') throw new ConflictException('This reminder is already completed');

      const completed = await this.reminders.update(tx, id, { status: 'COMPLETED', completedAt: now });

      const next =
        existing.repeatEveryMonths !== null && existing.dueDate !== null
          ? await this.reminders.create(tx, {
              vehicleId,
              createdById: existing.createdById,
              type: existing.type,
              title: existing.title,
              description: existing.description,
              dueDate: toDate(addMonths(dateOf(existing.dueDate)!, existing.repeatEveryMonths)),
              dueOdometerKm: null,
              repeatEveryMonths: existing.repeatEveryMonths,
              notifyBeforeDays: existing.notifyBeforeDays,
              notifyBeforeKm: existing.notifyBeforeKm,
            })
          : null;

      const [completedWithDue, nextWithDue] = await this.withDue(
        tx,
        vehicleId,
        next ? [completed, next] : [completed],
        now,
      );
      return { completed: completedWithDue, next: nextWithDue ?? null };
    });
  }

  async remove(vehicleId: string, id: string): Promise<void> {
    const reminder = await this.reminders.findInVehicle(this.prisma, id, vehicleId);
    if (!reminder) throw new NotFoundException('Reminder not found');
    await this.reminders.delete(this.prisma, id);
  }

  /** Every pending reminder of a car with its due state, for the sweep. */
  pending(vehicleId: string, now: Date): Promise<ReminderWithDue[]> {
    return this.list(vehicleId, { status: 'PENDING' }, now);
  }

  private async withDue(
    client: PrismaLike,
    vehicleId: string,
    reminders: Reminder[],
    now = new Date(),
  ): Promise<ReminderWithDue[]> {
    if (reminders.length === 0) return [];
    const vehicle = await client.vehicle.findUniqueOrThrow({
      where: { id: vehicleId },
      // The owner's calendar, as for schedules (ADR-019).
      select: { currentOdometerKm: true, owner: { select: { timezone: true } } },
    });

    return reminders.map((reminder) => ({
      reminder,
      due:
        reminder.status === 'COMPLETED'
          ? null
          : dueAt(
              {
                dueAtKm: reminder.dueOdometerKm,
                dueDate: dateOf(reminder.dueDate),
                notifyBeforeKm: reminder.notifyBeforeKm,
                notifyBeforeDays: reminder.notifyBeforeDays,
              },
              { currentOdometerKm: vehicle.currentOdometerKm, now, timeZone: vehicle.owner.timezone },
            ),
    }));
  }
}

function byPendingThenUrgency(a: ReminderWithDue, b: ReminderWithDue): number {
  if (a.due && b.due) {
    return (
      URGENCY[a.due.status] - URGENCY[b.due.status] ||
      soonest(a.due) - soonest(b.due) ||
      a.reminder.id.localeCompare(b.reminder.id)
    );
  }
  if (a.due) return -1;
  if (b.due) return 1;
  return (b.reminder.completedAt?.getTime() ?? 0) - (a.reminder.completedAt?.getTime() ?? 0);
}

/** Days to go, with a km-only reminder sorted after dated ones. */
const soonest = (due: PointDueState) => due.time?.remainingDays ?? Number.MAX_SAFE_INTEGER;

/** A `date` column comes back as UTC midnight; this is the calendar date it stores. */
export const dateOf = (value: Date | null): string | null => value?.toISOString().slice(0, 10) ?? null;
const toDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** Mirrors the table's CHECKs, so the refusal is a 400 that says why rather than a 500. */
function assertDuePoint(dueDate: string | null, dueOdometerKm: number | null, repeat: number | null): void {
  if (dueDate === null && dueOdometerKm === null) {
    throw new BadRequestException(
      'A reminder needs dueDate, dueOdometerKm or both — with neither it could never fall due',
    );
  }
  if (repeat !== null && dueDate === null) {
    throw new BadRequestException('repeatEveryMonths counts from dueDate, so a repeating reminder needs one');
  }
}
