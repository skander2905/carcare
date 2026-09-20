import { Injectable } from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { type OdometerSource } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type OdometerReading } from '../prisma/model.types.js';

/** Either the shared client or an open transaction — writes need the latter. */
export type PrismaLike = PrismaService | Prisma.TransactionClient;

export interface NewReading {
  vehicleId: string;
  recordedAt: Date;
  odometerKm: number;
  source: OdometerSource;
  sourceId?: string;
  notes?: string;
}

export interface ReadingFilter {
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

@Injectable()
export class OdometerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Takes a write lock on the vehicle row for the rest of the transaction.
   *
   * Two readings submitted at once would otherwise both read the same
   * neighbours, both pass validation, and produce a timeline that contradicts
   * itself. Serialising per vehicle costs nothing here — contention on one
   * person's car is effectively zero. See docs/decisions.md ADR-010.
   */
  async lockVehicle(tx: Prisma.TransactionClient, vehicleId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${vehicleId}::uuid FOR UPDATE`;
  }

  /** The newest reading at or before `recordedAt`. */
  previousReading(client: PrismaLike, vehicleId: string, recordedAt: Date): Promise<OdometerReading | null> {
    return client.odometerReading.findFirst({
      where: { vehicleId, recordedAt: { lte: recordedAt } },
      orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** The oldest reading strictly after `recordedAt`. */
  nextReading(client: PrismaLike, vehicleId: string, recordedAt: Date): Promise<OdometerReading | null> {
    return client.odometerReading.findFirst({
      where: { vehicleId, recordedAt: { gt: recordedAt } },
      orderBy: [{ recordedAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  create(client: PrismaLike, data: NewReading): Promise<OdometerReading> {
    return client.odometerReading.create({ data });
  }

  list(vehicleId: string, filter: ReadingFilter): Promise<OdometerReading[]> {
    return this.prisma.odometerReading.findMany({
      where: { vehicleId, ...this.dateRange(filter) },
      orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
      skip: filter.skip,
      take: filter.take,
    });
  }

  count(vehicleId: string, filter: Pick<ReadingFilter, 'from' | 'to'>): Promise<number> {
    return this.prisma.odometerReading.count({
      where: { vehicleId, ...this.dateRange(filter) },
    });
  }

  private dateRange({ from, to }: Pick<ReadingFilter, 'from' | 'to'>) {
    if (!from && !to) return {};

    return {
      recordedAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    };
  }
}
