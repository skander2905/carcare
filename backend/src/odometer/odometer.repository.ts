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

  /** Readings in a window, oldest first, leaving out the ones a given record produced. */
  between(
    client: PrismaLike,
    vehicleId: string,
    from: Date,
    to: Date,
    excludeSourceId?: string,
  ): Promise<OdometerReading[]> {
    return client.odometerReading.findMany({
      where: {
        vehicleId,
        recordedAt: { gte: from, lte: to },
        ...(excludeSourceId ? { OR: [{ sourceId: null }, { sourceId: { not: excludeSourceId } }] } : {}),
      },
      orderBy: [{ recordedAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** The newest reading of one kind at or before a moment, e.g. the last fill-up's. */
  lastOfSource(
    client: PrismaLike,
    vehicleId: string,
    source: OdometerSource,
    at: Date,
    excludeSourceId?: string,
  ): Promise<OdometerReading | null> {
    return client.odometerReading.findFirst({
      where: {
        vehicleId,
        source,
        recordedAt: { lte: at },
        ...(excludeSourceId ? { OR: [{ sourceId: null }, { sourceId: { not: excludeSourceId } }] } : {}),
      },
      orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** Like `previousReading`/`nextReading`, but able to leave out the record being edited. */
  neighbour(
    client: PrismaLike,
    vehicleId: string,
    at: Date,
    direction: 'before' | 'after',
    excludeSourceId?: string,
  ): Promise<OdometerReading | null> {
    const before = direction === 'before';
    return client.odometerReading.findFirst({
      where: {
        vehicleId,
        recordedAt: before ? { lte: at } : { gt: at },
        ...(excludeSourceId ? { OR: [{ sourceId: null }, { sourceId: { not: excludeSourceId } }] } : {}),
      },
      orderBy: before
        ? [{ recordedAt: 'desc' }, { createdAt: 'desc' }]
        : [{ recordedAt: 'asc' }, { createdAt: 'asc' }],
    });
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

  /** Removes the readings a fuel entry, expense or other record produced. */
  async deleteBySource(
    client: PrismaLike,
    vehicleId: string,
    source: OdometerSource,
    sourceId: string,
  ): Promise<number> {
    const { count } = await client.odometerReading.deleteMany({ where: { vehicleId, source, sourceId } });
    return count;
  }

  /** The highest reading on the timeline, or null for a vehicle with none. */
  async highestOdometer(client: PrismaLike, vehicleId: string): Promise<number | null> {
    const { _max } = await client.odometerReading.aggregate({
      where: { vehicleId },
      _max: { odometerKm: true },
    });

    return _max.odometerKm;
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
