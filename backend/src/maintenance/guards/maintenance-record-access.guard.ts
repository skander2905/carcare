import { BadRequestException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUuid } from '../../common/validation/uuid.js';
import {
  type GuardedRequest,
  VehicleMembershipGuard,
} from '../../vehicles/guards/vehicle-membership.guard.js';
import { VehicleMemberRepository } from '../../vehicles/vehicle-member.repository.js';
import { MaintenanceRepository } from '../maintenance.repository.js';

/**
 * Guards `/maintenance/:id`, which names a maintenance record rather than a vehicle.
 *
 * Resolved to its vehicle, then put through the same membership check as every
 * vehicle route — so absent and "not yours" both answer 404 "Maintenance record not found".
 */
@Injectable()
export class MaintenanceRecordAccessGuard extends VehicleMembershipGuard {
  protected readonly notFoundMessage = 'Maintenance record not found';

  constructor(
    reflector: Reflector,
    members: VehicleMemberRepository,
    private readonly records: MaintenanceRepository,
  ) {
    super(reflector, members);
  }

  protected async resolveVehicleId(request: GuardedRequest): Promise<string | undefined> {
    const id = request.params.id;
    if (typeof id !== 'string' || id.length === 0) return undefined;

    // Before the lookup: guards run before pipes, and a malformed id would
    // otherwise reach Postgres as a failed uuid cast.
    if (!isUuid(id)) throw new BadRequestException('id must be a UUID');

    return (await this.records.vehicleIdOf(id)) ?? undefined;
  }
}
