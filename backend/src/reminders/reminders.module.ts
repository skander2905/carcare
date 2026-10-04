import { Module } from '@nestjs/common';
import { MaintenanceModule } from '../maintenance/maintenance.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { VehiclesModule } from '../vehicles/vehicles.module.js';
import { DueSweepService } from './due-sweep.service.js';
import { ReminderAccessGuard } from './guards/reminder-access.guard.js';
import { RemindersController } from './reminders.controller.js';
import { RemindersRepository } from './reminders.repository.js';
import { RemindersService } from './reminders.service.js';
import { VehicleRemindersController } from './vehicle-reminders.controller.js';

@Module({
  imports: [VehiclesModule, MaintenanceModule, NotificationsModule],
  controllers: [VehicleRemindersController, RemindersController],
  providers: [RemindersService, RemindersRepository, ReminderAccessGuard, DueSweepService],
  // The worker's jobs drive the sweep.
  exports: [DueSweepService],
})
export class RemindersModule {}
