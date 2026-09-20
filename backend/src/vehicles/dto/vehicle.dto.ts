import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { FuelType, Transmission } from '../../generated/prisma/enums.js';

const trimmed = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

const upperTrimmed = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value,
);

/** The first cars date from the 1880s; one year ahead covers new model years. */
const EARLIEST_YEAR = 1886;
const LATEST_YEAR = new Date().getUTCFullYear() + 1;

/** Well beyond any real vehicle, but low enough to catch a slipped digit. */
export const MAX_ODOMETER_KM = 5_000_000;

export class CreateVehicleDto {
  @ApiProperty({ example: 'Volkswagen', maxLength: 64 })
  @trimmed
  @IsString()
  @Length(1, 64)
  make: string;

  @ApiProperty({ example: 'Golf', maxLength: 64 })
  @trimmed
  @IsString()
  @Length(1, 64)
  model: string;

  @ApiProperty({ example: 2019, minimum: EARLIEST_YEAR, maximum: LATEST_YEAR })
  @Type(() => Number)
  @IsInt()
  @Min(EARLIEST_YEAR)
  @Max(LATEST_YEAR)
  year: number;

  @ApiProperty({ example: '123 TUN 4567', maxLength: 32 })
  @upperTrimmed
  @IsString()
  @Length(1, 32)
  licensePlate: string;

  @ApiPropertyOptional({ example: 'WVWZZZ1KZAW123456', minLength: 17, maxLength: 17 })
  @IsOptional()
  @upperTrimmed
  @IsString()
  // ISO 3779: 17 characters, and I, O and Q are excluded precisely because they
  // are mistaken for 1 and 0.
  @Matches(/^[A-HJ-NPR-Z0-9]{17}$/, {
    message: 'vin must be 17 characters and must not contain I, O or Q',
  })
  vin?: string;

  @ApiProperty({ enum: FuelType, example: FuelType.DIESEL })
  @IsEnum(FuelType)
  fuelType: FuelType;

  @ApiPropertyOptional({ example: 1.6, description: 'Displacement in litres.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0.1)
  @Max(20)
  engineSize?: number;

  @ApiPropertyOptional({ enum: Transmission, example: Transmission.MANUAL })
  @IsOptional()
  @IsEnum(Transmission)
  transmission?: Transmission;

  @ApiPropertyOptional({ example: 120000, description: 'Mileage today; becomes the first reading.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ODOMETER_KM)
  initialOdometerKm?: number;

  @ApiPropertyOptional({ example: '2021-03-15T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @ApiPropertyOptional({
    example: '38500.000',
    description: 'Decimal string, never a float — JSON numbers lose millimes.',
  })
  @IsOptional()
  @trimmed
  @IsString()
  @Matches(/^\d{1,9}(\.\d{1,3})?$/, {
    message: 'purchasePrice must be a decimal string with up to 3 decimal places',
  })
  purchasePrice?: string;

  @ApiPropertyOptional({ example: 'Deep Black Pearl', maxLength: 32 })
  @IsOptional()
  @trimmed
  @IsString()
  @Length(1, 32)
  color?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @trimmed
  @IsString()
  @Length(0, 2000)
  notes?: string;
}

/**
 * Every field optional, plus archiving.
 *
 * `initialOdometerKm` is absent on purpose: mileage is corrected by recording a
 * reading, not by overwriting a number, so the timeline stays the only source
 * of truth for how far the car has gone.
 */
export class UpdateVehicleDto extends PartialType(
  OmitType(CreateVehicleDto, ['initialOdometerKm'] as const),
) {
  @ApiPropertyOptional({
    description: 'Archive a sold or retired vehicle. Reversible, and keeps its cost history.',
  })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}
