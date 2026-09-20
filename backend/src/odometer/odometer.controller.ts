import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, type Paginated, paginate } from '../common/http/paginated.js';
import { VehicleRole } from '../generated/prisma/enums.js';
import { CurrentVehicle } from '../vehicles/decorators/vehicle-access.decorator.js';
import { MinimumVehicleRole } from '../vehicles/decorators/vehicle-role.decorator.js';
import { VehicleAccessGuard } from '../vehicles/guards/vehicle-access.guard.js';
import { type VehicleAccess } from '../vehicles/vehicle-access.types.js';
import {
  ListReadingsQueryDto,
  OdometerReadingResponse,
  RecordReadingDto,
  toReadingResponse,
} from './dto/odometer.dto.js';
import { OdometerService } from './odometer.service.js';

@ApiTags('vehicles')
@ApiBearerAuth('access-token')
@Controller('vehicles/:vehicleId/odometer')
@UseGuards(VehicleAccessGuard)
export class OdometerController {
  constructor(private readonly odometer: OdometerService) {}

  @Get()
  @ApiOperation({ summary: 'The mileage timeline, newest first' })
  @ApiPaginatedResponse(OdometerReadingResponse)
  async list(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @Query() query: ListReadingsQueryDto,
  ): Promise<Paginated<OdometerReadingResponse>> {
    const { readings, total } = await this.odometer.list(
      access.vehicleId,
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
      query.page,
      query.limit,
    );

    return paginate(readings.map(toReadingResponse), total, query.page, query.limit);
  }

  @Post()
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({ summary: 'Record a reading; backdating is allowed' })
  @ApiCreatedResponse({ type: OdometerReadingResponse })
  async record(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @Body() dto: RecordReadingDto,
  ): Promise<OdometerReadingResponse> {
    const reading = await this.odometer.record(access.vehicleId, {
      odometerKm: dto.odometerKm,
      // Defaulted here rather than in the DTO so "now" is the moment the server
      // handled it, not the moment the payload was validated.
      recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
      ...(dto.notes ? { notes: dto.notes } : {}),
    });

    return toReadingResponse(reading);
  }
}
