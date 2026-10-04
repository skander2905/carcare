import { BadRequestException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUuid } from '../../common/validation/uuid.js';
import {
  type GuardedRequest,
  VehicleMembershipGuard,
} from '../../vehicles/guards/vehicle-membership.guard.js';
import { VehicleMemberRepository } from '../../vehicles/vehicle-member.repository.js';
import { RemindersRepository } from '../reminders.repository.js';

/**
 * Guards `/reminders/:id`, which names a reminder rather than a vehicle.
 * Absent and "not yours" both answer 404 "Reminder not found".
 */
@Injectable()
export class ReminderAccessGuard extends VehicleMembershipGuard {
  protected readonly notFoundMessage = 'Reminder not found';

  constructor(
    reflector: Reflector,
    members: VehicleMemberRepository,
    private readonly reminders: RemindersRepository,
  ) {
    super(reflector, members);
  }

  protected async resolveVehicleId(request: GuardedRequest): Promise<string | undefined> {
    const id = request.params.id;
    if (typeof id !== 'string' || id.length === 0) return undefined;
    if (!isUuid(id)) throw new BadRequestException('id must be a UUID');
    return (await this.reminders.vehicleIdOf(id)) ?? undefined;
  }
}
