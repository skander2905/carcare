import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { type VehicleRole } from '../../generated/prisma/enums.js';
import { type RequestWithUser } from '../../auth/auth.types.js';
import { VehicleMemberRepository } from '../vehicle-member.repository.js';
import { VEHICLE_ROLE_KEY } from '../decorators/vehicle-role.decorator.js';
import { type RequestWithVehicleAccess, roleSatisfies } from '../vehicle-access.types.js';

/**
 * Resolves `VehicleMember` for the vehicle named in the route, and refuses the
 * request if there is no membership or the role is too low.
 *
 * This is the whole of ADR-006. Authorisation never reads `Vehicle.ownerId`:
 * that column says who bought the car, not who may see it, and checking it
 * inline works right up until the day sharing ships — at which point every call
 * site is a place to have forgotten.
 */
/** Any RFC 4122 variant, so v4 and v7 ids both pass. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class VehicleAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly members: VehicleMemberRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & RequestWithUser & RequestWithVehicleAccess>();

    const user = request.user;
    // Only reachable if this guard is used without JwtAuthGuard, which is a
    // wiring mistake rather than something a caller can provoke.
    if (!user) throw new UnauthorizedException('Authentication required');

    const vehicleId = this.readVehicleId(request);
    if (!vehicleId) throw new NotFoundException('Vehicle not found');

    /*
     * Shape-checked here, not by a `ParseUUIDPipe` on the parameter.
     *
     * Guards run before pipes, so by the time a pipe could reject a malformed
     * id this guard has already handed it to the database — where it becomes a
     * failed uuid cast and a 500 rather than a clean rejection. The first thing
     * to touch an untrusted id has to be the thing that validates it.
     */
    if (!UUID_PATTERN.test(vehicleId)) {
      throw new BadRequestException('vehicleId must be a UUID');
    }

    const membership = await this.members.findFor(vehicleId, user.id);

    /*
     * 404, not 403.
     *
     * A 403 would confirm the id exists, which hands anyone probing for
     * identifiers a way to enumerate other people's vehicles. To a caller with
     * no membership, someone else's vehicle and a vehicle that was never
     * created are indistinguishable — which is exactly right.
     */
    if (!membership) throw new NotFoundException('Vehicle not found');

    const required = this.reflector.getAllAndOverride<VehicleRole>(VEHICLE_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // 403 here is safe and correct: they already know the vehicle exists,
    // because they can see it. What they lack is permission to do this to it.
    if (required && !roleSatisfies(membership.role, required)) {
      throw new ForbiddenException('You do not have permission to do that on this vehicle');
    }

    request.vehicleAccess = { vehicleId, role: membership.role };
    return true;
  }

  /**
   * `:id` inside the vehicles controller, `:vehicleId` on nested collections
   * (`/vehicles/:vehicleId/odometer`). Both name the same thing, and every
   * feature module from Phase 4 onwards mounts under the nested form.
   */
  private readVehicleId(request: Request): string | undefined {
    const params = request.params;
    const candidate = params.vehicleId ?? params.id;

    return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
  }
}
