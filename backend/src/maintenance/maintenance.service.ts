import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { ExpenseSource, type MaintenanceType, OdometerSource } from '../generated/prisma/enums.js';
import { fromUnits } from '../common/money/units.js';
import { IdempotencyService, type IdempotentRequest } from '../common/idempotency/idempotency.service.js';
import { ExpensesRepository } from '../expenses/expenses.repository.js';
import { OdometerService } from '../odometer/odometer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ObjectStorage } from '../storage/object-storage.js';
import { purgeObjects } from '../storage/purge.js';
import { type Costs, ledgerCategory, ledgerDescription, resolveCosts } from './domain/costs.js';
import {
  type CreateMaintenanceRecordDto,
  type ListMaintenanceRecordsQueryDto,
  type UpdateMaintenanceRecordDto,
} from './dto/maintenance.dto.js';
import {
  type MaintenanceRecordChanges,
  MaintenanceRepository,
  type MaintenanceRecordRow,
} from './maintenance.repository.js';
import { SchedulesRepository } from './schedules.repository.js';

export const CREATE_MAINTENANCE_SCOPE = 'maintenance.create';

export interface CreatedMaintenanceRecord {
  record: MaintenanceRecordRow;
  replayed: boolean;
}

export interface MaintenancePage {
  records: MaintenanceRecordRow[];
  total: number;
}

export interface MaintenanceSuggestions {
  currentOdometerKm: number;
  recentProviders: string[];
}

/** The resolved figures of a record, whether it is being created or edited. */
interface ServiceFigures {
  type: MaintenanceType;
  performedAt: Date;
  odometerKm: number;
  costs: Costs;
  serviceProvider: string | null;
  description: string | null;
}

