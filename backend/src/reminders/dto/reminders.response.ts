import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReminderStatus, ReminderType } from '../../generated/prisma/enums.js';
import { type Completion, type ReminderWithDue, dateOf } from '../reminders.service.js';

const STATUSES = ['UNKNOWN', 'UPCOMING', 'DUE_SOON', 'DUE', 'OVERDUE'];

export class ReminderKmDueResponse {
  @ApiProperty({ example: 130_000 })
  dueAtKm: number;

  @ApiProperty({ example: 820, description: 'Negative once passed.' })
  remainingKm: number;

  @ApiProperty({ enum: STATUSES })
  status: string;
}

export class ReminderTimeDueResponse {
  @ApiProperty({ example: '2027-03-01' })
  dueDate: string;

  @ApiProperty({ example: 12, description: 'Negative once passed; 0 is today.' })
  remainingDays: number;

  @ApiProperty({ enum: STATUSES })
  status: string;
}

export class ReminderDueResponse {
  @ApiProperty({ enum: STATUSES })
  status: string;

  @ApiPropertyOptional({ type: ReminderKmDueResponse, nullable: true })
  km: ReminderKmDueResponse | null;

  @ApiPropertyOptional({ type: ReminderTimeDueResponse, nullable: true })
  time: ReminderTimeDueResponse | null;
}

export class ReminderResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  vehicleId: string;

  @ApiProperty({ enum: ReminderType })
  type: ReminderType;

  @ApiProperty({ example: 'Insurance renewal' })
  title: string;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2027-03-01' })
  dueDate: string | null;

  @ApiPropertyOptional({ nullable: true, example: 130_000 })
  dueOdometerKm: number | null;

  @ApiProperty({ example: 30 })
  notifyBeforeDays: number;

  @ApiProperty({ example: 1000 })
  notifyBeforeKm: number;

  @ApiPropertyOptional({ nullable: true, example: 12 })
  repeatEveryMonths: number | null;

  @ApiProperty({ enum: ReminderStatus })
  status: ReminderStatus;

  @ApiPropertyOptional({ nullable: true })
  completedAt: string | null;

  @ApiPropertyOptional({
    type: ReminderDueResponse,
    nullable: true,
    description: 'Derived on every read; null once completed.',
  })
  due: ReminderDueResponse | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export function toReminderResponse({ reminder, due }: ReminderWithDue): ReminderResponse {
  return {
    id: reminder.id,
    vehicleId: reminder.vehicleId,
    type: reminder.type,
    title: reminder.title,
    description: reminder.description,
    dueDate: dateOf(reminder.dueDate),
    dueOdometerKm: reminder.dueOdometerKm,
    notifyBeforeDays: reminder.notifyBeforeDays,
    notifyBeforeKm: reminder.notifyBeforeKm,
    repeatEveryMonths: reminder.repeatEveryMonths,
    status: reminder.status,
    completedAt: reminder.completedAt?.toISOString() ?? null,
    due,
    createdAt: reminder.createdAt.toISOString(),
    updatedAt: reminder.updatedAt.toISOString(),
  };
}

export class CompletionResponse {
  @ApiProperty({ type: ReminderResponse })
  completed: ReminderResponse;

  @ApiPropertyOptional({
    type: ReminderResponse,
    nullable: true,
    description: 'The next occurrence, if it repeats.',
  })
  next: ReminderResponse | null;
}

export const toCompletionResponse = ({ completed, next }: Completion): CompletionResponse => ({
  completed: toReminderResponse(completed),
  next: next ? toReminderResponse(next) : null,
});
