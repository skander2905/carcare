import { SetMetadata } from '@nestjs/common';
import { type VehicleRole } from '../../generated/prisma/enums.js';

export const VEHICLE_ROLE_KEY = 'vehicle:minimumRole';

/**
 * The least privileged role that may call this route.
 *
 * Absent, `VehicleAccessGuard` requires `VIEWER` — membership of any kind. The
 * default is the readable one, so forgetting the decorator on a mutation is the
 * only mistake available, and it is caught by the tests rather than by
 * silently granting access.
 */
export const MinimumVehicleRole = (role: VehicleRole) => SetMetadata(VEHICLE_ROLE_KEY, role);