/**
 * Maintenance records: services that were carried out.
 *
 * A paid record is three rows, like a fill-up: the record, its ledger expense
 * (ADR-004) and its odometer reading, always written, changed and removed in
 * one transaction. A free record is two — the ledger refuses a zero amount, so
 * it has no expense (ADR-019), and gains or loses one as its cost is edited.
 *
 * Whether a schedule is due is not this service's concern: linking a record
 * to a schedule is all it takes, because the due engine reads the schedule's
 * records every time (`SchedulesService`).
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly records: MaintenanceRepository,
    private readonly schedules: SchedulesRepository,
    private readonly expenses: ExpensesRepository,
    private readonly odometer: OdometerService,
    private readonly idempotency: IdempotencyService,
    private readonly storage: ObjectStorage,
  ) {}

  async create(
    vehicleId: string,
    userId: string,
    dto: CreateMaintenanceRecordDto,
    idempotencyKey?: string,
  ): Promise<CreatedMaintenanceRecord> {
    const idempotent: IdempotentRequest | undefined = idempotencyKey
      ? {
          userId,
          key: idempotencyKey,
          scope: CREATE_MAINTENANCE_SCOPE,
          requestHash: this.idempotency.fingerprint(CREATE_MAINTENANCE_SCOPE, vehicleId, dto),
        }
      : undefined;

    if (idempotent) {
      const spent = await this.idempotency.find(userId, idempotent.key);
      if (spent) return this.replay(vehicleId, this.idempotency.replayedResourceId(spent, idempotent));
    }

    const figures: ServiceFigures = {
      type: dto.type,
      performedAt: dto.performedAt ? new Date(dto.performedAt) : new Date(),
      odometerKm: dto.odometerKm,
      costs: costsOrThrow(dto.partsCost ?? null, dto.laborCost ?? null, dto.totalCost ?? null),
      serviceProvider: dto.serviceProvider ?? null,
      description: dto.description ?? null,
    };

    try {
      const record = await this.prisma.$transaction(async (tx) => {
        // Before any insert — see OdometerService.lockVehicleFor.
        await this.odometer.lockVehicleFor(tx, vehicleId);
        if (dto.scheduleId) await this.assertSchedule(tx, vehicleId, dto.scheduleId);

        const expenseId =
          figures.costs.totalMillimes > 0 ? await this.createExpense(tx, vehicleId, userId, figures) : null;

        const created = await this.records.create(tx, {
          vehicleId,
          createdById: userId,
          expenseId,
          scheduleId: dto.scheduleId ?? null,
          ...recordFields(figures),
          notes: dto.notes ?? null,
        });

        await this.recordReading(tx, vehicleId, created.id, figures);
        if (idempotent) await this.idempotency.remember(tx, idempotent, created.id);

        return created;
      });

      return { record, replayed: false };
    } catch (error) {
      // The concurrent retry, exactly as ExpensesService handles it.
      if (idempotent && this.idempotency.isConflict(error)) {
        const winner = await this.idempotency.find(userId, idempotent.key);
        if (winner) return this.replay(vehicleId, this.idempotency.replayedResourceId(winner, idempotent));
      }
      throw error;
    }
  }

  async findOne(vehicleId: string, id: string): Promise<MaintenanceRecordRow> {
    const record = await this.records.findInVehicle(this.prisma, id, vehicleId);
    if (!record) throw new NotFoundException('Maintenance record not found');
    return record;
  }

  async update(
    vehicleId: string,
    id: string,
    dto: UpdateMaintenanceRecordDto,
  ): Promise<MaintenanceRecordRow> {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await this.records.lock(tx, id, vehicleId);
      if (!existing) throw new NotFoundException('Maintenance record not found');

      const parts = dto.partsCost === undefined ? money(existing.partsCost) : dto.partsCost;
      const labor = dto.laborCost === undefined ? money(existing.laborCost) : dto.laborCost;

      /*
       * The total is kept unless it is sent — except when the split moved and
       * both halves are now known, where the old total may no longer be their
       * sum. It is added up again then, as on create, rather than refusing an
       * edit to the parts line for contradicting a total nobody retyped.
       */
      const splitMoved = dto.partsCost !== undefined || dto.laborCost !== undefined;
      const total =
        dto.totalCost ?? (splitMoved && parts !== null && labor !== null ? null : money(existing.totalCost)!);

      const figures: ServiceFigures = {
        type: dto.type ?? existing.type,
        performedAt: dto.performedAt ? new Date(dto.performedAt) : existing.performedAt,
        odometerKm: dto.odometerKm ?? existing.odometerKm,
        costs: costsOrThrow(parts, labor, total),
        serviceProvider: dto.serviceProvider === undefined ? existing.serviceProvider : dto.serviceProvider,
        description: dto.description === undefined ? existing.description : dto.description,
      };

      if (dto.scheduleId) await this.assertSchedule(tx, vehicleId, dto.scheduleId);

      // Moved when the mileage or the date does, and withdrawn first so it is
      // not checked against itself — the same rule as fuel and expenses.
      if (
        figures.odometerKm !== existing.odometerKm ||
        figures.performedAt.getTime() !== existing.performedAt.getTime()
      ) {
        await this.odometer.removeForSource(tx, vehicleId, OdometerSource.MAINTENANCE, id);
        await this.recordReading(tx, vehicleId, id, figures);
      }

      const { expenseId, dropExpense } = await this.settleExpense(tx, vehicleId, existing, figures);

      const changes: MaintenanceRecordChanges = {
        ...recordFields(figures),
        expenseId,
        ...(dto.scheduleId === undefined ? {} : { scheduleId: dto.scheduleId }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes }),
      };

      const updated = await this.records.update(tx, id, changes);
      // Only once the record no longer points at it, or the delete would
      // cascade to the record itself.
      if (dropExpense) await this.expenses.delete(tx, dropExpense);

      return updated;
    });

    return result;
  }

  async remove(vehicleId: string, id: string): Promise<void> {
    const receiptKeys = await this.prisma.$transaction(async (tx) => {
      const existing = await this.records.lock(tx, id, vehicleId);
      if (!existing) throw new NotFoundException('Maintenance record not found');

      // Read where the receipts are stored before their rows cascade away.
      const keys = existing.expenseId ? await this.expenses.documentKeys(tx, existing.expenseId) : [];

      await this.odometer.removeForSource(tx, vehicleId, OdometerSource.MAINTENANCE, id);
      await this.records.delete(tx, id);
      if (existing.expenseId) await this.expenses.delete(tx, existing.expenseId);

      return keys;
    });

    // After the commit, never inside it: see purgeObjects.
    await purgeObjects(this.storage, receiptKeys, this.logger);
  }

  async list(vehicleId: string, query: ListMaintenanceRecordsQueryDto): Promise<MaintenancePage> {
    const filter = { ...dateRange(query.from, query.to), type: query.type, provider: query.provider };

    const [records, total] = await Promise.all([
      this.records.list(vehicleId, filter, (query.page - 1) * query.limit, query.limit),
      this.records.count(vehicleId, filter),
    ]);

    return { records, total };
  }

  async suggestions(vehicleId: string): Promise<MaintenanceSuggestions> {
    const [vehicle, recentProviders] = await Promise.all([
      this.prisma.vehicle.findUniqueOrThrow({
        where: { id: vehicleId },
        select: { currentOdometerKm: true },
      }),
      this.records.recentProviders(vehicleId, 5),
    ]);
    return { currentOdometerKm: vehicle.currentOdometerKm, recentProviders };
  }

  /**
   * Brings the ledger in line with the record's new cost.
   *
   * Paid stays paid: the expense is updated. Free becomes paid: an expense is
   * created. Paid becomes free: the expense goes — unless receipts hang off
   * it, which would go with it; that is refused rather than done silently.
   */
  private async settleExpense(
    tx: Prisma.TransactionClient,
    vehicleId: string,
    existing: MaintenanceRecordRow,
    figures: ServiceFigures,
  ): Promise<{ expenseId: string | null; dropExpense: string | null }> {
    const paid = figures.costs.totalMillimes > 0;

    if (existing.expenseId && paid) {
      await this.expenses.update(tx, existing.expenseId, ledgerFields(figures));
      return { expenseId: existing.expenseId, dropExpense: null };
    }

    if (existing.expenseId && !paid) {
      const receipts = await this.expenses.documentKeys(tx, existing.expenseId);
      if (receipts.length > 0) {
        throw new ConflictException(
          'This service has receipts attached, and a free service has no expense to hold them. Remove the receipts first, or keep its cost.',
        );
      }
      return { expenseId: null, dropExpense: existing.expenseId };
    }

    if (paid) {
      return {
        expenseId: await this.createExpense(tx, vehicleId, existing.createdById, figures),
        dropExpense: null,
      };
    }

    return { expenseId: null, dropExpense: null };
  }

  private async createExpense(
    tx: Prisma.TransactionClient,
    vehicleId: string,
    userId: string | null,
    figures: ServiceFigures,
  ): Promise<string> {
    const expense = await this.expenses.create(tx, {
      vehicleId,
      createdById: userId,
      sourceType: ExpenseSource.MAINTENANCE,
      ...ledgerFields(figures),
      notes: null,
    });
    return expense.id;
  }

  /** A schedule on another vehicle is refused as if it did not exist, like every cross-vehicle id. */
  private async assertSchedule(
    tx: Prisma.TransactionClient,
    vehicleId: string,
    scheduleId: string,
  ): Promise<void> {
    const schedule = await this.schedules.findInVehicle(tx, scheduleId, vehicleId);
    if (!schedule)
      throw new BadRequestException('scheduleId does not name a maintenance schedule on this vehicle');
  }

  private async recordReading(
    tx: Prisma.TransactionClient,
    vehicleId: string,
    recordId: string,
    figures: ServiceFigures,
  ): Promise<void> {
    await this.odometer.recordIn(tx, vehicleId, {
      odometerKm: figures.odometerKm,
      recordedAt: figures.performedAt,
      source: OdometerSource.MAINTENANCE,
      sourceId: recordId,
    });
  }

  private async replay(vehicleId: string, recordId: string): Promise<CreatedMaintenanceRecord> {
    const record = await this.records.findInVehicle(this.prisma, recordId, vehicleId);

    if (!record) {
      throw new ConflictException(
        'The maintenance record created with this Idempotency-Key has since been deleted. Generate a new key to create it again.',
      );
    }

    return { record, replayed: true };
  }
}

