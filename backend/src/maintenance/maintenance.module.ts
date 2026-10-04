import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../common/idempotency/idempotency.module.js';
import { ExpensesModule } from '../expenses/expenses.module.js';
import { OdometerModule } from '../odometer/odometer.module.js';
import { VehiclesModule } from '../vehicles/vehicles.module.js';
import { MaintenanceRecordAccessGuard } from './guards/maintenance-record-access.guard.js';
import { MaintenanceScheduleAccessGuard } from './guards/maintenance-schedule-access.guard.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceRepository } from './maintenance.repository.js';
import { MaintenanceService } from './maintenance.service.js';
import { SchedulesController } from './schedules.controller.js';
import { SchedulesRepository } from './schedules.repository.js';
import { SchedulesService } from './schedules.service.js';
import { VehicleMaintenanceController } from './vehicle-maintenance.controller.js';

@Module({
  imports: [VehiclesModule, OdometerModule, ExpensesModule, IdempotencyModule],
  controllers: [VehicleMaintenanceController, MaintenanceController, SchedulesController],
  providers: [
    MaintenanceService,
    SchedulesService,
    MaintenanceRepository,
    SchedulesRepository,
    MaintenanceRecordAccessGuard,
    MaintenanceScheduleAccessGuard,
  ],
  // The reminder sweep reads every active schedule's due state from here (Phase 7).
  exports: [SchedulesService],
})
export class MaintenanceModule {}
