import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { ExpenseCategory, ExpenseSource, type FuelType, OdometerSource } from '../generated/prisma/enums.js';
import { IdempotencyService, type IdempotentRequest } from '../common/idempotency/idempotency.service.js';
import { ExpensesRepository } from '../expenses/expenses.repository.js';
import { OdometerService } from '../odometer/odometer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ObjectStorage } from '../storage/object-storage.js';
import { purgeObjects } from '../storage/purge.js';
import {
  type ConsumptionWindow,
  type Fill,
  consumptionWindows,
  summarise,
  windowsEndingBetween,
} from './domain/consumption.js';
import {
  type NearbyStation,
  type PastFill,
  lastPrice,
  nearbyStations,
  recentStations,
  usualAmounts,
} from './domain/suggestions.js';
import { type OfficialPrices, officialPricesOn } from './domain/official-prices.js';
import { derivePriceMillimes, fromUnits, priceIsConsistent, toUnits } from './domain/units.js';
import {
  type CreateFuelEntryDto,
  type ListFuelEntriesQueryDto,
  type UpdateFuelEntryDto,
} from './dto/fuel.dto.js';
import {
  type FuelEntryChanges,
  type FuelEntryWithAttachments,
  type FuelHistoryRow,
  FuelRepository,
} from './fuel.repository.js';

export const CREATE_FUEL_SCOPE = 'fuel.create';

export interface CreatedFuelEntry {
  entry: FuelEntryWithAttachments;
  replayed: boolean;
}

export interface FuelPage {
  entries: FuelEntryWithAttachments[];
  total: number;
  /** The consumption window each full-tank entry closes, by entry id. */
  windows: Map<string, ConsumptionWindow>;
}

export interface FuelConsumption {
  summary: ReturnType<typeof summarise>;
  windows: ConsumptionWindow[];
  /** Every fill in the period, full or not — what was bought, not what was measured. */
  fills: { count: number; centilitres: number; costMillimes: number };
}

export interface FuelSuggestions {
  fuelType: FuelType;
  currentOdometerKm: number;
  lastFill: { filledAt: Date; odometerKm: number } | null;
  /** Millimes per litre, per fuel type this vehicle has bought. */
  lastPrices: Partial<Record<FuelType, number>>;
  nearbyStations: NearbyStation[];
  recentStations: string[];
  usualAmountsMillimes: number[];
  /** State-set pump prices in force today, or null where none apply. */
  officialPrices: OfficialPrices | null;
}

/** The resolved figures of an entry, whether it is being created or edited. */
interface FillFigures {
  filledAt: Date;
  odometerKm: number;
  centilitres: number;
  totalMillimes: number;
  priceMillimes: number;
  fuelType: FuelType;
  stationName: string | null;
}

/**
 * Fuel entries, and the consumption they add up to.
 *
 * A fill is three rows: the entry, its ledger expense (ADR-004) and its
 * odometer reading. They are written, changed and removed in one transaction,
 * so the ledger's fuel spend, the mileage timeline and the fuel log always
 * describe the same fills. The ledger refuses to edit the expense directly
 * (`ExpensesService.lockEditable`); this service is the only way in.
 */
@Injectable()
export class FuelService {
  private readonly logger = new Logger(FuelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fuel: FuelRepository,
    private readonly expenses: ExpensesRepository,
    private readonly odometer: OdometerService,
    private readonly idempotency: IdempotencyService,
    private readonly storage: ObjectStorage,
  ) {}

