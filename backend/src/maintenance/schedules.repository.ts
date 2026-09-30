import { Injectable } from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { type PrismaLike } from '../odometer/odometer.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type MaintenanceSchedule } from '../prisma/model.types.js';

export type NewSchedule = Omit<
  Prisma.MaintenanceScheduleUncheckedCreateInput,
  'id' | 'createdAt' | 'updatedAt'
>;

export type ScheduleChanges = Omit<
  Prisma.MaintenanceScheduleUncheckedUpdateInput,
  'id' | 'vehicleId' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class SchedulesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The one lookup `MaintenanceScheduleAccessGuard` makes before membership is known. */
  async vehicleIdOf(id: string): Promise<string | null> {
    const row = await this.prisma.maintenanceSchedule.findUnique({
      where: { id },
      select: { vehicleId: true },
    });
    return row?.vehicleId ?? null;
  }

  findInVehicle(client: PrismaLike, id: string, vehicleId: string): Promise<MaintenanceSchedule | null> {
    return client.maintenanceSchedule.findFirst({ where: { id, vehicleId } });
  }

  async lock(
    tx: Prisma.TransactionClient,
    id: string,
    vehicleId: string,
  ): Promise<MaintenanceSchedule | null> {
    await tx.$queryRaw`SELECT id FROM maintenance_schedules WHERE id = ${id}::uuid AND "vehicleId" = ${vehicleId}::uuid FOR UPDATE`;
    return this.findInVehicle(tx, id, vehicleId);
  }

  listForVehicle(client: PrismaLike, vehicleId: string): Promise<MaintenanceSchedule[]> {
    return client.maintenanceSchedule.findMany({
      where: { vehicleId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  create(client: PrismaLike, data: NewSchedule): Promise<MaintenanceSchedule> {
    return client.maintenanceSchedule.create({ data });
  }

  update(client: PrismaLike, id: string, data: ScheduleChanges): Promise<MaintenanceSchedule> {
    return client.maintenanceSchedule.update({ where: { id }, data });
  }

  async delete(client: PrismaLike, id: string): Promise<void> {
    await client.maintenanceSchedule.delete({ where: { id } });
  }
}
