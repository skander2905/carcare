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
import { UpdateExpenseDto } from './dto/expense.dto.js';
import { ExpenseResponse, toExpenseResponse } from './dto/expense.response.js';
import { ExpensesService } from './expenses.service.js';
import { ExpenseAccessGuard } from './guards/expense-access.guard.js';

/**
 * Individual expenses, addressed top-level: an id is already unique, and
 * nesting it under the vehicle would add a parameter to keep consistent
 * without adding any information (api.md §4).
 */
@ApiTags('expenses')
@ApiBearerAuth('access-token')
@Controller('expenses')
@UseGuards(ExpenseAccessGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get(':id')
  @ApiOperation({ summary: 'One expense' })
  @ApiOkResponse({ type: ExpenseResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse, description: 'Absent, or not yours.' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<ExpenseResponse> {
    return toExpenseResponse(await this.expenses.findOne(access.vehicleId, id));
  }

  @Patch(':id')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({ summary: 'Correct an expense; null clears an optional field' })
  @ApiOkResponse({ type: ExpenseResponse })
  @ApiConflictResponse({
    type: ApiErrorResponse,
    description: 'Owned by a fuel entry or maintenance record.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
    @Body() dto: UpdateExpenseDto,
  ): Promise<ExpenseResponse> {
    return toExpenseResponse(await this.expenses.update(access.vehicleId, id, dto));
  }

  @Delete(':id')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an expense, and its mileage reading if it had one' })
  @ApiNoContentResponse()
  @ApiConflictResponse({
    type: ApiErrorResponse,
    description: 'Owned by a fuel entry or maintenance record.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<void> {
    await this.expenses.remove(access.vehicleId, id);
  }
}
