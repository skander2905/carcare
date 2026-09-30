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
import { UpdateScheduleDto } from './dto/maintenance.dto.js';
import { ScheduleResponse, toScheduleResponse } from './dto/maintenance.response.js';
import { MaintenanceScheduleAccessGuard } from './guards/maintenance-schedule-access.guard.js';
import { SchedulesService } from './schedules.service.js';

/** Individual schedules, addressed top-level (api.md §4). */
@ApiTags('maintenance')
@ApiBearerAuth('access-token')
@Controller('maintenance-schedules')
@UseGuards(MaintenanceScheduleAccessGuard)
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get(':id')
  @ApiOperation({ summary: 'One schedule, with its due status' })
  @ApiOkResponse({ type: ScheduleResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse, description: 'Absent, or not yours.' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<ScheduleResponse> {
    return toScheduleResponse(await this.schedules.findOne(access.vehicleId, id));
  }

  @Patch(':id')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({ summary: 'Change the intervals, the baseline, the warning windows, or pause it' })
  @ApiOkResponse({ type: ScheduleResponse })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
    @Body() dto: UpdateScheduleDto,
  ): Promise<ScheduleResponse> {
    return toScheduleResponse(await this.schedules.update(access.vehicleId, id, dto));
  }

  @Delete(':id')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a schedule; the services logged against it are kept' })
  @ApiNoContentResponse()
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<void> {
    await this.schedules.remove(access.vehicleId, id);
  }
}
