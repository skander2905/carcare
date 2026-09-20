import { BadRequestException, Injectable } from '@nestjs/common';
import { OdometerSource } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type OdometerReading } from '../prisma/model.types.js';
import { describeConflict, findTimelineConflict, nextCurrentOdometer } from './domain/odometer-timeline.js';
import { OdometerRepository, type NewReading } from './odometer.repository.js';

export interface RecordReadingInput {
  odometerKm: number;
  recordedAt: Date;
  source?: OdometerSource;
  sourceId?: string;
  notes?: string;
}

export interface ReadingPage {
  readings: OdometerReading[];
  total: number;
}

/**
 * The one place mileage is written.
 *
 * From Phase 5 onwards fuel entries, expenses, maintenance records and trips
 * all carry an odometer value, and every one of them will come through here
 * inside its own transaction. Keeping the validation and the denormalised
 * `Vehicle.currentOdometerKm` update in a single service is what stops five
 * call sites drifting into five slightly different rules.
 */
@Injectable()
export class OdometerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readings: OdometerRepository,
  ) {}

  async record(vehicleId: string, input: RecordReadingInput): Promise<OdometerReading> {
    return this.prisma.$transaction(async (tx) => {
      // Serialise concurrent writes for this vehicle before reading anything
      // the decision depends on.
      await this.readings.lockVehicle(tx, vehicleId);

      const [previous, next] = await Promise.all([
        this.readings.previousReading(tx, vehicleId, input.recordedAt),
        this.readings.nextReading(tx, vehicleId, input.recordedAt),
      ]);

      const conflict = findTimelineConflict(input.odometerKm, previous, next);

      // A 400 with an actionable message, not a 422: the value is the wrong
      // shape for this timeline, and the message names the reading in the way.
      if (conflict) throw new BadRequestException(describeConflict(conflict));

      const data: NewReading = {
        vehicleId,
        recordedAt: input.recordedAt,
        odometerKm: input.odometerKm,
        source: input.source ?? OdometerSource.MANUAL,
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      };

      const reading = await this.readings.create(tx, data);

      // Same transaction as the reading, so the headline figure and the
      // timeline cannot disagree even if the process dies here.
      const vehicle = await tx.vehicle.findUniqueOrThrow({
        where: { id: vehicleId },
        select: { currentOdometerKm: true },
      });

      const current = nextCurrentOdometer(vehicle.currentOdometerKm, input.odometerKm);

      if (current !== vehicle.currentOdometerKm) {
        await tx.vehicle.update({ where: { id: vehicleId }, data: { currentOdometerKm: current } });
      }

      return reading;
    });
  }

  /**
   * The first point on a new vehicle's timeline.
   *
   * Separate from `record` because there is nothing to validate against and no
   * concurrency to serialise — the vehicle was created moments ago and nothing
   * else can have written to it yet.
   */
  async seed(vehicleId: string, odometerKm: number, recordedAt: Date): Promise<OdometerReading> {
    return this.readings.create(this.prisma, {
      vehicleId,
      recordedAt,
      odometerKm,
      source: OdometerSource.MANUAL,
      notes: 'Starting mileage',
    });
  }

  async list(
    vehicleId: string,
    from: Date | undefined,
    to: Date | undefined,
    page: number,
    limit: number,
  ): Promise<ReadingPage> {
    const filter = { from, to, skip: (page - 1) * limit, take: limit };

    const [readings, total] = await Promise.all([
      this.readings.list(vehicleId, filter),
      this.readings.count(vehicleId, { from, to }),
    ]);

    return { readings, total };
  }
}