function costsOrThrow(parts: string | null, labor: string | null, total: string | null): Costs {
  const result = resolveCosts({ parts, labor, total });
  if (!result.ok) throw new BadRequestException(result.message);
  return result.costs;
}

const money = (value: Prisma.Decimal | null): string | null => (value === null ? null : value.toFixed(3));
const moneyOrNull = (millimes: number | null): string | null =>
  millimes === null ? null : fromUnits(millimes, 3);

function recordFields(figures: ServiceFigures) {
  return {
    type: figures.type,
    performedAt: figures.performedAt,
    odometerKm: figures.odometerKm,
    partsCost: moneyOrNull(figures.costs.partsMillimes),
    laborCost: moneyOrNull(figures.costs.laborMillimes),
    totalCost: fromUnits(figures.costs.totalMillimes, 3),
    serviceProvider: figures.serviceProvider,
    description: figures.description,
  };
}

/** The ledger's view of a service: what it cost, when, where, filed under which category. */
function ledgerFields(figures: ServiceFigures) {
  return {
    category: ledgerCategory(figures.type),
    amount: fromUnits(figures.costs.totalMillimes, 3),
    incurredAt: figures.performedAt,
    odometerKm: figures.odometerKm,
    vendor: figures.serviceProvider,
    description: ledgerDescription(figures.type, figures.description),
  };
}

function dateRange(from?: string, to?: string): { from?: Date; to?: Date } {
  const start = from ? new Date(from) : undefined;
  const end = to ? new Date(to) : undefined;
  if (start && end && start > end) throw new BadRequestException('from must not be after to');
  return { from: start, to: end };
}
