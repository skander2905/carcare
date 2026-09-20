import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { type AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ApiErrorResponse } from '../common/http/api-error.js';
import { VehicleRole } from '../generated/prisma/enums.js';
import { CurrentVehicle } from './decorators/vehicle-access.decorator.js';
import { MinimumVehicleRole } from './decorators/vehicle-role.decorator.js';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto.js';
import { VehicleResponse, toVehicleResponse } from './dto/vehicle.response.js';
import { VehicleAccessGuard } from './guards/vehicle-access.guard.js';
import { type VehicleAccess } from './vehicle-access.types.js';
import { VehiclesService } from './vehicles.service.js';

@ApiTags('vehicles')
@ApiBearerAuth('access-token')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @ApiOperation({ summary: 'Every vehicle the caller can reach' })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiOkResponse({ type: [VehicleResponse] })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeArchived', new DefaultValuePipe(false), ParseBoolPipe) includeArchived: boolean,
  ): Promise<VehicleResponse[]> {
    const vehicles = await this.vehicles.list(user.id, includeArchived);
    return vehicles.map(toVehicleResponse);
  }

  @Post()
  @ApiOperation({ summary: 'Add a vehicle; the caller becomes its owner' })
  @ApiCreatedResponse({ type: VehicleResponse })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVehicleDto,
  ): Promise<VehicleResponse> {
    return toVehicleResponse(await this.vehicles.create(user.id, dto));
  }

  /*
   * Everything below is vehicle-scoped, so the guard resolves membership before
   * the handler runs. `ParseUUIDPipe` rejects a malformed id with a 400 before
   * it reaches the database — a stray string would otherwise become a Postgres
   * cast error rather than a clean rejection.
   */

  @Get(':id')
  @UseGuards(VehicleAccessGuard)
  @ApiOperation({ summary: 'One vehicle' })
  @ApiOkResponse({ type: VehicleResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse, description: 'Absent, or not yours.' })
  async findOne(
    @Param('id', ParseUUIDPipe) _id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<VehicleResponse> {
    // The id comes from the guard's resolved access, not from the parameter —
    // so a query can only ever be scoped by something already authorised.
    return toVehicleResponse(await this.vehicles.findOne(access.vehicleId));
  }

  @Patch(':id')
  @UseGuards(VehicleAccessGuard)
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({ summary: 'Update a vehicle, or archive it' })
  @ApiOkResponse({ type: VehicleResponse })
  async update(
    @Param('id', ParseUUIDPipe) _id: string,
    @CurrentVehicle() access: VehicleAccess,
    @Body() dto: UpdateVehicleDto,
  ): Promise<VehicleResponse> {
    return toVehicleResponse(await this.vehicles.update(access.vehicleId, dto));
  }

  @Delete(':id')
  @UseGuards(VehicleAccessGuard)
  // Only the owner, and deliberately not EDITOR: this destroys the vehicle's
  // entire cost history, which is not a thing a shared editor should be able
  // to do. Archiving is the reversible option and needs only EDITOR.
  @MinimumVehicleRole(VehicleRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a vehicle and all of its records, permanently' })
  @ApiNoContentResponse()
  async remove(
    @Param('id', ParseUUIDPipe) _id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<void> {
    await this.vehicles.remove(access.vehicleId);
  }
}
