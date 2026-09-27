import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { ExpenseSource } from '../generated/prisma/enums.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { type OdometerService } from '../odometer/odometer.service.js';
import { type ObjectStorage } from '../storage/object-storage.js';
import { type PrismaService } from '../prisma/prisma.service.js';
import { type Expense } from '../prisma/model.types.js';
import { type CreateExpenseDto } from './dto/expense.dto.js';
import { type ExpensesRepository } from './expenses.repository.js';
import { CREATE_EXPENSE_SCOPE, ExpensesService } from './expenses.service.js';

const VEHICLE_ID = 'vehicle-1';
const USER_ID = 'user-1';
const dto = { category: 'TOLL', amount: '4.500' } as CreateExpenseDto;

const winner = { id: 'expense-won', vehicleId: VEHICLE_ID, sourceType: ExpenseSource.MANUAL } as Expense;

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

/**
 * The concurrent-retry branch of `create`, driven deterministically.
 *
 * The integration suite fires simultaneous requests, but over a local socket
 * they tend to arrive one after another — each retry then finds the key in the
 * up-front lookup and never reaches this branch. Here the interleaving is
 * forced: the lookup misses, and the transaction loses to the unique index.
 */
describe('ExpensesService.create under a concurrent retry', () => {
  let idempotency: IdempotencyService;
  let expenses: { findInVehicle: ReturnType<typeof vi.fn> };
  let prisma: { $transaction: ReturnType<typeof vi.fn> };
  let service: ExpensesService;

  beforeEach(() => {
    idempotency = new IdempotencyService({} as PrismaService);
    expenses = { findInVehicle: vi.fn().mockResolvedValue(winner) };
    prisma = { $transaction: vi.fn().mockRejectedValue(uniqueViolation()) };

    service = new ExpensesService(
      prisma as unknown as PrismaService,
      expenses as unknown as ExpensesRepository,
      {} as OdometerService,
      idempotency,
      { enabled: false } as ObjectStorage,
    );
  });

  const spentBy = (body: object) => ({
    id: 'key-row',
    userId: USER_ID,
    key: 'k',
    scope: CREATE_EXPENSE_SCOPE,
    requestHash: idempotency.fingerprint(CREATE_EXPENSE_SCOPE, VEHICLE_ID, body),
    resourceId: winner.id,
    createdAt: new Date(),
  });

  it('replays the request that won the race', async () => {
    vi.spyOn(idempotency, 'find').mockResolvedValueOnce(null).mockResolvedValueOnce(spentBy(dto));

    await expect(service.create(VEHICLE_ID, USER_ID, dto, 'k')).resolves.toEqual({
      expense: winner,
      replayed: true,
    });
  });

  it('still refuses the winner if it was a different request', async () => {
    vi.spyOn(idempotency, 'find')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(spentBy({ ...dto, amount: '9.000' }));

    await expect(service.create(VEHICLE_ID, USER_ID, dto, 'k')).rejects.toThrow('different request');
  });

  it('rethrows a unique violation when no key was sent — it is not ours to explain', async () => {
    const find = vi.spyOn(idempotency, 'find');

    await expect(service.create(VEHICLE_ID, USER_ID, dto)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(find).not.toHaveBeenCalled();
  });

  it('rethrows when the conflicting row cannot be found, rather than inventing a replay', async () => {
    vi.spyOn(idempotency, 'find').mockResolvedValue(null);

    await expect(service.create(VEHICLE_ID, USER_ID, dto, 'k')).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('reports a winner deleted in the meantime as a conflict', async () => {
    vi.spyOn(idempotency, 'find').mockResolvedValueOnce(null).mockResolvedValueOnce(spentBy(dto));
    expenses.findInVehicle.mockResolvedValue(null);

    await expect(service.create(VEHICLE_ID, USER_ID, dto, 'k')).rejects.toBeInstanceOf(ConflictException);
  });
});
