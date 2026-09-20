import { type ExecutionContext, InternalServerErrorException, createParamDecorator } from '@nestjs/common';
import { type RequestWithVehicleAccess, type VehicleAccess } from '../vehicle-access.types.js';

/**
 * Injects the resolved membership — the vehicle id the caller is *proven* to
 * reach, and the role they hold on it.
 *
 * Services take this id rather than a raw route parameter, so a query can only
 * ever be scoped by something authorisation has already checked.
 */
export const CurrentVehicle = createParamDecorator(
  (_data: unknown, context: ExecutionContext): VehicleAccess => {
    const request = context.switchToHttp().getRequest<RequestWithVehicleAccess>();

    if (!request.vehicleAccess) {
      throw new InternalServerErrorException(
        'CurrentVehicle used on a route that is not protected by VehicleAccessGuard',
      );
    }

    return request.vehicleAccess;
  },
);
