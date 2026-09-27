import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { ExpenseSource, OdometerSource } from '../generated/prisma/enums.js';
import { IdempotencyService, type IdempotentRequest } from '../common/idempotency/idempotency.service.js';
import { OdometerService } from '../odometer/odometer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ObjectStorage } from '../storage/object-storage.js';
import { purgeObjects } from '../storage/purge.js';
import {
  type CreateExpenseDto,
  type ListExpensesQueryDto,
  type UpdateExpenseDto,
} from './dto/expense.dto.js';
import {
  type ExpenseChanges,
  type ExpenseWithAttachments,
  ExpensesRepository,
} from './expenses.repository.js';

export const CREATE_EXPENSE_SCOPE = 'expense.create';

export interface CreatedExpense {
  expense: ExpenseWithAttachments;
  /** True when an `Idempotency-Key` matched an earlier request. */
  replayed: boolean;
}

export interface ExpensePage {
  expenses: ExpenseWithAttachments[];
  total: number;
}

/**
 * The cost ledger (ADR-004).
 *
 * Every write that touches mileage runs in one transaction with its odometer
 * reading, so the ledger and the timeline cannot disagree: an expense whose
 * mileage does not fit the timeline is refused whole, rather than saved with
 * the reading quietly dropped.
 */
@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: ExpensesRepository,
    private readonly odometer: OdometerService,
    private readonly idempotency: IdempotencyService,
    private readonly storage: ObjectStorage,
  ) {}

  async create(
    vehicleId: string,
    userId: string,
    dto: CreateExpenseDto,
    idempotencyKey?: string,
  ): Promise<CreatedExpense> {
    const idempotent: IdempotentRequest | undefined = idempotencyKey
      ? {
          userId,
          key: idempotencyKey,
          scope: CREATE_EXPENSE_SCOPE,
          requestHash: this.idempotency.fingerprint(CREATE_EXPENSE_SCOPE, vehicleId, dto),
        }
      : undefined;

    // The common retry: the first attempt committed and only its response was
    // lost. Answering from the stored key costs one indexed read.
    if (idempotent) {
      const spent = await this.idempotency.find(userId, idempotent.key);
      if (spent) return this.replay(vehicleId, this.idempotency.replayedResourceId(spent, idempotent));
    }

    try {
      const expense = await this.prisma.$transaction(async (tx) => {
        const created = await this.expenses.create(tx, {
          vehicleId,
          createdById: userId,
          category: dto.category,
          amount: dto.amount,
          // Defaulted here rather than in the DTO so "now" is the moment the
          // server handled it, not the moment the payload was validated.
          incurredAt: dto.incurredAt ? new Date(dto.incurredAt) : new Date(),
          odometerKm: dto.odometerKm ?? null,
          description: dto.description ?? null,
          vendor: dto.vendor ?? null,
          notes: dto.notes ?? null,
          sourceType: ExpenseSource.MANUAL,
        });

        if (created.odometerKm !== null) {
          await this.recordReading(tx, vehicleId, { ...created, odometerKm: created.odometerKm });
        }
        if (idempotent) await this.idempotency.remember(tx, idempotent, created.id);

        return created;
      });

      return { expense, replayed: false };
    } catch (error) {
      /*
       * The concurrent retry: both requests missed the lookup above, and the
       * key's unique index let exactly one commit. This one rolled back —
       * expense and reading included — so replaying the winner is safe.
       */
      if (idempotent && this.idempotency.isConflict(error)) {
        const winner = await this.idempotency.find(userId, idempotent.key);
        if (winner) return this.replay(vehicleId, this.idempotency.replayedResourceId(winner, idempotent));
      }
      throw error;
    }
  }

  async findOne(vehicleId: string, id: string): Promise<ExpenseWithAttachments> {
    const expense = await this.expenses.findInVehicle(this.prisma, id, vehicleId);
    // Reachable only if it was deleted between the guard and this read.
    if (!expense) throw new NotFoundException('Expense not found');

    return expense;
  }

  async update(vehicleId: string, id: string, dto: UpdateExpenseDto): Promise<ExpenseWithAttachments> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.lockEditable(tx, vehicleId, id);

      const incurredAt = dto.incurredAt ? new Date(dto.incurredAt) : existing.incurredAt;
      const odometerKm = dto.odometerKm === undefined ? existing.odometerKm : dto.odometerKm;

      /*
       * The reading moves when the mileage changes, or when the date changes
       * under an unchanged mileage — a reading sits on the timeline by date, so
       * the same kilometres on a different day are a different point, and have
       * to be validated against different neighbours.
       */
      const readingMoves =
        odometerKm !== existing.odometerKm ||
        (odometerKm !== null && incurredAt.getTime() !== existing.incurredAt.getTime());

      if (readingMoves) {
        // Withdrawn first, so the new value is checked against its neighbours
        // rather than against the reading it is replacing.
        if (existing.odometerKm !== null) {
          await this.odometer.removeForSource(tx, vehicleId, OdometerSource.EXPENSE, id);
        }
        if (odometerKm !== null) {
          await this.recordReading(tx, vehicleId, { id, odometerKm, incurredAt });
        }
      }

      const changes: ExpenseChanges = {
        ...(dto.category === undefined ? {} : { category: dto.category }),
        ...(dto.amount === undefined ? {} : { amount: dto.amount }),
        ...(dto.incurredAt === undefined ? {} : { incurredAt }),
        ...(dto.odometerKm === undefined ? {} : { odometerKm: dto.odometerKm }),
        ...(dto.description === undefined ? {} : { description: dto.description }),
        ...(dto.vendor === undefined ? {} : { vendor: dto.vendor }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes }),
      };

      return this.expenses.update(tx, id, changes);
    });
  }

  async remove(vehicleId: string, id: string): Promise<void> {
    const attachmentKeys = await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockEditable(tx, vehicleId, id);
      // Read inside the transaction, before the document rows cascade away
      // with the expense — afterwards there is nothing left to say where the
      // files are.
      const keys = await this.expenses.documentKeys(tx, id);

      // The reading goes with the expense, or the timeline keeps a point whose
      // source no longer exists — and the vehicle's headline mileage may rest
      // on it.
      if (existing.odometerKm !== null) {
        await this.odometer.removeForSource(tx, vehicleId, OdometerSource.EXPENSE, id);
      }

      await this.expenses.delete(tx, id);
      return keys;
    });

    // After the commit, never inside it: see purgeObjects.
    await purgeObjects(this.storage, attachmentKeys, this.logger);
  }

  async list(vehicleId: string, query: ListExpensesQueryDto): Promise<ExpensePage> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    // An inverted range is a client bug; an empty page would hide it.
    if (from && to && from > to) throw new BadRequestException('from must not be after to');

    const filter = { category: query.category, from, to, search: query.search };

    const [expenses, total] = await Promise.all([
      this.expenses.list(vehicleId, {
        ...filter,
        sort: query.sort,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.expenses.count(vehicleId, filter),
    ]);

    return { expenses, total };
  }

  /**
   * Locks the expense and confirms it may be changed directly.
   *
   * A fuel- or maintenance-derived expense mirrors a record that owns it. Edit
   * it here and the fuel entry still says 42 litres for 90 TND while the
   * ledger says 60 — the double-counting ADR-004 warns about. Nothing writes
   * those rows until Phases 5 and 6; the rule is enforced now so they do not
   * have to remember it.
   */
  private async lockEditable(
    tx: Prisma.TransactionClient,
    vehicleId: string,
    id: string,
  ): Promise<ExpenseWithAttachments> {
    const expense = await this.expenses.lock(tx, id, vehicleId);
    if (!expense) throw new NotFoundException('Expense not found');

    if (expense.sourceType !== ExpenseSource.MANUAL) {
      const owner = expense.sourceType === ExpenseSource.FUEL ? 'fuel entry' : 'maintenance record';
      throw new ConflictException(`This expense belongs to a ${owner}; change it there instead`);
    }

    return expense;
  }

  private async recordReading(
    tx: Prisma.TransactionClient,
    vehicleId: string,
    expense: Pick<ExpenseWithAttachments, 'id' | 'incurredAt'> & { odometerKm: number },
  ): Promise<void> {
    await this.odometer.recordIn(tx, vehicleId, {
      odometerKm: expense.odometerKm,
      recordedAt: expense.incurredAt,
      source: OdometerSource.EXPENSE,
      sourceId: expense.id,
    });
  }

  /**
   * The expense an earlier request with the same key created.
   *
   * Looked up within the vehicle, because the fingerprint already ties the key
   * to this vehicle — a miss therefore means it has since been deleted, and
   * recreating it silently would resurrect something the user removed.
   */
  private async replay(vehicleId: string, expenseId: string): Promise<CreatedExpense> {
    const expense = await this.expenses.findInVehicle(this.prisma, expenseId, vehicleId);

    if (!expense) {
      throw new ConflictException(
        'The expense created with this Idempotency-Key has since been deleted. Generate a new key to create it again.',
      );
    }

    return { expense, replayed: true };
  }
}
