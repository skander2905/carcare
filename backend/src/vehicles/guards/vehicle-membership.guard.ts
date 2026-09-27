import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { type Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { type RequestWithUser } from '../../auth/auth.types.js';
import { type VehicleRole } from '../../generated/prisma/enums.js';
import { VEHICLE_ROLE_KEY } from '../decorators/vehicle-role.decorator.js';
import { type VehicleMemberRepository } from '../vehicle-member.repository.js';
import { type RequestWithVehicleAccess, roleSatisfies } from '../vehicle-access.types.js';

export type GuardedRequest = Request & RequestWithUser & RequestWithVehicleAccess;

/**
 * Resolves `VehicleMember` for whichever vehicle a request is about, and refuses
 * it if there is no membership or the role is too low.
 *
 * This is the whole of ADR-006. Authorisation never reads `Vehicle.ownerId`:
 * that column says who bought the car, not who may see it, and checking it
 * inline works right up until the day sharing ships — at which point every call
 * site is a place to have forgotten.
 *
 * Subclasses differ only in how they find the vehicle. A nested collection
 * names it in the route; a top-level record (`/expenses/:id`) belongs to one,
 * and has to be looked up first. Either way the membership check, the 404
 * policy and the role rule are this class's, so there is exactly one of each.
 */
export abstract class VehicleMembershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly members: VehicleMemberRepository,
  ) {}

  /** What a caller without membership is told. Names the thing they asked for. */
  protected abstract readonly notFoundMessage: string;

  /**
   * The vehicle the request concerns, or `undefined` when there is none to be
   * found. Throwing is reserved for a malformed id, which is a 400.
   */
  protected abstract resolveVehicleId(request: GuardedRequest): Promise<string | undefined>;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardedRequest>();

    const user = request.user;
    // Only reachable if this guard is used without JwtAuthGuard, which is a
    // wiring mistake rather than something a caller can provoke.
    if (!user) throw new UnauthorizedException('Authentication required');

    const vehicleId = await this.resolveVehicleId(request);
    if (!vehicleId) throw new NotFoundException(this.notFoundMessage);

    const membership = await this.members.findFor(vehicleId, user.id);

    /*
     * 404, not 403.
     *
     * A 403 would confirm the id exists, which hands anyone probing for
     * identifiers a way to enumerate other people's records. To a caller with
     * no membership, someone else's vehicle — or expense — and one that was
     * never created are indistinguishable, which is exactly right.
     */
    if (!membership) throw new NotFoundException(this.notFoundMessage);

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
}
