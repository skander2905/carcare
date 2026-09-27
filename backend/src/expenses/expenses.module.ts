import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../common/idempotency/idempotency.module.js';
import { OdometerModule } from '../odometer/odometer.module.js';
import { VehiclesModule } from '../vehicles/vehicles.module.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpensesRepository } from './expenses.repository.js';
import { ExpensesService } from './expenses.service.js';
import { ExpenseAccessGuard } from './guards/expense-access.guard.js';
import { VehicleExpensesController } from './vehicle-expenses.controller.js';

@Module({
  imports: [VehiclesModule, OdometerModule, IdempotencyModule],
  controllers: [VehicleExpensesController, ExpensesController],
  providers: [ExpensesService, ExpensesRepository, ExpenseAccessGuard],
  // Fuel and maintenance (Phases 5 and 6) write their 1:1 ledger row through
  // this module rather than touching the table themselves.
  exports: [ExpensesService, ExpensesRepository],
})
export class ExpensesModule {}
