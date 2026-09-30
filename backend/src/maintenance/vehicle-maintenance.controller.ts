import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { type AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ApiErrorResponse } from '../common/http/api-error.js';
import { ApiPaginatedResponse, type Paginated, paginate } from '../common/http/paginated.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { VehicleRole } from '../generated/prisma/enums.js';
import { CurrentVehicle } from '../vehicles/decorators/vehicle-access.decorator.js';
import { MinimumVehicleRole } from '../vehicles/decorators/vehicle-role.decorator.js';
import { VehicleAccessGuard } from '../vehicles/guards/vehicle-access.guard.js';
import { type VehicleAccess } from '../vehicles/vehicle-access.types.js';
import {
  CreateMaintenanceRecordDto,
  CreateScheduleDto,
  ListMaintenanceRecordsQueryDto,
} from './dto/maintenance.dto.js';
import {
  MaintenanceRecordResponse,
  MaintenanceSuggestionsResponse,
  ScheduleResponse,
  toRecordResponse,
  toScheduleResponse,
  toSuggestionsResponse,
} from './dto/maintenance.response.js';
import { MaintenanceService } from './maintenance.service.js';
import { SchedulesService } from './schedules.service.js';

/** The maintenance log and the schedules, as collections under the vehicle. */
@ApiTags('maintenance')
@ApiBearerAuth('access-token')
@Controller('vehicles/:vehicleId')
@UseGuards(VehicleAccessGuard)
export class VehicleMaintenanceController {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly schedules: SchedulesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('maintenance')
  @ApiOperation({ summary: 'Services carried out, newest first' })
  @ApiPaginatedResponse(MaintenanceRecordResponse)
  async list(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @Query() query: ListMaintenanceRecordsQueryDto,
  ): Promise<Paginated<MaintenanceRecordResponse>> {
    const { records, total } = await this.maintenance.list(access.vehicleId, query);
    return paginate(records.map(toRecordResponse), total, query.page, query.limit);
  }

  @Post('maintenance')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({
    summary: 'Log a service; also writes its odometer reading and, unless it was free, its ledger expense',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'As on POST /expenses: a retry with the same key and body replays the original record.',
  })
  @ApiCreatedResponse({ type: MaintenanceRecordResponse })
  @ApiBadRequestResponse({
    type: ApiErrorResponse,
    description:
      'Costs that do not add up, a schedule on another vehicle, or a mileage the timeline refuses.',
  })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorResponse,
    description: 'Key reused for a different request.',
  })
  async create(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMaintenanceRecordDto,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MaintenanceRecordResponse> {
    const key = this.idempotency.parseKey(rawKey);
    const { record, replayed } = await this.maintenance.create(access.vehicleId, user.id, dto, key);
    if (replayed) response.setHeader('Idempotent-Replayed', 'true');
    return toRecordResponse(record);
  }

  @Get('maintenance/suggestions')
  @ApiOperation({ summary: 'What the service form can prefill: recent workshops, and the mileage as a hint' })
  @ApiOkResponse({ type: MaintenanceSuggestionsResponse })
  async suggestions(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<MaintenanceSuggestionsResponse> {
    return toSuggestionsResponse(await this.maintenance.suggestions(access.vehicleId));
  }

  @Get('maintenance-schedules')
  @ApiOperation({
    summary: 'Recurring services with their due status, most urgent first; paused ones last',
  })
  @ApiOkResponse({ type: [ScheduleResponse] })
  async schedulesList(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<ScheduleResponse[]> {
    return (await this.schedules.list(access.vehicleId)).map(toScheduleResponse);
  }

  @Post('maintenance-schedules')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({
    summary: 'Set up a recurring service: every N km, every N months, or whichever comes first',
  })
  @ApiCreatedResponse({ type: ScheduleResponse })
  @ApiBadRequestResponse({ type: ApiErrorResponse, description: 'Neither interval given.' })
  async createSchedule(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @Body() dto: CreateScheduleDto,
  ): Promise<ScheduleResponse> {
    return toScheduleResponse(await this.schedules.create(access.vehicleId, dto));
  }
}
