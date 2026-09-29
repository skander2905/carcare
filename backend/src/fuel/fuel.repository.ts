import { Injectable } from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { DocumentStatus, type FuelType } from '../generated/prisma/enums.js';
import { type PrismaLike } from '../odometer/odometer.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type FuelEntry } from '../prisma/model.types.js';
import { escapeLike } from '../expenses/expenses.repository.js';

/** Receipts live on the ledger expense; the count comes along for the paperclip. */
const WITH_ATTACHMENT_COUNT = {
  expense: {
    select: { _count: { select: { documents: { where: { status: DocumentStatus.READY } } } } },
  },
} as const;

export type FuelEntryWithAttachments = FuelEntry & { expense: { _count: { documents: number } } };

export type NewFuelEntry = Omit<Prisma.FuelEntryUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>;

export type FuelEntryChanges = Omit<
  Prisma.FuelEntryUncheckedUpdateInput,
  'id' | 'vehicleId' | 'createdById' | 'expenseId' | 'createdAt' | 'updatedAt'
>;

export interface FuelFilter {
  from?: Date;
  to?: Date;
  fuelType?: FuelType;
  station?: string;
}

/** What the engine and the suggestions read: every fill, and nothing else. */
const HISTORY_COLUMNS = {
  id: true,
  filledAt: true,
  odometerKm: true,
  volumeLiters: true,
  totalCost: true,
  pricePerLiter: true,
  fuelType: true,
  isFullTank: true,
  isMissedFill: true,
  stationName: true,
  latitude: true,
  longitude: true,
} as const;

export type FuelHistoryRow = Pick<FuelEntry, keyof typeof HISTORY_COLUMNS>;

@Injectable()
export class FuelRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The one lookup `FuelEntryAccessGuard` makes before membership is known. */
  async vehicleIdOf(id: string): Promise<string | null> {
    const row = await this.prisma.fuelEntry.findUnique({ where: { id }, select: { vehicleId: true } });
    return row?.vehicleId ?? null;
  }

  /** Scoped by vehicle as well as id, like every other record read. */
  findInVehicle(client: PrismaLike, id: string, vehicleId: string): Promise<FuelEntryWithAttachments | null> {
    return client.fuelEntry.findFirst({ where: { id, vehicleId }, include: WITH_ATTACHMENT_COUNT });
  }

  /** Row-locks the entry, so two edits apply one after the other. */
  async lock(
    tx: Prisma.TransactionClient,
    id: string,
    vehicleId: string,
  ): Promise<FuelEntryWithAttachments | null> {
    await tx.$queryRaw`SELECT id FROM fuel_entries WHERE id = ${id}::uuid AND "vehicleId" = ${vehicleId}::uuid FOR UPDATE`;
    return this.findInVehicle(tx, id, vehicleId);
  }

  create(client: PrismaLike, data: NewFuelEntry): Promise<FuelEntryWithAttachments> {
    return client.fuelEntry.create({ data, include: WITH_ATTACHMENT_COUNT });
  }

  update(client: PrismaLike, id: string, data: FuelEntryChanges): Promise<FuelEntryWithAttachments> {
    return client.fuelEntry.update({ where: { id }, data, include: WITH_ATTACHMENT_COUNT });
  }

  list(
    vehicleId: string,
    filter: FuelFilter,
    skip: number,
    take: number,
  ): Promise<FuelEntryWithAttachments[]> {
    return this.prisma.fuelEntry.findMany({
      where: this.where(vehicleId, filter),
      // Mileage breaks a same-instant tie the way the engine does; id keeps
      // pages stable after that.
      orderBy: [{ filledAt: 'desc' }, { odometerKm: 'desc' }, { id: 'desc' }],
      skip,
      take,
      include: WITH_ATTACHMENT_COUNT,
    });
  }

  count(vehicleId: string, filter: FuelFilter): Promise<number> {
    return this.prisma.fuelEntry.count({ where: this.where(vehicleId, filter) });
  }

  /**
   * The vehicle's whole fill history, lean.
   *
   * Consumption for any one entry depends on every fill before it, so a page
   * or a date range cannot be computed from its own rows. A car fills up
   * perhaps fifty times a year; twelve narrow columns for all of them is a
   * cheap read on the `(vehicleId, odometerKm)` index. ADR-018 notes when
   * this should move into SQL.
   */
  history(vehicleId: string): Promise<FuelHistoryRow[]> {
    return this.prisma.fuelEntry.findMany({
      where: { vehicleId },
      select: HISTORY_COLUMNS,
      orderBy: [{ odometerKm: 'asc' }, { filledAt: 'asc' }],
    });
  }

  private where(vehicleId: string, { from, to, fuelType, station }: FuelFilter): Prisma.FuelEntryWhereInput {
    return {
      vehicleId,
      ...(fuelType ? { fuelType } : {}),
      ...(from || to ? { filledAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(station ? { stationName: { contains: escapeLike(station), mode: 'insensitive' } } : {}),
    };
  }
}