  async create(
    vehicleId: string,
    userId: string,
    dto: CreateFuelEntryDto,
    idempotencyKey?: string,
  ): Promise<CreatedFuelEntry> {
    const idempotent: IdempotentRequest | undefined = idempotencyKey
      ? {
          userId,
          key: idempotencyKey,
          scope: CREATE_FUEL_SCOPE,
          requestHash: this.idempotency.fingerprint(CREATE_FUEL_SCOPE, vehicleId, dto),
        }
      : undefined;

    if (idempotent) {
      const spent = await this.idempotency.find(userId, idempotent.key);
      if (spent) return this.replay(vehicleId, this.idempotency.replayedResourceId(spent, idempotent));
    }

    const coordinates = pairedCoordinates(dto.latitude ?? null, dto.longitude ?? null);

    try {
      const entry = await this.prisma.$transaction(async (tx) => {
        // Before any insert — see OdometerService.lockVehicleFor.
        await this.odometer.lockVehicleFor(tx, vehicleId);
        const vehicle = await tx.vehicle.findUniqueOrThrow({
          where: { id: vehicleId },
          select: { fuelType: true },
        });

        const figures = resolveFigures({
          filledAt: dto.filledAt ? new Date(dto.filledAt) : new Date(),
          odometerKm: dto.odometerKm,
          volumeLiters: dto.volumeLiters,
          totalCost: dto.totalCost,
          pricePerLiter: dto.pricePerLiter ?? null,
          fuelType: dto.fuelType ?? vehicle.fuelType,
          stationName: dto.stationName ?? null,
        });

        const expense = await this.expenses.create(tx, {
          vehicleId,
          createdById: userId,
          sourceType: ExpenseSource.FUEL,
          category: ExpenseCategory.FUEL,
          ...ledgerFields(figures),
          notes: null,
        });

        const created = await this.fuel.create(tx, {
          vehicleId,
          createdById: userId,
          expenseId: expense.id,
          ...entryFields(figures),
          isFullTank: dto.isFullTank ?? true,
          isMissedFill: dto.isMissedFill ?? false,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          notes: dto.notes ?? null,
        });

        await this.recordReading(tx, vehicleId, created.id, figures);
        if (idempotent) await this.idempotency.remember(tx, idempotent, created.id);

        return created;
      });

      return { entry, replayed: false };
    } catch (error) {
      // The concurrent retry, exactly as ExpensesService handles it.
      if (idempotent && this.idempotency.isConflict(error)) {
        const winner = await this.idempotency.find(userId, idempotent.key);
        if (winner) return this.replay(vehicleId, this.idempotency.replayedResourceId(winner, idempotent));
      }
      throw error;
    }
  }

  async findOne(vehicleId: string, id: string): Promise<FuelEntryWithAttachments> {
    const entry = await this.fuel.findInVehicle(this.prisma, id, vehicleId);
    if (!entry) throw new NotFoundException('Fuel entry not found');
    return entry;
  }

  async update(vehicleId: string, id: string, dto: UpdateFuelEntryDto): Promise<FuelEntryWithAttachments> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.fuel.lock(tx, id, vehicleId);
      if (!existing) throw new NotFoundException('Fuel entry not found');

      const volumeLiters = dto.volumeLiters ?? existing.volumeLiters.toFixed(2);
      const totalCost = dto.totalCost ?? existing.totalCost.toFixed(3);

      /*
       * A price sent is checked against the new volume and total. A price not
       * sent is kept only while volume and total are too — change either and
       * the old price may no longer be what the pump charged, so it is derived
       * again rather than left contradicting them.
       */
      const figuresMoved = dto.volumeLiters !== undefined || dto.totalCost !== undefined;
      const pricePerLiter =
        dto.pricePerLiter === undefined
          ? figuresMoved
            ? null
            : existing.pricePerLiter.toFixed(3)
          : dto.pricePerLiter;

      const figures = resolveFigures({
        filledAt: dto.filledAt ? new Date(dto.filledAt) : existing.filledAt,
        odometerKm: dto.odometerKm ?? existing.odometerKm,
        volumeLiters,
        totalCost,
        pricePerLiter,
        fuelType: dto.fuelType ?? existing.fuelType,
        stationName: dto.stationName === undefined ? existing.stationName : dto.stationName,
      });

      const coordinates = pairedCoordinates(
        dto.latitude === undefined ? (existing.latitude?.toNumber() ?? null) : dto.latitude,
        dto.longitude === undefined ? (existing.longitude?.toNumber() ?? null) : dto.longitude,
      );

      // Same rule as an expense's reading: it moves when the mileage or the
      // date does, and is withdrawn first so it is not checked against itself.
      if (
        figures.odometerKm !== existing.odometerKm ||
        figures.filledAt.getTime() !== existing.filledAt.getTime()
      ) {
        await this.odometer.removeForSource(tx, vehicleId, OdometerSource.FUEL, id);
        await this.recordReading(tx, vehicleId, id, figures);
      }

      await this.expenses.update(tx, existing.expenseId, ledgerFields(figures));

