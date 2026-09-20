import { type VehicleRole } from '../generated/prisma/enums.js';

/** Attached to the request once `VehicleAccessGuard` has resolved membership. */
export interface VehicleAccess {
  vehicleId: string;
  role: VehicleRole;
}

export interface RequestWithVehicleAccess {
  vehicleAccess?: VehicleAccess;
}

/**
 * Least to most privileged. Comparing positions keeps the guard from
 * enumerating every role pair, and adding a role later is one array entry
 * rather than a new branch in every check.
 */
const ROLE_RANK: Record<VehicleRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  OWNER: 2,
};

export function roleSatisfies(held: VehicleRole, required: VehicleRole): boolean {
  return ROLE_RANK[held] >= ROLE_RANK[required];
}
