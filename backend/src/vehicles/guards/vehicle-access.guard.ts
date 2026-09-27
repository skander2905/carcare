import { BadRequestException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUuid } from '../../common/validation/uuid.js';
import { VehicleMemberRepository } from '../vehicle-member.repository.js';
import { type GuardedRequest, VehicleMembershipGuard } from './vehicle-membership.guard.js';

/**
 * Guards routes that name the vehicle directly: `/vehicles/:id` and every
 * nested collection under `/vehicles/:vehicleId/...`.
 */
@Injectable()
export class VehicleAccessGuard extends VehicleMembershipGuard {
  protected readonly notFoundMessage = 'Vehicle not found';

  constructor(reflector: Reflector, members: VehicleMemberRepository) {
    super(reflector, members);
  }

  /**
   * `:id` inside the vehicles controller, `:vehicleId` on nested collections
   * (`/vehicles/:vehicleId/odometer`). Both name the same thing, and every
   * feature module from Phase 4 onwards mounts under the nested form.
   */
  protected resolveVehicleId(request: GuardedRequest): Promise<string | undefined> {
    const params = request.params;
    const candidate = params.vehicleId ?? params.id;

    if (typeof candidate !== 'string' || candidate.length === 0) return Promise.resolve(undefined);

    /*
     * Shape-checked here, not by a `ParseUUIDPipe` on the parameter.
     *
     * Guards run before pipes, so by the time a pipe could reject a malformed
     * id this guard has already handed it to the database — where it becomes a
     * failed uuid cast and a 500 rather than a clean rejection. The first thing
     * to touch an untrusted id has to be the thing that validates it.
     */
    if (!isUuid(candidate)) throw new BadRequestException('vehicleId must be a UUID');

    return Promise.resolve(candidate);
  }
}
