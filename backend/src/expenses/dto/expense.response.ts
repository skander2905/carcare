import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { toMoneyString } from '../../common/http/decimal.js';
import { ExpenseCategory, ExpenseSource } from '../../generated/prisma/enums.js';
import { type ExpenseWithAttachments } from '../expenses.repository.js';

export class ExpenseResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  vehicleId: string;

  @ApiProperty({ enum: ExpenseCategory, example: ExpenseCategory.INSURANCE })
  category: ExpenseCategory;

  @ApiProperty({ example: '321.750', description: 'Fixed to three decimal places.' })
  amount: string;

  @ApiProperty({ example: '2026-09-20T08:30:00.000Z' })
  incurredAt: string;

  @ApiPropertyOptional({ example: 121500, nullable: true })
  odometerKm: number | null;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiPropertyOptional({ nullable: true })
  vendor: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes: string | null;

  @ApiProperty({
    enum: ExpenseSource,
    example: ExpenseSource.MANUAL,
    description: 'Anything but MANUAL is edited through the fuel entry or service record that owns it.',
  })
  sourceType: ExpenseSource;

  @ApiProperty({ example: 1, description: 'Receipts and invoices attached and ready to view.' })
  attachmentCount: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Who recorded it.' })
  createdById: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export function toExpenseResponse(expense: ExpenseWithAttachments): ExpenseResponse {
  return {
    id: expense.id,
    vehicleId: expense.vehicleId,
    category: expense.category,
    // A non-null column, so the helper's null branch cannot be taken here.
    amount: toMoneyString(expense.amount)!,
    incurredAt: expense.incurredAt.toISOString(),
    odometerKm: expense.odometerKm,
    description: expense.description,
    vendor: expense.vendor,
    notes: expense.notes,
    sourceType: expense.sourceType,
    attachmentCount: expense._count.documents,
    createdById: expense.createdById,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}