      const changes: FuelEntryChanges = {
        ...entryFields(figures),
        ...(dto.isFullTank === undefined ? {} : { isFullTank: dto.isFullTank }),
        ...(dto.isMissedFill === undefined ? {} : { isMissedFill: dto.isMissedFill }),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        ...(dto.notes === undefined ? {} : { notes: dto.notes }),
      };

      return this.fuel.update(tx, id, changes);
    });
  }

  async remove(vehicleId: string, id: string): Promise<void> {
    const receiptKeys = await this.prisma.$transaction(async (tx) => {
      const existing = await this.fuel.lock(tx, id, vehicleId);
      if (!existing) throw new NotFoundException('Fuel entry not found');

      // Receipts hang off the ledger expense; read where they are stored
      // before the rows cascade away.
      const keys = await this.expenses.documentKeys(tx, existing.expenseId);

      await this.odometer.removeForSource(tx, vehicleId, OdometerSource.FUEL, id);
      // The expense's delete cascades to the entry through its foreign key.
      await this.expenses.delete(tx, existing.expenseId);

      return keys;
    });

    await purgeObjects(this.storage, receiptKeys, this.logger);
  }

  async list(vehicleId: string, query: ListFuelEntriesQueryDto): Promise<FuelPage> {
    const filter = {
      ...dateRange(query.from, query.to),
      fuelType: query.fuelType,
      station: query.station,
    };

    const [entries, total, history] = await Promise.all([
      this.fuel.list(vehicleId, filter, (query.page - 1) * query.limit, query.limit),
      this.fuel.count(vehicleId, filter),
      this.fuel.history(vehicleId),
    ]);

    // Computed over the whole history, not the page: the window a fill
    // closes began at a full tank that may be pages away.
    const windows = new Map(consumptionWindows(history.map(toFill)).map((w) => [w.endEntryId, w]));

    return { entries, total, windows };
  }

  async consumption(vehicleId: string, from?: string, to?: string): Promise<FuelConsumption> {
    const range = dateRange(from, to);
    const history = await this.fuel.history(vehicleId);

    const windows = windowsEndingBetween(consumptionWindows(history.map(toFill)), range.from, range.to);

    const fills = { count: 0, centilitres: 0, costMillimes: 0 };
    for (const row of history) {
      if ((range.from && row.filledAt < range.from) || (range.to && row.filledAt > range.to)) continue;
      fills.count += 1;
      fills.centilitres += toUnits(row.volumeLiters.toFixed(2), 2);
      fills.costMillimes += toUnits(row.totalCost.toFixed(3), 3);
    }

    return { summary: summarise(windows), windows, fills };
  }

  async suggestions(vehicleId: string, lat?: number, lng?: number): Promise<FuelSuggestions> {
    const [vehicle, history] = await Promise.all([
      this.prisma.vehicle.findUniqueOrThrow({
        where: { id: vehicleId },
        select: { fuelType: true, currentOdometerKm: true, owner: { select: { currency: true } } },
      }),
      this.fuel.history(vehicleId),
    ]);

    const past = history.map(toPastFill);

    const lastPrices: Partial<Record<FuelType, number>> = {};
    for (const fuelType of new Set(history.map((row) => row.fuelType))) {
      const price = lastPrice(past, fuelType);
      if (price !== null) lastPrices[fuelType] = price;
    }

    const newest = history.reduce<FuelHistoryRow | null>(
      (latest, row) => (!latest || row.filledAt > latest.filledAt ? row : latest),
      null,
    );

    return {
      fuelType: vehicle.fuelType,
      currentOdometerKm: vehicle.currentOdometerKm,
      lastFill: newest ? { filledAt: newest.filledAt, odometerKm: newest.odometerKm } : null,
      lastPrices,
      nearbyStations: lat !== undefined && lng !== undefined ? nearbyStations(past, lat, lng) : [],
      recentStations: recentStations(past),
      usualAmountsMillimes: usualAmounts(past),
      // In the owner's currency, like every amount on the vehicle (ADR-016).
      officialPrices: officialPricesOn(vehicle.owner.currency, new Date()),
    };
  }

  private async recordReading(
    tx: Prisma.TransactionClient,
    vehicleId: string,
    entryId: string,
    figures: FillFigures,
  ): Promise<void> {
    await this.odometer.recordIn(tx, vehicleId, {
      odometerKm: figures.odometerKm,
      recordedAt: figures.filledAt,
      source: OdometerSource.FUEL,
      sourceId: entryId,
    });
  }

  private async replay(vehicleId: string, entryId: string): Promise<CreatedFuelEntry> {
    const entry = await this.fuel.findInVehicle(this.prisma, entryId, vehicleId);

    if (!entry) {
      throw new ConflictException(
        'The fuel entry created with this Idempotency-Key has since been deleted. Generate a new key to create it again.',
      );
    }

    return { entry, replayed: true };
  }
}

