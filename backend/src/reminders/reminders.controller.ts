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
  Post,
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
import { UpdateReminderDto } from './dto/reminders.dto.js';
import {
  CompletionResponse,
  ReminderResponse,
  toCompletionResponse,
  toReminderResponse,
} from './dto/reminders.response.js';
import { ReminderAccessGuard } from './guards/reminder-access.guard.js';
import { RemindersService } from './reminders.service.js';

/** Individual reminders, addressed top-level (api.md §4). */
@ApiTags('reminders')
@ApiBearerAuth('access-token')
@Controller('reminders')
@UseGuards(ReminderAccessGuard)
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get(':id')
  @ApiOperation({ summary: 'One reminder, with its due status' })
  @ApiOkResponse({ type: ReminderResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse, description: 'Absent, or not yours.' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<ReminderResponse> {
    return toReminderResponse(await this.reminders.findOne(access.vehicleId, id));
  }

  @Patch(':id')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({ summary: 'Change what it is, when it falls due, or how early to warn' })
  @ApiOkResponse({ type: ReminderResponse })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
    @Body() dto: UpdateReminderDto,
  ): Promise<ReminderResponse> {
    return toReminderResponse(await this.reminders.update(access.vehicleId, id, dto));
  }

  @Post(':id/complete')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark it done; a repeating one creates its next occurrence' })
  @ApiOkResponse({ type: CompletionResponse })
  @ApiConflictResponse({ type: ApiErrorResponse, description: 'Already completed.' })
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<CompletionResponse> {
    return toCompletionResponse(await this.reminders.complete(access.vehicleId, id));
  }

  @Delete(':id')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a reminder' })
  @ApiNoContentResponse()
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<void> {
    await this.reminders.remove(access.vehicleId, id);
  }
}
