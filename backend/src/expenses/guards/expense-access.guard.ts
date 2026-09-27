import { BadRequestException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUuid } from '../../common/validation/uuid.js';
import {
  type GuardedRequest,
  VehicleMembershipGuard,
} from '../../vehicles/guards/vehicle-membership.guard.js';
import { VehicleMemberRepository } from '../../vehicles/vehicle-member.repository.js';
import { ExpensesRepository } from '../expenses.repository.js';

/**
 * Guards `/expenses/:id`, which names an expense rather than a vehicle.
 *
 * The expense is resolved to its vehicle and then put through exactly the same
 * membership check as every vehicle route. An expense that does not exist and
 * one on somebody else's car both answer 404 "Expense not found" — the lookup
 * happening first must not become a way to learn which ids are real.
 */
@Injectable()
export class ExpenseAccessGuard extends VehicleMembershipGuard {
  protected readonly notFoundMessage = 'Expense not found';

  constructor(
    reflector: Reflector,
    members: VehicleMemberRepository,
    private readonly expenses: ExpensesRepository,
  ) {
    super(reflector, members);
  }

  protected async resolveVehicleId(request: GuardedRequest): Promise<string | undefined> {
    const id = request.params.id;
    if (typeof id !== 'string' || id.length === 0) return undefined;

    // Validated before the lookup, for the same reason as VehicleAccessGuard:
    // guards run before pipes, and a malformed id would otherwise reach
    // Postgres as a failed uuid cast.
    if (!isUuid(id)) throw new BadRequestException('id must be a UUID');

    return (await this.expenses.vehicleIdOf(id)) ?? undefined;
  }
}
