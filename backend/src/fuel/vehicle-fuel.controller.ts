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
  ConsumptionQueryDto,
  CreateFuelEntryDto,
  FuelSuggestionsQueryDto,
  ListFuelEntriesQueryDto,
} from './dto/fuel.dto.js';
import {
  ConsumptionResponse,
  FuelEntryResponse,
  FuelSuggestionsResponse,
  toConsumptionResponse,
  toFuelEntryResponse,
  toSuggestionsResponse,
} from './dto/fuel.response.js';
import { FuelService } from './fuel.service.js';

/** The fuel log as a collection, and what it adds up to, under the vehicle. */
@ApiTags('fuel')
@ApiBearerAuth('access-token')
@Controller('vehicles/:vehicleId')
@UseGuards(VehicleAccessGuard)
export class VehicleFuelController {
  constructor(
    private readonly fuel: FuelService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('fuel')
  @ApiOperation({ summary: 'The fuel log, newest first, each full tank with its consumption' })
  @ApiPaginatedResponse(FuelEntryResponse)
  async list(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @Query() query: ListFuelEntriesQueryDto,
  ): Promise<Paginated<FuelEntryResponse>> {
    const { entries, total, windows } = await this.fuel.list(access.vehicleId, query);
    const data = entries.map((entry) => toFuelEntryResponse(entry, windows.get(entry.id) ?? null));
    return paginate(data, total, query.page, query.limit);
  }

  @Post('fuel')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({ summary: 'Record a fill-up; also writes its ledger expense and odometer reading' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'As on POST /expenses: a retry with the same key and body replays the original entry.',
  })
  @ApiCreatedResponse({ type: FuelEntryResponse })
  @ApiBadRequestResponse({
    type: ApiErrorResponse,
    description: 'Invalid figures, a price that contradicts them, or a mileage the timeline refuses.',
  })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorResponse,
    description: 'Key reused for a different request.',
  })
  async create(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFuelEntryDto,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FuelEntryResponse> {
    const key = this.idempotency.parseKey(rawKey);
    const { entry, replayed } = await this.fuel.create(access.vehicleId, user.id, dto, key);

    if (replayed) response.setHeader('Idempotent-Replayed', 'true');

    // The new entry's own window, if it closed one, is computed with the next
    // list or consumption read; the form refreshes both.
    return toFuelEntryResponse(entry);
  }

  @Get('fuel/suggestions')
  @ApiOperation({
    summary: 'What the fill-up form can prefill: fuel type, last price, stations near here and recently used',
  })
  @ApiOkResponse({ type: FuelSuggestionsResponse })
  async suggestions(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @Query() query: FuelSuggestionsQueryDto,
  ): Promise<FuelSuggestionsResponse> {
    return toSuggestionsResponse(await this.fuel.suggestions(access.vehicleId, query.lat, query.lng));
  }

  @Get('analytics/consumption')
  @ApiOperation({ summary: 'Full-to-full consumption and fuel spend for a period' })
  @ApiOkResponse({ type: ConsumptionResponse })
  async consumption(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @Query() query: ConsumptionQueryDto,
  ): Promise<ConsumptionResponse> {
    return toConsumptionResponse(await this.fuel.consumption(access.vehicleId, query.from, query.to));
  }
}
