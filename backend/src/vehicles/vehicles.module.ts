import { Module, forwardRef } from '@nestjs/common';
import { OdometerModule } from '../odometer/odometer.module.js';
import { VehicleAccessGuard } from './guards/vehicle-access.guard.js';
import { VehicleMemberRepository } from './vehicle-member.repository.js';
import { VehiclesController } from './vehicles.controller.js';
import { VehiclesRepository } from './vehicles.repository.js';
import { VehiclesService } from './vehicles.service.js';

@Module({
  imports: [forwardRef(() => OdometerModule)],
  controllers: [VehiclesController],
  providers: [VehiclesService, VehiclesRepository, VehicleMemberRepository, VehicleAccessGuard],
  /*
   * The guard and the membership repository are exported because every
   * vehicle-scoped module from Phase 4 onwards mounts under
   * `/vehicles/:vehicleId/...` and needs exactly this check. Exporting them is
   * what keeps ADR-006's "one authority" true as the surface grows.
   */
  exports: [VehiclesService, VehicleAccessGuard, VehicleMemberRepository],
})
export class VehiclesModule {}
