import { Injectable } from '@nestjs/common';
import { type VehicleRole } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type VehicleMember } from '../prisma/model.types.js';

@Injectable()
export class VehicleMemberRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The single lookup every vehicle-scoped request makes. Served by the unique
   * index on `(vehicleId, userId)`, so it is one index probe — cacheable in
   * Redis later if it ever shows up in a profile.
   */
  findFor(vehicleId: string, userId: string): Promise<VehicleMember | null> {
    return this.prisma.vehicleMember.findUnique({
      where: { vehicleId_userId: { vehicleId, userId } },
    });
  }

  listForVehicle(vehicleId: string): Promise<VehicleMember[]> {
    return this.prisma.vehicleMember.findMany({
      where: { vehicleId },
      orderBy: { createdAt: 'asc' },
    });
  }

  add(vehicleId: string, userId: string, role: VehicleRole): Promise<VehicleMember> {
    return this.prisma.vehicleMember.create({ data: { vehicleId, userId, role } });
  }
}