interface FigureInput {
  filledAt: Date;
  odometerKm: number;
  volumeLiters: string;
  totalCost: string;
  pricePerLiter: string | null;
  fuelType: FuelType;
  stationName: string | null;
}

/** Validates the three pump figures against each other, deriving the price if absent. */
function resolveFigures(input: FigureInput): FillFigures {
  const centilitres = toUnits(input.volumeLiters, 2);
  const totalMillimes = toUnits(input.totalCost, 3);

  let priceMillimes: number;
  if (input.pricePerLiter === null) {
    priceMillimes = derivePriceMillimes(totalMillimes, centilitres);
  } else {
    priceMillimes = toUnits(input.pricePerLiter, 3);
    if (!priceIsConsistent(priceMillimes, totalMillimes, centilitres)) {
      const implied = fromUnits(derivePriceMillimes(totalMillimes, centilitres), 3);
      throw new BadRequestException(
        `pricePerLiter ${input.pricePerLiter} does not match ${input.totalCost} for ${input.volumeLiters} L ` +
          `(that is ${implied} per litre). Check the three figures, or leave the price out to have it worked out.`,
      );
    }
  }

  return {
    filledAt: input.filledAt,
    odometerKm: input.odometerKm,
    centilitres,
    totalMillimes,
    priceMillimes,
    fuelType: input.fuelType,
    stationName: input.stationName,
  };
}

function entryFields(figures: FillFigures) {
  return {
    filledAt: figures.filledAt,
    odometerKm: figures.odometerKm,
    volumeLiters: fromUnits(figures.centilitres, 2),
    totalCost: fromUnits(figures.totalMillimes, 3),
    pricePerLiter: fromUnits(figures.priceMillimes, 3),
    fuelType: figures.fuelType,
    stationName: figures.stationName,
  };
}

/** The ledger's view of a fill: what it cost, when, where. */
function ledgerFields(figures: FillFigures) {
  return {
    amount: fromUnits(figures.totalMillimes, 3),
    incurredAt: figures.filledAt,
    odometerKm: figures.odometerKm,
    vendor: figures.stationName,
    description: `${fromUnits(figures.centilitres, 2)} L ${figures.fuelType.toLowerCase()}`,
  };
}

/** Both or neither; half a coordinate is a client bug, not a place. */
function pairedCoordinates(
  latitude: number | null,
  longitude: number | null,
): { latitude: number | null; longitude: number | null } {
  if ((latitude === null) !== (longitude === null)) {
    throw new BadRequestException('latitude and longitude must be sent together');
  }
  return { latitude, longitude };
}

function dateRange(from?: string, to?: string): { from?: Date; to?: Date } {
  const start = from ? new Date(from) : undefined;
  const end = to ? new Date(to) : undefined;
  if (start && end && start > end) throw new BadRequestException('from must not be after to');
  return { from: start, to: end };
}

function toFill(row: FuelHistoryRow): Fill {
  return {
    id: row.id,
    filledAt: row.filledAt,
    odometerKm: row.odometerKm,
    centilitres: toUnits(row.volumeLiters.toFixed(2), 2),
    costMillimes: toUnits(row.totalCost.toFixed(3), 3),
    isFullTank: row.isFullTank,
    isMissedFill: row.isMissedFill,
  };
}

function toPastFill(row: FuelHistoryRow): PastFill {
  return {
    filledAt: row.filledAt,
    stationName: row.stationName,
    latitude: row.latitude?.toNumber() ?? null,
    longitude: row.longitude?.toNumber() ?? null,
    costMillimes: toUnits(row.totalCost.toFixed(3), 3),
    priceMillimes: toUnits(row.pricePerLiter.toFixed(3), 3),
    fuelType: row.fuelType,
  };
}
