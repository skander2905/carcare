import { Injectable } from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { DocumentStatus, type ExpenseCategory } from '../generated/prisma/enums.js';
import { type PrismaLike } from '../odometer/odometer.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Expense } from '../prisma/model.types.js';
import { type ExpenseSort } from './dto/expense.dto.js';

/**
 * Every expense read carries how many ready attachments it has, so the ledger
 * can show a paperclip without a request per row. Pending and failed uploads
 * are not attachments yet, and are not counted.
 */
const WITH_ATTACHMENT_COUNT = {
  _count: { select: { documents: { where: { status: DocumentStatus.READY } } } },
} as const;

export type ExpenseWithAttachments = Expense & { _count: { documents: number } };

export type NewExpense = Omit<Prisma.ExpenseUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>;

export type ExpenseChanges = Pick<
  Prisma.ExpenseUncheckedUpdateInput,
  'category' | 'amount' | 'incurredAt' | 'odometerKm' | 'description' | 'vendor' | 'notes'
>;

export interface ExpenseFilter {
  category?: ExpenseCategory;
  from?: Date;
  to?: Date;
  search?: string;
}

export interface ExpensePageRequest extends ExpenseFilter {
  sort: ExpenseSort;
  skip: number;
  take: number;
}

@Injectable()
export class ExpensesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The vehicle an expense belongs to — the one lookup `ExpenseAccessGuard`
   * makes before membership is known, so it reads nothing else.
   */
  async vehicleIdOf(id: string): Promise<string | null> {
    const row = await this.prisma.expense.findUnique({ where: { id }, select: { vehicleId: true } });
    return row?.vehicleId ?? null;
  }

  /**
   * Scoped by vehicle as well as id, always.
   *
   * The guard has already proved the caller may reach `vehicleId`; requiring
   * the expense to belong to it means an id can only ever resolve inside a
   * vehicle that authorisation checked.
   */
  findInVehicle(client: PrismaLike, id: string, vehicleId: string): Promise<ExpenseWithAttachments | null> {
    return client.expense.findFirst({ where: { id, vehicleId }, include: WITH_ATTACHMENT_COUNT });
  }

  /**
   * Row-locks the expense for the rest of the transaction, so two edits to the
   * same expense apply one after the other rather than both computing their
   * odometer changes from the same stale row.
   */
  async lock(
    tx: Prisma.TransactionClient,
    id: string,
    vehicleId: string,
  ): Promise<ExpenseWithAttachments | null> {
    await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id}::uuid AND "vehicleId" = ${vehicleId}::uuid FOR UPDATE`;
    return this.findInVehicle(tx, id, vehicleId);
  }

  create(client: PrismaLike, data: NewExpense): Promise<ExpenseWithAttachments> {
    return client.expense.create({ data, include: WITH_ATTACHMENT_COUNT });
  }

  update(client: PrismaLike, id: string, data: ExpenseChanges): Promise<ExpenseWithAttachments> {
    return client.expense.update({ where: { id }, data, include: WITH_ATTACHMENT_COUNT });
  }

  /** Where an expense's files are stored, read before the rows cascade away. */
  async documentKeys(client: PrismaLike, expenseId: string): Promise<string[]> {
    const rows = await client.document.findMany({ where: { expenseId }, select: { storageKey: true } });
    return rows.map((row) => row.storageKey);
  }

  async delete(client: PrismaLike, id: string): Promise<void> {
    await client.expense.delete({ where: { id } });
  }

  list(vehicleId: string, request: ExpensePageRequest): Promise<ExpenseWithAttachments[]> {
    return this.prisma.expense.findMany({
      where: this.where(vehicleId, request),
      orderBy: this.orderBy(request.sort),
      skip: request.skip,
      take: request.take,
      include: WITH_ATTACHMENT_COUNT,
    });
  }

  count(vehicleId: string, filter: ExpenseFilter): Promise<number> {
    return this.prisma.expense.count({ where: this.where(vehicleId, filter) });
  }

  private where(vehicleId: string, { category, from, to, search }: ExpenseFilter): Prisma.ExpenseWhereInput {
    const pattern = search ? escapeLike(search) : undefined;

    return {
      vehicleId,
      ...(category ? { category } : {}),
      ...(from || to
        ? {
            incurredAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(pattern
        ? {
            OR: [
              { description: { contains: pattern, mode: 'insensitive' } },
              { vendor: { contains: pattern, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  /**
   * Every sort ends on `id`, so rows that tie on the chosen column keep a fixed
   * order between requests. Without it, two expenses on the same day can swap
   * places from one page to the next — one appears twice, the other never.
   * Ids are UUIDv7, so the tie-break is also insertion order.
   */
  private orderBy(sort: ExpenseSort): Prisma.ExpenseOrderByWithRelationInput[] {
    const [column, direction] = sort.split(':') as ['incurredAt' | 'amount' | 'createdAt', 'asc' | 'desc'];

    return column === 'incurredAt'
      ? [{ incurredAt: direction }, { id: direction }]
      : [{ [column]: direction }, { incurredAt: 'desc' }, { id: 'desc' }];
  }
}

/**
 * `contains` becomes `ILIKE '%…%'`, where `%` and `_` are wildcards. Escaped,
 * a search for "50%" finds "50% off" rather than every vendor with a 50 in it.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
