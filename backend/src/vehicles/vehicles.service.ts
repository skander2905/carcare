import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { OdometerService } from '../odometer/odometer.service.js';
import { ObjectStorage } from '../storage/object-storage.js';
import { purgeObjects } from '../storage/purge.js';
import { type CreateVehicleDto, type UpdateVehicleDto } from './dto/vehicle.dto.js';
import { type VehicleWithCurrency, VehiclesRepository } from './vehicles.repository.js';

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    private readonly vehicles: VehiclesRepository,
    private readonly odometer: OdometerService,
    private readonly storage: ObjectStorage,
  ) {}

  async create(ownerId: string, dto: CreateVehicleDto): Promise<VehicleWithCurrency> {
    const { initialOdometerKm, ...fields } = dto;

    let vehicle: VehicleWithCurrency;

    try {
      vehicle = await this.vehicles.createOwned(ownerId, {
        ...fields,
        ...(fields.purchaseDate ? { purchaseDate: new Date(fields.purchaseDate) } : {}),
        currentOdometerKm: initialOdometerKm ?? 0,
      });
    } catch (error) {
      // The unique index on (ownerId, licensePlate) is the authority. Checking
      // first would still race, and the constraint cannot be raced.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        throw new ConflictException('You already have a vehicle with that licence plate');
      }
      throw error;
    }

    // The starting mileage is a reading like any other, so the timeline has a
    // first point and "distance since I got the car" is answerable from day one.
    //
    // Zero counts. A car delivered new genuinely starts at 0 km, and skipping
    // it would leave the vehicle reporting 0 with an empty timeline — after
    // which the next reading looks like the first and the distance covered in
    // between is lost.
    if (initialOdometerKm !== undefined) {
      await this.odometer.seed(vehicle.id, initialOdometerKm, vehicle.purchaseDate ?? vehicle.createdAt);
    }

    return vehicle;
  }

  list(userId: string, includeArchived: boolean): Promise<VehicleWithCurrency[]> {
    return this.vehicles.listForUser(userId, includeArchived);
  }

  /**
   * The id has already been authorised by `VehicleAccessGuard`, so a missing
   * row here means it was deleted between the guard and this read.
   */
  async findOne(vehicleId: string): Promise<VehicleWithCurrency> {
    const vehicle = await this.vehicles.findById(vehicleId);
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    return vehicle;
  }

  async update(vehicleId: string, dto: UpdateVehicleDto): Promise<VehicleWithCurrency> {
    const { isArchived, purchaseDate, ...fields } = dto;

    try {
      return await this.vehicles.update(vehicleId, {
        ...fields,
        ...(purchaseDate === undefined ? {} : { purchaseDate: purchaseDate ? new Date(purchaseDate) : null }),
        // Archiving is a PATCH rather than its own endpoint, and it is
        // reversible: selling a car must not destroy what it cost to run.
        ...(isArchived === undefined ? {} : { archivedAt: isArchived ? new Date() : null }),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        throw new ConflictException('You already have a vehicle with that licence plate');
      }
      throw error;
    }
  }

  /**
   * Permanent, and cascades to every cost record the vehicle owns.
   *
   * Archiving is the reversible option and what the UI offers first; this is
   * for a vehicle that was entered by mistake.
   */
  async remove(vehicleId: string): Promise<void> {
    // Collected in the deleting transaction: once the vehicle is gone, its
    // document rows are too, and nothing would say where the files are.
    const keys = await this.vehicles.deleteReturningDocumentKeys(vehicleId);

    // After the commit, never inside it: see purgeObjects. A file still being
    // PUT through an already-issued upload URL can land after this — only the
    // Phase 7 sweep can reclaim that one.
    await purgeObjects(this.storage, keys, this.logger);
  }
}
