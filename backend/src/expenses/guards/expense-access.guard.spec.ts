import {
  BadRequestException,
  type ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VehicleRole } from '../../generated/prisma/enums.js';
import { type VehicleMemberRepository } from '../../vehicles/vehicle-member.repository.js';
import { type ExpensesRepository } from '../expenses.repository.js';
import { ExpenseAccessGuard } from './expense-access.guard.js';

const EXPENSE_ID = '0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b';
const VEHICLE_ID = '0192f8c1-0000-7000-8000-000000000001';

function buildContext(params: Record<string, string>) {
  const request: Record<string, unknown> = { params, user: { id: 'user-1' } };

  return {
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext,
    request,
  };
}

describe('ExpenseAccessGuard', () => {
  let reflector: Reflector;
  let members: { findFor: ReturnType<typeof vi.fn> };
  let expenses: { vehicleIdOf: ReturnType<typeof vi.fn> };
  let guard: ExpenseAccessGuard;

  beforeEach(() => {
    reflector = new Reflector();
    members = { findFor: vi.fn() };
    expenses = { vehicleIdOf: vi.fn() };
    guard = new ExpenseAccessGuard(
      reflector,
      members as unknown as VehicleMemberRepository,
      expenses as unknown as ExpensesRepository,
    );
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
  });

  it("resolves the expense's vehicle and attaches the caller's access to it", async () => {
    expenses.vehicleIdOf.mockResolvedValue(VEHICLE_ID);
    members.findFor.mockResolvedValue({ role: VehicleRole.OWNER });
    const { context, request } = buildContext({ id: EXPENSE_ID });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(members.findFor).toHaveBeenCalledWith(VEHICLE_ID, 'user-1');
    expect(request.vehicleAccess).toEqual({ vehicleId: VEHICLE_ID, role: VehicleRole.OWNER });
  });

  /**
   * The two must be indistinguishable, or the lookup that happens before the
   * membership check becomes an oracle for which expense ids exist.
   */
  it('answers a missing expense and somebody else’s expense identically', async () => {
    expenses.vehicleIdOf.mockResolvedValueOnce(null);
    const missing = guard.canActivate(buildContext({ id: EXPENSE_ID }).context);
    await expect(missing).rejects.toThrow(new NotFoundException('Expense not found'));

    expenses.vehicleIdOf.mockResolvedValueOnce(VEHICLE_ID);
    members.findFor.mockResolvedValueOnce(null);
    const foreign = guard.canActivate(buildContext({ id: EXPENSE_ID }).context);
    await expect(foreign).rejects.toThrow(new NotFoundException('Expense not found'));
  });

  it('rejects a malformed id before touching the database', async () => {
    await expect(guard.canActivate(buildContext({ id: 'not-a-uuid' }).context)).rejects.toThrow(
      BadRequestException,
    );
    expect(expenses.vehicleIdOf).not.toHaveBeenCalled();
  });

  it('refuses a viewer a mutation with 403 — they can already see the expense', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(VehicleRole.EDITOR);
    expenses.vehicleIdOf.mockResolvedValue(VEHICLE_ID);
    members.findFor.mockResolvedValue({ role: VehicleRole.VIEWER });

    await expect(guard.canActivate(buildContext({ id: EXPENSE_ID }).context)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
