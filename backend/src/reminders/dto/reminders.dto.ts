import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { IsOptionalProperty } from '../../common/validation/optional.decorator.js';
import { trimmedOrAbsent, trimmedOrNull } from '../../common/validation/trimmed.js';
import { ReminderStatus, ReminderType } from '../../generated/prisma/enums.js';
import { MAX_ODOMETER_KM } from '../../vehicles/dto/vehicle.dto.js';

const MAX_REPEAT_MONTHS = 120;

/**
 * A calendar date, `YYYY-MM-DD`, that exists. `@IsDateString` would accept an
 * instant and roll 2027-02-30 over into March without a word.
 */
@ValidatorConstraint({ name: 'calendarDate' })
export class IsCalendarDate implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }

  defaultMessage(): string {
    return '$property must be a calendar date, YYYY-MM-DD';
  }
}

export class CreateReminderDto {
  @ApiProperty({ enum: ReminderType })
  @IsEnum(ReminderType)
  type: ReminderType;

  @ApiProperty({ example: 'Insurance renewal', maxLength: 120 })
  @trimmedOrAbsent
  @IsString()
  @Length(1, 120)
  title: string;

  @ApiPropertyOptional({ example: 'Policy 4471 with STAR', maxLength: 500 })
  @trimmedOrAbsent
  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string;

  @ApiPropertyOptional({ example: '2027-03-01', description: "A date on the owner's calendar." })
  @IsOptional()
  @Validate(IsCalendarDate)
  dueDate?: string;

  @ApiPropertyOptional({ example: 130_000, description: 'At least one of dueDate and dueOdometerKm.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ODOMETER_KM)
  dueOdometerKm?: number;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  notifyBeforeDays?: number;

  @ApiPropertyOptional({ default: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  notifyBeforeKm?: number;

  @ApiPropertyOptional({ example: 12, description: 'Completing it creates the next one; needs dueDate.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_REPEAT_MONTHS)
  repeatEveryMonths?: number;
}

export class UpdateReminderDto {
  @ApiPropertyOptional({ enum: ReminderType })
  @IsOptionalProperty()
  @IsEnum(ReminderType)
  type?: ReminderType;

  @ApiPropertyOptional({ maxLength: 120 })
  @trimmedOrAbsent
  @IsOptionalProperty()
  @IsString()
  @Length(1, 120)
  title?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @trimmedOrNull
  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Null drops the date; a date or mileage must remain.' })
  @IsOptional()
  @Validate(IsCalendarDate)
  dueDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ODOMETER_KM)
  dueOdometerKm?: number | null;

  @ApiPropertyOptional()
  @IsOptionalProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  notifyBeforeDays?: number;

  @ApiPropertyOptional()
  @IsOptionalProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  notifyBeforeKm?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Null stops it repeating.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_REPEAT_MONTHS)
  repeatEveryMonths?: number | null;
}

export class ListRemindersQueryDto {
  @ApiPropertyOptional({ enum: ReminderStatus })
  @IsOptional()
  @IsEnum(ReminderStatus)
  status?: ReminderStatus;

  @ApiPropertyOptional({ example: '2027-01-01', description: 'Due on or before this date.' })
  @IsOptional()
  @Validate(IsCalendarDate)
  dueBefore?: string;
}
