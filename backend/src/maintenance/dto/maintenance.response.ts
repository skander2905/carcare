import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { toMoneyString } from '../../common/http/decimal.js';
import { MaintenanceType } from '../../generated/prisma/enums.js';
import { type KmDue, type MaintenanceStatus, type TimeDue } from '../domain/due.js';
import { type MaintenanceRecordRow } from '../maintenance.repository.js';
import { type MaintenanceSuggestions } from '../maintenance.service.js';
import { type ScheduleWithDue } from '../schedules.service.js';

const STATUSES: MaintenanceStatus[] = ['UNKNOWN', 'UPCOMING', 'DUE_SOON', 'DUE', 'OVERDUE'];
const DIMENSION_STATUSES = STATUSES.filter((s) => s !== 'UNKNOWN');

export class MaintenanceRecordResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  vehicleId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'The ledger row; receipts attach to it. Null for a free service.',
  })
  expenseId: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  scheduleId: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Oil and filter' })
  scheduleName: string | null;

  @ApiProperty({ enum: MaintenanceType })
  type: MaintenanceType;

  @ApiProperty()
  performedAt: string;

  @ApiProperty({ example: 121_480 })
  odometerKm: number;

  @ApiPropertyOptional({ nullable: true, example: '120.250' })
  partsCost: string | null;

  @ApiPropertyOptional({ nullable: true, example: '60.000' })
  laborCost: string | null;

  @ApiProperty({ example: '180.250' })
  totalCost: string;

  @ApiPropertyOptional({ nullable: true })
  serviceProvider: string | null;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes: string | null;

  @ApiProperty({ example: 1 })
  attachmentCount: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  createdById: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export function toRecordResponse(record: MaintenanceRecordRow): MaintenanceRecordResponse {
  return {
    id: record.id,
    vehicleId: record.vehicleId,
    expenseId: record.expenseId,
    scheduleId: record.scheduleId,
    scheduleName: record.schedule?.name ?? null,
    type: record.type,
    performedAt: record.performedAt.toISOString(),
    odometerKm: record.odometerKm,
    partsCost: toMoneyString(record.partsCost),
    laborCost: toMoneyString(record.laborCost),
    totalCost: toMoneyString(record.totalCost)!,
    serviceProvider: record.serviceProvider,
    description: record.description,
    notes: record.notes,
    attachmentCount: record.expense?._count.documents ?? 0,
    createdById: record.createdById,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export class KmDueResponse {
  @ApiProperty({ example: 115_000, description: 'Mileage at the last service.' })
  lastKm: number;

  @ApiProperty({ example: 125_000 })
  dueAtKm: number;

  @ApiProperty({ example: 3520, description: 'Negative once passed.' })
  remainingKm: number;

  @ApiProperty({ example: 0.648, description: 'Share of the interval used; above 1 once passed.' })
  progress: number;

  @ApiProperty({ enum: DIMENSION_STATUSES })
  status: KmDue['status'];
}

export class TimeDueResponse {
  @ApiProperty({ example: '2026-03-01', description: "Calendar date in the owner's time zone." })
  lastDate: string;

  @ApiProperty({ example: '2027-03-01' })
  dueDate: string;

  @ApiProperty({ example: 152, description: 'Negative once passed; 0 is today.' })
  remainingDays: number;

  @ApiProperty({ example: 0.582 })
  progress: number;

  @ApiProperty({ enum: DIMENSION_STATUSES })
  status: TimeDue['status'];
}

export class DueResponse {
  @ApiProperty({
    enum: STATUSES,
    description:
      'The more urgent of the two dimensions. UNKNOWN when there is no service to count from: log one, or give the schedule a baseline.',
  })
  status: MaintenanceStatus;

  @ApiPropertyOptional({ type: KmDueResponse, nullable: true })
  km: KmDueResponse | null;

  @ApiPropertyOptional({ type: TimeDueResponse, nullable: true })
  time: TimeDueResponse | null;
}

export class ScheduleResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  vehicleId: string;

  @ApiProperty({ enum: MaintenanceType })
  type: MaintenanceType;

  @ApiProperty({ example: 'Oil and filter' })
  name: string;

  @ApiPropertyOptional({ nullable: true, example: 10_000 })
  intervalKm: number | null;

  @ApiPropertyOptional({ nullable: true, example: 12 })
  intervalMonths: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Baseline; logged records supersede it.' })
  lastServiceOdometerKm: number | null;

  @ApiPropertyOptional({ nullable: true })
  lastServiceAt: string | null;

  @ApiProperty({ example: 1000 })
  notifyBeforeKm: number;

  @ApiProperty({ example: 30 })
  notifyBeforeDays: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ example: 2, description: 'Logged records linked to this schedule.' })
  serviceCount: number;

  @ApiProperty({ type: DueResponse, description: 'Derived on every read; never stored.' })
  due: DueResponse;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export function toScheduleResponse({ schedule, due, serviceCount }: ScheduleWithDue): ScheduleResponse {
  return {
    id: schedule.id,
    vehicleId: schedule.vehicleId,
    type: schedule.type,
    name: schedule.name,
    intervalKm: schedule.intervalKm,
    intervalMonths: schedule.intervalMonths,
    lastServiceOdometerKm: schedule.lastServiceOdometerKm,
    lastServiceAt: schedule.lastServiceAt?.toISOString() ?? null,
    notifyBeforeKm: schedule.notifyBeforeKm,
    notifyBeforeDays: schedule.notifyBeforeDays,
    isActive: schedule.isActive,
    serviceCount,
    due,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}

export class MaintenanceSuggestionsResponse {
  @ApiProperty({
    example: 121_480,
    description: 'A hint for the mileage field; never filled in for the user.',
  })
  currentOdometerKm: number;

  @ApiProperty({ type: [String], example: ['Garage Ben Arous'], description: 'Most recent first.' })
  recentProviders: string[];
}

export const toSuggestionsResponse = (s: MaintenanceSuggestions): MaintenanceSuggestionsResponse => s;
