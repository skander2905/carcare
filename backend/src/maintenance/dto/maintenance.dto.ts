import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../common/http/page-query.dto.js';
import { IsOptionalProperty } from '../../common/validation/optional.decorator.js';
import { trimmedOrAbsent, trimmedOrNull } from '../../common/validation/trimmed.js';
import { MaintenanceType } from '../../generated/prisma/enums.js';
import { MAX_ODOMETER_KM } from '../../vehicles/dto/vehicle.dto.js';

/**
 * Like the ledger's amount, but zero is allowed: a warranty service is free
 * and still happened. Fits numeric(12,3).
 */
const COST_PATTERN = /^\d{1,9}(?:\.\d{1,3})?$/;
const costMessage = (field: string) => `${field} must be a decimal string with up to 3 decimal places`;

const MAX_INTERVAL_KM = 1_000_000;
const MAX_INTERVAL_MONTHS = 240;

export class CreateMaintenanceRecordDto {
  @ApiProperty({ enum: MaintenanceType })
  @IsEnum(MaintenanceType)
  type: MaintenanceType;

  @ApiPropertyOptional({ example: '2026-09-30T08:00:00.000Z', description: 'Defaults to now.' })
  @IsOptional()
  @IsDateString()
  performedAt?: string;

  @ApiProperty({
    example: 121_480,
    description: 'Also recorded on the odometer timeline, so it must fit there.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ODOMETER_KM)
  odometerKm: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: "The schedule this service satisfies; it restarts that schedule's count.",
  })
  @IsOptional()
  @IsUUID()
  scheduleId?: string;

  @ApiPropertyOptional({ example: '120.250' })
  @IsOptional()
  @IsString()
  @Matches(COST_PATTERN, { message: costMessage('partsCost') })
  partsCost?: string;

  @ApiPropertyOptional({ example: '60.000' })
  @IsOptional()
  @IsString()
  @Matches(COST_PATTERN, { message: costMessage('laborCost') })
  laborCost?: string;

  @ApiPropertyOptional({
    example: '180.250',
    description:
      'What was paid; 0 for a free service. Added up from parts and labour when absent, and refused when it disagrees with them.',
  })
  @IsOptional()
  @IsString()
  @Matches(COST_PATTERN, { message: costMessage('totalCost') })
  totalCost?: string;

  @ApiPropertyOptional({ example: 'Garage Ben Arous', maxLength: 120 })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 120)
  serviceProvider?: string;

  @ApiPropertyOptional({ example: '5W-30, Total Quartz', maxLength: 200 })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;
}

/** Absent leaves a field alone; null clears it, where the column allows it. */
export class UpdateMaintenanceRecordDto {
  @ApiPropertyOptional({ enum: MaintenanceType })
  @IsOptionalProperty()
  @IsEnum(MaintenanceType)
  type?: MaintenanceType;

  @ApiPropertyOptional()
  @IsOptionalProperty()
  @IsDateString()
  performedAt?: string;

  @ApiPropertyOptional({ example: 121_480 })
  @IsOptionalProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ODOMETER_KM)
  odometerKm?: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Null unlinks the schedule.' })
  @IsOptional()
  @IsUUID()
  scheduleId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(COST_PATTERN, { message: costMessage('partsCost') })
  partsCost?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(COST_PATTERN, { message: costMessage('laborCost') })
  laborCost?: string | null;

  @ApiPropertyOptional({
    description:
      'Kept when absent — unless both halves of the split are then known, when it is added up again.',
  })
  @IsOptionalProperty()
  @IsString()
  @Matches(COST_PATTERN, { message: costMessage('totalCost') })
  totalCost?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @trimmedOrNull
  @IsOptional()
  @IsString()
  @Length(1, 120)
  serviceProvider?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @trimmedOrNull
  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @trimmedOrNull
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string | null;
}

export class ListMaintenanceRecordsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: MaintenanceType })
  @IsOptional()
  @IsEnum(MaintenanceType)
  type?: MaintenanceType;

  @ApiPropertyOptional({ description: 'Inclusive lower bound on performedAt.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound on performedAt.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive match on the service provider.', maxLength: 100 })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 100)
  provider?: string;
}

export class CreateScheduleDto {
  @ApiProperty({ enum: MaintenanceType })
  @IsEnum(MaintenanceType)
  type: MaintenanceType;

  @ApiPropertyOptional({
    example: 'Oil and filter',
    maxLength: 120,
    description: 'Defaults to the type, in words.',
  })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ example: 10_000, description: 'At least one interval is required.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INTERVAL_KM)
  intervalKm?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INTERVAL_MONTHS)
  intervalMonths?: number;

  @ApiPropertyOptional({
    example: 115_000,
    description: 'The last service before it was logged here, if remembered. Logged records supersede it.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ODOMETER_KM)
  lastServiceOdometerKm?: number;

  @ApiPropertyOptional({ example: '2026-03-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  lastServiceAt?: string;

  @ApiPropertyOptional({ default: 1000, description: 'How early "due soon" starts, in km.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  notifyBeforeKm?: number;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  notifyBeforeDays?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional({ enum: MaintenanceType })
  @IsOptionalProperty()
  @IsEnum(MaintenanceType)
  type?: MaintenanceType;

  @ApiPropertyOptional({ maxLength: 120 })
  @trimmedOrAbsent
  @IsOptionalProperty()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Null drops this interval; one must remain.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INTERVAL_KM)
  intervalKm?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INTERVAL_MONTHS)
  intervalMonths?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ODOMETER_KM)
  lastServiceOdometerKm?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  lastServiceAt?: string | null;

  @ApiPropertyOptional()
  @IsOptionalProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  notifyBeforeKm?: number;

  @ApiPropertyOptional()
  @IsOptionalProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  notifyBeforeDays?: number;

  @ApiPropertyOptional()
  @IsOptionalProperty()
  @IsBoolean()
  isActive?: boolean;
}
