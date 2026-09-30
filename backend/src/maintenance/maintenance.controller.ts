import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/http/api-error.js';
import { VehicleRole } from '../generated/prisma/enums.js';
import { CurrentVehicle } from '../vehicles/decorators/vehicle-access.decorator.js';
import { MinimumVehicleRole } from '../vehicles/decorators/vehicle-role.decorator.js';
import { type VehicleAccess } from '../vehicles/vehicle-access.types.js';
import { UpdateMaintenanceRecordDto } from './dto/maintenance.dto.js';
import { MaintenanceRecordResponse, toRecordResponse } from './dto/maintenance.response.js';
import { MaintenanceRecordAccessGuard } from './guards/maintenance-record-access.guard.js';
import { MaintenanceService } from './maintenance.service.js';

/** Individual maintenance records, addressed top-level like expenses (api.md §4). */
@ApiTags('maintenance')
@ApiBearerAuth('access-token')
@Controller('maintenance')
@UseGuards(MaintenanceRecordAccessGuard)
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get(':id')
  @ApiOperation({ summary: 'One maintenance record' })
  @ApiOkResponse({ type: MaintenanceRecordResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse, description: 'Absent, or not yours.' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<MaintenanceRecordResponse> {
    return toRecordResponse(await this.maintenance.findOne(access.vehicleId, id));
  }

  @Patch(':id')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({ summary: 'Correct a service; its expense and odometer reading follow' })
  @ApiOkResponse({ type: MaintenanceRecordResponse })
  @ApiConflictResponse({
    type: ApiErrorResponse,
    description: 'Made free while receipts are attached to its expense.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
    @Body() dto: UpdateMaintenanceRecordDto,
  ): Promise<MaintenanceRecordResponse> {
    return toRecordResponse(await this.maintenance.update(access.vehicleId, id, dto));
  }

  @Delete(':id')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a service, with its expense, reading and receipts' })
  @ApiNoContentResponse()
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<void> {
    await this.maintenance.remove(access.vehicleId, id);
  }
}
