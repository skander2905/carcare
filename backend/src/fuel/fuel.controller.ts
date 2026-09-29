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
import { UpdateFuelEntryDto } from './dto/fuel.dto.js';
import { FuelEntryResponse, toFuelEntryResponse } from './dto/fuel.response.js';
import { FuelService } from './fuel.service.js';
import { FuelEntryAccessGuard } from './guards/fuel-entry-access.guard.js';

/** Individual fuel entries, addressed top-level like expenses (api.md §4). */
@ApiTags('fuel')
@ApiBearerAuth('access-token')
@Controller('fuel')
@UseGuards(FuelEntryAccessGuard)
export class FuelController {
  constructor(private readonly fuel: FuelService) {}

  @Get(':id')
  @ApiOperation({ summary: 'One fuel entry' })
  @ApiOkResponse({ type: FuelEntryResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse, description: 'Absent, or not yours.' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<FuelEntryResponse> {
    return toFuelEntryResponse(await this.fuel.findOne(access.vehicleId, id));
  }

  @Patch(':id')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({ summary: 'Correct a fill-up; its expense and odometer reading follow' })
  @ApiOkResponse({ type: FuelEntryResponse })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
    @Body() dto: UpdateFuelEntryDto,
  ): Promise<FuelEntryResponse> {
    return toFuelEntryResponse(await this.fuel.update(access.vehicleId, id, dto));
  }

  @Delete(':id')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a fill-up, with its expense, reading and receipts' })
  @ApiNoContentResponse()
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<void> {
    await this.fuel.remove(access.vehicleId, id);
  }
}
