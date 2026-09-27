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
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { type AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ApiErrorResponse } from '../common/http/api-error.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { ApiPaginatedResponse, type Paginated, paginate } from '../common/http/paginated.js';
import { VehicleRole } from '../generated/prisma/enums.js';
import { CurrentVehicle } from '../vehicles/decorators/vehicle-access.decorator.js';
import { MinimumVehicleRole } from '../vehicles/decorators/vehicle-role.decorator.js';
import { VehicleAccessGuard } from '../vehicles/guards/vehicle-access.guard.js';
import { type VehicleAccess } from '../vehicles/vehicle-access.types.js';
import { CreateExpenseDto, ListExpensesQueryDto } from './dto/expense.dto.js';
import { ExpenseResponse, toExpenseResponse } from './dto/expense.response.js';
import { ExpensesService } from './expenses.service.js';

/** The ledger as a collection: listing and adding, under the vehicle. */
@ApiTags('expenses')
@ApiBearerAuth('access-token')
@Controller('vehicles/:vehicleId/expenses')
@UseGuards(VehicleAccessGuard)
export class VehicleExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The cost ledger, filtered and paginated' })
  @ApiPaginatedResponse(ExpenseResponse)
  async list(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @Query() query: ListExpensesQueryDto,
  ): Promise<Paginated<ExpenseResponse>> {
    const { expenses, total } = await this.expenses.list(access.vehicleId, query);
    return paginate(expenses.map(toExpenseResponse), total, query.page, query.limit);
  }

  @Post()
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({ summary: 'Record an expense' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Makes the request safe to retry. A repeat with the same key and body returns the original expense ' +
      'with `Idempotent-Replayed: true` instead of creating a second one.',
  })
  @ApiCreatedResponse({ type: ExpenseResponse })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorResponse,
    description: 'Key reused for a different request.',
  })
  async create(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExpenseDto,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ExpenseResponse> {
    const key = this.idempotency.parseKey(rawKey);
    const { expense, replayed } = await this.expenses.create(access.vehicleId, user.id, dto, key);

    // Same status either way, so a client's success path does not branch on
    // whether its first attempt got through; the header says which it was.
    if (replayed) response.setHeader('Idempotent-Replayed', 'true');

    return toExpenseResponse(expense);
  }
}
