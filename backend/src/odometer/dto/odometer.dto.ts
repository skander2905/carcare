import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { MAX_ODOMETER_KM } from '../../vehicles/dto/vehicle.dto.js';
import { type OdometerReading } from '../../prisma/model.types.js';

export class RecordReadingDto {
  @ApiProperty({ example: 121500, minimum: 0, maximum: MAX_ODOMETER_KM })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ODOMETER_KM)
  odometerKm: number;

  @ApiPropertyOptional({
    example: '2026-09-20T08:30:00.000Z',
    description: 'When the reading was taken. Defaults to now; backdating is allowed.',
  })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(0, 500)
  notes?: string;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export class ListReadingsQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: DEFAULT_LIMIT, maximum: MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // Capped server-side so a client cannot ask for the entire timeline at once.
  @Max(MAX_LIMIT)
  limit = DEFAULT_LIMIT;
}

export class OdometerReadingResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 121500 })
  odometerKm: number;

  @ApiProperty({ example: '2026-09-20T08:30:00.000Z' })
  recordedAt: string;

  @ApiProperty({ example: 'MANUAL', enum: ['MANUAL', 'FUEL', 'EXPENSE', 'MAINTENANCE', 'TRIP'] })
  source: string;

  @ApiPropertyOptional({ nullable: true, description: 'The record that produced this reading.' })
  sourceId: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes: string | null;
}

export function toReadingResponse(reading: OdometerReading): OdometerReadingResponse {
  return {
    id: reading.id,
    odometerKm: reading.odometerKm,
    recordedAt: reading.recordedAt.toISOString(),
    source: reading.source,
    sourceId: reading.sourceId,
    notes: reading.notes,
  };
}
