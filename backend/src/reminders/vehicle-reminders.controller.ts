import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ApiErrorResponse } from '../common/http/api-error.js';
import { VehicleRole } from '../generated/prisma/enums.js';
import { CurrentVehicle } from '../vehicles/decorators/vehicle-access.decorator.js';
import { MinimumVehicleRole } from '../vehicles/decorators/vehicle-role.decorator.js';
import { VehicleAccessGuard } from '../vehicles/guards/vehicle-access.guard.js';
import { type VehicleAccess } from '../vehicles/vehicle-access.types.js';
import { CreateReminderDto, ListRemindersQueryDto } from './dto/reminders.dto.js';
import { ReminderResponse, toReminderResponse } from './dto/reminders.response.js';
import { RemindersService } from './reminders.service.js';

/** A vehicle's reminders, as a collection under it. Not paginated: a car has a handful. */
@ApiTags('reminders')
@ApiBearerAuth('access-token')
@Controller('vehicles/:vehicleId/reminders')
@UseGuards(VehicleAccessGuard)
export class VehicleRemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  @ApiOperation({ summary: 'Pending reminders most urgent first, then completed ones' })
  @ApiOkResponse({ type: [ReminderResponse] })
  async list(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @Query() query: ListRemindersQueryDto,
  ): Promise<ReminderResponse[]> {
    return (await this.reminders.list(access.vehicleId, query)).map(toReminderResponse);
  }

  @Post()
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({ summary: 'Add a reminder for a date, a mileage, or whichever comes first' })
  @ApiCreatedResponse({ type: ReminderResponse })
  @ApiBadRequestResponse({
    type: ApiErrorResponse,
    description: 'No due point, or repeating without a date.',
  })
  async create(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReminderDto,
  ): Promise<ReminderResponse> {
    return toReminderResponse(await this.reminders.create(access.vehicleId, user.id, dto));
  }
}
