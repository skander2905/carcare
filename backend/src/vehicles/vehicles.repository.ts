import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { VehicleRole } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Vehicle } from '../prisma/model.types.js';

/**
 * The writable shape, spelled out rather than derived from Prisma's generated
 * input type. `ownerId` is supplied by `createOwned` and `currentOdometerKm` is
 * owned by OdometerService, so neither is a caller's to set.
 */
export type NewVehicle = Omit<Prisma.VehicleCreateManyInput, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>;

export type VehicleChanges = Omit<
  Prisma.VehicleUncheckedUpdateInput,
  'id' | 'ownerId' | 'createdAt' | 'updatedAt' | 'currentOdometerKm'
>;

@Injectable()
export class VehiclesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the vehicle and the owner's membership together.
   *
   * One transaction, because a vehicle with no `VehicleMember` row is a vehicle
   * nobody can reach — authorisation resolves only through that table, so the
   * creator would immediately 404 on the thing they just made, and its license
   * plate would still occupy the unique index.
   */
  createOwned(ownerId: string, data: NewVehicle): Promise<Vehicle> {
    return this.prisma.vehicle.create({
      data: {
        ...data,
        ownerId,
        members: { create: { userId: ownerId, role: VehicleRole.OWNER } },
      },
    });
  }

  /**
   * Every vehicle the user can reach, resolved through membership rather than
   * through `ownerId` — so a shared vehicle appears here the day sharing ships,
   * with no change to this query.
   */
  listForUser(userId: string, includeArchived: boolean): Promise<Vehicle[]> {
    return this.prisma.vehicle.findMany({
      where: {
        members: { some: { userId } },
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    });
  }

  findById(vehicleId: string): Promise<Vehicle | null> {
    return this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
  }

  update(vehicleId: string, data: VehicleChanges): Promise<Vehicle> {
    return this.prisma.vehicle.update({ where: { id: vehicleId }, data });
  }

  /** Cascades to memberships, odometer readings and every cost record. */
  async delete(vehicleId: string): Promise<void> {
    await this.prisma.vehicle.delete({ where: { id: vehicleId } });
  }
}
