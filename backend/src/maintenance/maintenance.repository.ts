import { Injectable } from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { DocumentStatus, type MaintenanceType } from '../generated/prisma/enums.js';
import { escapeLike } from '../expenses/expenses.repository.js';
import { type PrismaLike } from '../odometer/odometer.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type MaintenanceRecord } from '../prisma/model.types.js';

/**
 * Receipts live on the ledger expense, as for fuel; a free service has no
 * expense and so no receipts. The schedule's name comes along for the log.
 */
const RECORD_INCLUDE = {
  expense: {
    select: { _count: { select: { documents: { where: { status: DocumentStatus.READY } } } } },
  },
  schedule: { select: { id: true, name: true } },
} as const;

export type MaintenanceRecordRow = MaintenanceRecord & {
  expense: { _count: { documents: number } } | null;
  schedule: { id: string; name: string } | null;
};

export type NewMaintenanceRecord = Omit<
  Prisma.MaintenanceRecordUncheckedCreateInput,
  'id' | 'createdAt' | 'updatedAt'
>;

export type MaintenanceRecordChanges = Omit<
  Prisma.MaintenanceRecordUncheckedUpdateInput,
  'id' | 'vehicleId' | 'createdById' | 'createdAt' | 'updatedAt'
>;

export interface MaintenanceFilter {
  type?: MaintenanceType;
  from?: Date;
  to?: Date;
  provider?: string;
}

/** What the due engine needs of a record: when, and at what mileage. */
export interface ServiceRow {
  scheduleId: string;
  performedAt: Date;
  odometerKm: number;
}

@Injectable()
export class MaintenanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The one lookup `MaintenanceRecordAccessGuard` makes before membership is known. */
  async vehicleIdOf(id: string): Promise<string | null> {
    const row = await this.prisma.maintenanceRecord.findUnique({
      where: { id },
      select: { vehicleId: true },
    });
    return row?.vehicleId ?? null;
  }

  findInVehicle(client: PrismaLike, id: string, vehicleId: string): Promise<MaintenanceRecordRow | null> {
    return client.maintenanceRecord.findFirst({ where: { id, vehicleId }, include: RECORD_INCLUDE });
  }

  /** Row-locks the record, so two edits apply one after the other. */
  async lock(
    tx: Prisma.TransactionClient,
    id: string,
    vehicleId: string,
  ): Promise<MaintenanceRecordRow | null> {
    await tx.$queryRaw`SELECT id FROM maintenance_records WHERE id = ${id}::uuid AND "vehicleId" = ${vehicleId}::uuid FOR UPDATE`;
    return this.findInVehicle(tx, id, vehicleId);
  }

  create(client: PrismaLike, data: NewMaintenanceRecord): Promise<MaintenanceRecordRow> {
    return client.maintenanceRecord.create({ data, include: RECORD_INCLUDE });
  }

  update(client: PrismaLike, id: string, data: MaintenanceRecordChanges): Promise<MaintenanceRecordRow> {
    return client.maintenanceRecord.update({ where: { id }, data, include: RECORD_INCLUDE });
  }

  async delete(client: PrismaLike, id: string): Promise<void> {
    await client.maintenanceRecord.delete({ where: { id } });
  }

  list(
    vehicleId: string,
    filter: MaintenanceFilter,
    skip: number,
    take: number,
  ): Promise<MaintenanceRecordRow[]> {
    return this.prisma.maintenanceRecord.findMany({
      where: this.where(vehicleId, filter),
      orderBy: [{ performedAt: 'desc' }, { odometerKm: 'desc' }, { id: 'desc' }],
      skip,
      take,
      include: RECORD_INCLUDE,
    });
  }

  count(vehicleId: string, filter: MaintenanceFilter): Promise<number> {
    return this.prisma.maintenanceRecord.count({ where: this.where(vehicleId, filter) });
  }

  /**
   * Every service linked to any of these schedules. A schedule is serviced
   * perhaps once or twice a year, so the whole history is a handful of rows
   * on the `(scheduleId, performedAt)` index.
   */
  services(client: PrismaLike, scheduleIds: string[]): Promise<ServiceRow[]> {
    if (scheduleIds.length === 0) return Promise.resolve([]);
    return client.maintenanceRecord
      .findMany({
        where: { scheduleId: { in: scheduleIds } },
        select: { scheduleId: true, performedAt: true, odometerKm: true },
      })
      .then((rows) => rows as ServiceRow[]);
  }

  /** Workshops used recently, newest first, for the form's chips. */
  async recentProviders(vehicleId: string, limit: number): Promise<string[]> {
    const rows = await this.prisma.maintenanceRecord.findMany({
      where: { vehicleId, serviceProvider: { not: null } },
      select: { serviceProvider: true },
      orderBy: { performedAt: 'desc' },
      take: 50,
    });

    // Case-insensitively distinct, keeping the most recent spelling.
    const seen = new Map<string, string>();
    for (const { serviceProvider } of rows) {
      const key = serviceProvider!.toLocaleLowerCase();
      if (!seen.has(key)) seen.set(key, serviceProvider!);
    }
    return [...seen.values()].slice(0, limit);
  }

  private where(
    vehicleId: string,
    { type, from, to, provider }: MaintenanceFilter,
  ): Prisma.MaintenanceRecordWhereInput {
    return {
      vehicleId,
      ...(type ? { type } : {}),
      ...(from || to ? { performedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(provider ? { serviceProvider: { contains: escapeLike(provider), mode: 'insensitive' } } : {}),
    };
  }
}
