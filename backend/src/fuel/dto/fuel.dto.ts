import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../common/http/page-query.dto.js';
import { IsOptionalProperty } from '../../common/validation/optional.decorator.js';
import { trimmedOrAbsent, trimmedOrNull } from '../../common/validation/trimmed.js';
import { AMOUNT_PATTERN } from '../../expenses/dto/expense.dto.js';
import { FuelType } from '../../generated/prisma/enums.js';
import { MAX_ODOMETER_KM } from '../../vehicles/dto/vehicle.dto.js';

/** Positive, two decimal places — a pump shows centilitres. Fits numeric(7,2). */
const VOLUME_PATTERN = /^(?!0+(?:\.0+)?$)\d{1,5}(?:\.\d{1,2})?$/;
const VOLUME_MESSAGE = 'volumeLiters must be a positive decimal string with up to 2 decimal places';

/** Positive, three decimal places — millimes per litre. Fits numeric(8,3). */
const PRICE_PATTERN = /^(?!0+(?:\.0+)?$)\d{1,5}(?:\.\d{1,3})?$/;
const PRICE_MESSAGE = 'pricePerLiter must be a positive decimal string with up to 3 decimal places';

const TOTAL_MESSAGE = 'totalCost must be a positive decimal string with up to 3 decimal places';

export class CreateFuelEntryDto {
  @ApiPropertyOptional({ example: '2026-09-29T07:45:00.000Z', description: 'Defaults to now.' })
  @IsOptional()
  @IsDateString()
  filledAt?: string;

  @ApiProperty({
    example: 121_480,
    description: 'Also recorded on the odometer timeline, so it must fit there.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ODOMETER_KM)
  odometerKm: number;

  @ApiProperty({ example: '38.20', description: 'Decimal string, never a float.' })
  @IsString()
  @Matches(VOLUME_PATTERN, { message: VOLUME_MESSAGE })
  volumeLiters: string;

  @ApiProperty({ example: '96.455', description: 'What was paid. Becomes the ledger expense.' })
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: TOTAL_MESSAGE })
  totalCost: string;

  @ApiPropertyOptional({
    example: '2.525',
    description:
      'As the pump shows it. Derived from total ÷ volume when absent; refused when it disagrees with them by more than 2%.',
  })
  @IsOptional()
  @IsString()
  @Matches(PRICE_PATTERN, { message: PRICE_MESSAGE })
  pricePerLiter?: string;

  @ApiPropertyOptional({ enum: FuelType, description: "Defaults to the vehicle's fuel type." })
  @IsOptional()
  @IsEnum(FuelType)
  fuelType?: FuelType;

  @ApiPropertyOptional({
    default: true,
    description: 'Filled to the brim. Only full tanks close a consumption window.',
  })
  @IsOptional()
  @IsBoolean()
  isFullTank?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'A fill before this one was never logged, so no consumption is computed across the gap.',
  })
  @IsOptional()
  @IsBoolean()
  isMissedFill?: boolean;

  @ApiPropertyOptional({ example: 'Shell Lac 2', maxLength: 120 })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 120)
  stationName?: string;

  @ApiPropertyOptional({ example: 36.8442, description: 'Sent with longitude or not at all.' })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 10.2425, description: 'Sent with latitude or not at all.' })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;
}

/**
 * Written out for the same reason as `UpdateExpenseDto`: absent leaves a field
 * alone, null clears it, and null is only valid where the column allows it.
 */
export class UpdateFuelEntryDto {
  @ApiPropertyOptional({ example: '2026-09-29T07:45:00.000Z' })
  @IsOptionalProperty()
  @IsDateString()
  filledAt?: string;

  @ApiPropertyOptional({ example: 121_480 })
  @IsOptionalProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ODOMETER_KM)
  odometerKm?: number;

  @ApiPropertyOptional({ example: '38.20' })
  @IsOptionalProperty()
  @IsString()
  @Matches(VOLUME_PATTERN, { message: VOLUME_MESSAGE })
  volumeLiters?: string;

  @ApiPropertyOptional({ example: '96.455' })
  @IsOptionalProperty()
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: TOTAL_MESSAGE })
  totalCost?: string;

  @ApiPropertyOptional({
    example: '2.525',
    nullable: true,
    description: 'Null re-derives it from the total and volume.',
  })
  @IsOptional()
  @IsString()
  @Matches(PRICE_PATTERN, { message: PRICE_MESSAGE })
  pricePerLiter?: string | null;

  @ApiPropertyOptional({ enum: FuelType })
  @IsOptionalProperty()
  @IsEnum(FuelType)
  fuelType?: FuelType;

  @ApiPropertyOptional()
  @IsOptionalProperty()
  @IsBoolean()
  isFullTank?: boolean;

  @ApiPropertyOptional()
  @IsOptionalProperty()
  @IsBoolean()
  isMissedFill?: boolean;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @trimmedOrNull
  @IsOptional()
  @IsString()
  @Length(1, 120)
  stationName?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Null, with longitude null, forgets the location.' })
  @IsOptional()
  @IsLatitude()
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsLongitude()
  longitude?: number | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @trimmedOrNull
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string | null;
}

export class ListFuelEntriesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    example: '2026-01-01T00:00:00.000Z',
    description: 'Inclusive lower bound on filledAt.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-12-31T23:59:59.999Z',
    description: 'Inclusive upper bound on filledAt.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: FuelType })
  @IsOptional()
  @IsEnum(FuelType)
  fuelType?: FuelType;

  @ApiPropertyOptional({ description: 'Case-insensitive match on the station name.', maxLength: 100 })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 100)
  station?: string;
}

export class FuelSuggestionsQueryDto {
  @ApiPropertyOptional({
    example: 36.8442,
    description: 'Where the user is, to match stations logged nearby.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ example: 10.2425 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}

export class ConsumptionQueryDto {
  @ApiPropertyOptional({ description: 'Inclusive; windows are kept by the day they closed.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}
