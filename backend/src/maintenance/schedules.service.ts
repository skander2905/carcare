import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type PrismaLike } from '../odometer/odometer.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type MaintenanceSchedule } from '../prisma/model.types.js';
import { maintenanceLabel } from './domain/costs.js';
import { type DueState, type ServicePoint, byUrgency, dueState } from './domain/due.js';
import { type CreateScheduleDto, type UpdateScheduleDto } from './dto/maintenance.dto.js';
import { MaintenanceRepository } from './maintenance.repository.js';
import { SchedulesRepository } from './schedules.repository.js';

export interface ScheduleWithDue {
  schedule: MaintenanceSchedule;
  due: DueState;
  /** Logged records linked to it; the baseline is not counted. */
  serviceCount: number;
}

/**
 * Recurring services, and whether each is due.
 *
 * Every read runs the due engine afresh against the car's current mileage and
 * the owner's today. The schedule's own `lastService*` columns are a baseline —
 * what the owner remembered when setting it up — and the records linked to it
 * are laid over that baseline, never written into it. Deleting a record
 * therefore puts the schedule back exactly where it was (ADR-019).
 */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedules: SchedulesRepository,
    private readonly records: MaintenanceRepository,
  ) {}

  /** Active schedules first, most urgent first; paused ones after, in the same order. */
  async list(vehicleId: string): Promise<ScheduleWithDue[]> {
    const schedules = await this.schedules.listForVehicle(this.prisma, vehicleId);
    const withDue = await this.withDue(this.prisma, vehicleId, schedules);
    return withDue.sort(
      (a, b) => Number(b.schedule.isActive) - Number(a.schedule.isActive) || byUrgency(a.due, b.due),
    );
  }

  async findOne(vehicleId: string, id: string): Promise<ScheduleWithDue> {
    const schedule = await this.schedules.findInVehicle(this.prisma, id, vehicleId);
    if (!schedule) throw new NotFoundException('Maintenance schedule not found');
    const [withDue] = await this.withDue(this.prisma, vehicleId, [schedule]);
    return withDue;
  }

  async create(vehicleId: string, dto: CreateScheduleDto): Promise<ScheduleWithDue> {
    assertInterval(dto.intervalKm ?? null, dto.intervalMonths ?? null);

    const schedule = await this.schedules.create(this.prisma, {
      vehicleId,
      type: dto.type,
      name: dto.name ?? maintenanceLabel(dto.type),
      intervalKm: dto.intervalKm ?? null,
      intervalMonths: dto.intervalMonths ?? null,
      lastServiceOdometerKm: dto.lastServiceOdometerKm ?? null,
      lastServiceAt: dto.lastServiceAt ? new Date(dto.lastServiceAt) : null,
      ...(dto.notifyBeforeKm === undefined ? {} : { notifyBeforeKm: dto.notifyBeforeKm }),
      ...(dto.notifyBeforeDays === undefined ? {} : { notifyBeforeDays: dto.notifyBeforeDays }),
      ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
    });

    const [withDue] = await this.withDue(this.prisma, vehicleId, [schedule]);
    return withDue;
  }

  async update(vehicleId: string, id: string, dto: UpdateScheduleDto): Promise<ScheduleWithDue> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.schedules.lock(tx, id, vehicleId);
      if (!existing) throw new NotFoundException('Maintenance schedule not found');

      assertInterval(
        dto.intervalKm === undefined ? existing.intervalKm : dto.intervalKm,
        dto.intervalMonths === undefined ? existing.intervalMonths : dto.intervalMonths,
      );

      const updated = await this.schedules.update(tx, id, {
        ...(dto.type === undefined ? {} : { type: dto.type }),
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.intervalKm === undefined ? {} : { intervalKm: dto.intervalKm }),
        ...(dto.intervalMonths === undefined ? {} : { intervalMonths: dto.intervalMonths }),
        ...(dto.lastServiceOdometerKm === undefined
          ? {}
          : { lastServiceOdometerKm: dto.lastServiceOdometerKm }),
        ...(dto.lastServiceAt === undefined
          ? {}
          : { lastServiceAt: dto.lastServiceAt === null ? null : new Date(dto.lastServiceAt) }),
        ...(dto.notifyBeforeKm === undefined ? {} : { notifyBeforeKm: dto.notifyBeforeKm }),
        ...(dto.notifyBeforeDays === undefined ? {} : { notifyBeforeDays: dto.notifyBeforeDays }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      });

      const [withDue] = await this.withDue(tx, vehicleId, [updated]);
      return withDue;
    });
  }

  /** The records stay: they happened, and cost what they cost. Their link is cleared by the foreign key. */
  async remove(vehicleId: string, id: string): Promise<void> {
    const schedule = await this.schedules.findInVehicle(this.prisma, id, vehicleId);
    if (!schedule) throw new NotFoundException('Maintenance schedule not found');
    await this.schedules.delete(this.prisma, id);
  }

  private async withDue(
    client: PrismaLike,
    vehicleId: string,
    schedules: MaintenanceSchedule[],
  ): Promise<ScheduleWithDue[]> {
    const [vehicle, services] = await Promise.all([
      client.vehicle.findUniqueOrThrow({
        where: { id: vehicleId },
        // The owner's calendar, as amounts are in the owner's currency (ADR-016).
        select: { currentOdometerKm: true, owner: { select: { timezone: true } } },
      }),
      this.records.services(
        client,
        schedules.map((s) => s.id),
      ),
    ]);

    const now = new Date();

    return schedules.map((schedule) => {
      const linked = services.filter((s) => s.scheduleId === schedule.id);
      const points: ServicePoint[] = linked.map((s) => ({
        odometerKm: s.odometerKm,
        performedAt: s.performedAt,
      }));
      if (schedule.lastServiceOdometerKm !== null || schedule.lastServiceAt !== null) {
        points.push({ odometerKm: schedule.lastServiceOdometerKm, performedAt: schedule.lastServiceAt });
      }

      return {
        schedule,
        serviceCount: linked.length,
        due: dueState({
          terms: schedule,
          services: points,
          currentOdometerKm: vehicle.currentOdometerKm,
          now,
          timeZone: vehicle.owner.timezone,
        }),
      };
    });
  }
}

/** Mirrors the table's CHECK, so the refusal is a 400 that says why rather than a 500. */
function assertInterval(intervalKm: number | null, intervalMonths: number | null): void {
  if (intervalKm === null && intervalMonths === null) {
    throw new BadRequestException(
      'A schedule needs intervalKm, intervalMonths or both — with neither it could never fall due',
    );
  }
}
