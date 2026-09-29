import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../common/idempotency/idempotency.module.js';
import { ExpensesModule } from '../expenses/expenses.module.js';
import { OdometerModule } from '../odometer/odometer.module.js';
import { VehiclesModule } from '../vehicles/vehicles.module.js';
import { FuelController } from './fuel.controller.js';
import { FuelRepository } from './fuel.repository.js';
import { FuelService } from './fuel.service.js';
import { FuelEntryAccessGuard } from './guards/fuel-entry-access.guard.js';
import { VehicleFuelController } from './vehicle-fuel.controller.js';

@Module({
  imports: [VehiclesModule, OdometerModule, ExpensesModule, IdempotencyModule],
  controllers: [VehicleFuelController, FuelController],
  providers: [FuelService, FuelRepository, FuelEntryAccessGuard],
})
export class FuelModule {}
