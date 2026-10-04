import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../common/http/page-query.dto.js';
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

export class ListReadingsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  to?: string;
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

export class MileageContextQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-04T08:30:00.000Z',
    description: 'When the reading is taken. Defaults to now.',
  })
  @IsOptional()
  @IsDateString()
  at?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The record being edited, left out of the comparison.',
  })
  @IsOptional()
  @IsUUID()
  excludeSourceId?: string;
}

export class ReadingPointResponse {
  @ApiProperty({ example: 122_700 })
  odometerKm: number;

  @ApiProperty({ example: '2026-09-29T08:30:00.000Z' })
  recordedAt: string;
}

export class MileageContextResponse {
  @ApiPropertyOptional({
    type: ReadingPointResponse,
    nullable: true,
    description: 'The reading just before.',
  })
  previous: ReadingPointResponse | null;

  @ApiPropertyOptional({
    type: ReadingPointResponse,
    nullable: true,
    description: 'The reading just after, when backdating.',
  })
  next: ReadingPointResponse | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 42.5,
    description: 'Usual km per day over the last six months.',
  })
  kmPerDay: number | null;

  @ApiPropertyOptional({
    type: ReadingPointResponse,
    nullable: true,
    description: "The last fill-up's reading, for the trip counter.",
  })
  lastFuelFill: ReadingPointResponse | null;
}

const point = (reading: OdometerReading | null): ReadingPointResponse | null =>
  reading ? { odometerKm: reading.odometerKm, recordedAt: reading.recordedAt.toISOString() } : null;

export function toMileageContextResponse(context: {
  previous: OdometerReading | null;
  next: OdometerReading | null;
  kmPerDay: number | null;
  lastFuelFill: OdometerReading | null;
}): MileageContextResponse {
  return {
    previous: point(context.previous),
    next: point(context.next),
    kmPerDay: context.kmPerDay,
    lastFuelFill: point(context.lastFuelFill),
  };
}
