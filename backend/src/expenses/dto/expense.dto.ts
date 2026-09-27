import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../common/http/page-query.dto.js';
import { IsOptionalProperty } from '../../common/validation/optional.decorator.js';
import { ExpenseCategory } from '../../generated/prisma/enums.js';
import { MAX_ODOMETER_KM } from '../../vehicles/dto/vehicle.dto.js';

/**
 * A positive amount with at most three decimal places — TND counts millimes.
 *
 * Zero is refused here as well as by the column's CHECK, so the caller gets a
 * 400 naming the field rather than a constraint violation surfacing as a 500.
 * Nine integer digits fit `numeric(12,3)` exactly.
 */
const AMOUNT_PATTERN = /^(?!0+(?:\.0+)?$)\d{1,9}(?:\.\d{1,3})?$/;
const AMOUNT_MESSAGE = 'amount must be a positive decimal string with up to 3 decimal places';

/** Trimmed; an empty string means "not given" on create. */
const trimmedOrAbsent = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
});

/** Trimmed; an empty string clears the field on update, exactly as null does. */
const trimmedOrNull = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
});

export class CreateExpenseDto {
  @ApiProperty({ enum: ExpenseCategory, example: ExpenseCategory.INSURANCE })
  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @ApiProperty({
    example: '321.750',
    description: 'Decimal string, never a float — JSON numbers lose millimes.',
  })
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount: string;

  @ApiPropertyOptional({
    example: '2026-09-20T08:30:00.000Z',
    description: 'When the cost was incurred. Defaults to now; backdating is allowed.',
  })
  @IsOptional()
  @IsDateString()
  incurredAt?: string;

  @ApiPropertyOptional({
    example: 121500,
    description: 'Mileage at the time. Also recorded on the odometer timeline, so it must fit there.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ODOMETER_KM)
  odometerKm?: number;

  @ApiPropertyOptional({ example: 'Annual comprehensive cover', maxLength: 200 })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string;

  @ApiPropertyOptional({ example: 'STAR Assurances', maxLength: 120 })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 120)
  vendor?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;
}

/**
 * Written out rather than `PartialType(CreateExpenseDto)`, because a PATCH has
 * two kinds of optional.
 *
 * Omitting a field leaves it alone. Sending `null` clears it — which is right
 * for the mileage, description, vendor and notes, and simply invalid for the
 * category, amount and date, which every expense must have. `PartialType`'s
 * `@IsOptional()` lets null through on all of them, so a `{ "amount": null }`
 * would reach the database as a NOT NULL violation and a 500.
 */
export class UpdateExpenseDto {
  @ApiPropertyOptional({ enum: ExpenseCategory })
  @IsOptionalProperty()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @ApiPropertyOptional({ example: '321.750' })
  @IsOptionalProperty()
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: AMOUNT_MESSAGE })
  amount?: string;

  @ApiPropertyOptional({ example: '2026-09-20T08:30:00.000Z' })
  @IsOptionalProperty()
  @IsDateString()
  incurredAt?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Null removes the mileage and its timeline reading.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ODOMETER_KM)
  odometerKm?: number | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @trimmedOrNull
  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @trimmedOrNull
  @IsOptional()
  @IsString()
  @Length(1, 120)
  vendor?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @trimmedOrNull
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string | null;
}

/**
 * The sortable columns, spelled out. Anything else is a 400 — a sort key taken
 * from the query string verbatim would let a caller order by any column,
 * including ones that exist only for internal bookkeeping.
 */
export const EXPENSE_SORTS = [
  'incurredAt:desc',
  'incurredAt:asc',
  'amount:desc',
  'amount:asc',
  'createdAt:desc',
  'createdAt:asc',
] as const;

export type ExpenseSort = (typeof EXPENSE_SORTS)[number];

export class ListExpensesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ExpenseCategory })
  @IsOptional()
  // An unknown category is a 400, not an empty page: silently returning
  // nothing would hide a client bug behind a plausible answer.
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @ApiPropertyOptional({
    example: '2026-01-01T00:00:00.000Z',
    description: 'Inclusive lower bound on incurredAt, as an instant.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-12-31T23:59:59.999Z',
    description: 'Inclusive upper bound on incurredAt, as an instant. Send the end of a day, not its start.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive match on description and vendor.', maxLength: 100 })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;

  @ApiPropertyOptional({ enum: EXPENSE_SORTS, default: 'incurredAt:desc' })
  @IsOptional()
  @IsIn(EXPENSE_SORTS)
  sort: ExpenseSort = 'incurredAt:desc';
}
