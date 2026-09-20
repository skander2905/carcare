import { Module, forwardRef } from '@nestjs/common';
import { VehiclesModule } from '../vehicles/vehicles.module.js';
import { OdometerController } from './odometer.controller.js';
import { OdometerRepository } from './odometer.repository.js';
import { OdometerService } from './odometer.service.js';

/**
 * Circular by nature and by design: creating a vehicle seeds its first reading,
 * and reading the timeline needs the vehicle's access guard. `forwardRef` is the
 * honest way to express that, rather than merging two modules that have
 * genuinely different jobs.
 */
@Module({
  imports: [forwardRef(() => VehiclesModule)],
  controllers: [OdometerController],
  providers: [OdometerService, OdometerRepository],
  exports: [OdometerService],
})
export class OdometerModule {}
