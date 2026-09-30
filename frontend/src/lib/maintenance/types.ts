export type MaintenanceType =
  | 'OIL_CHANGE'
  | 'OIL_FILTER'
  | 'AIR_FILTER'
  | 'CABIN_FILTER'
  | 'BRAKE_PADS'
  | 'BRAKE_DISCS'
  | 'TIRES'
  | 'BATTERY'
  | 'COOLANT'
  | 'TRANSMISSION'
  | 'TIMING_BELT'
  | 'INSPECTION'
  | 'OTHER';

/** Derived by the API on every read; never stored. */
export type MaintenanceStatus = 'UNKNOWN' | 'UPCOMING' | 'DUE_SOON' | 'DUE' | 'OVERDUE';

/** Mirrors `MaintenanceRecordResponse`. Money is a decimal string, never a float. */
export interface MaintenanceRecord {
  id: string;
  vehicleId: string;
  /** Null for a free service, which has no ledger row — and so no receipts. */
  expenseId: string | null;
  scheduleId: string | null;
  scheduleName: string | null;
  type: MaintenanceType;
  performedAt: string;
  odometerKm: number;
  partsCost: string | null;
  laborCost: string | null;
  totalCost: string;
  serviceProvider: string | null;
  description: string | null;
  notes: string | null;
  attachmentCount: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KmDue {
  lastKm: number;
  dueAtKm: number;
  remainingKm: number;
  progress: number;
  status: Exclude<MaintenanceStatus, 'UNKNOWN'>;
}

export interface TimeDue {
  /** YYYY-MM-DD in the owner's time zone. */
  lastDate: string;
  dueDate: string;
  remainingDays: number;
  progress: number;
  status: Exclude<MaintenanceStatus, 'UNKNOWN'>;
}

export interface Due {
  status: MaintenanceStatus;
  km: KmDue | null;
  time: TimeDue | null;
}

export interface Schedule {
  id: string;
  vehicleId: string;
  type: MaintenanceType;
  name: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  lastServiceOdometerKm: number | null;
  lastServiceAt: string | null;
  notifyBeforeKm: number;
  notifyBeforeDays: number;
  isActive: boolean;
  serviceCount: number;
  due: Due;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceSuggestions {
  currentOdometerKm: number;
  recentProviders: string[];
}

export interface MaintenanceFilters {
  type?: MaintenanceType;
  provider?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface CreateRecordInput {
  type: MaintenanceType;
  performedAt?: string;
  odometerKm: number;
  scheduleId?: string;
  partsCost?: string;
  laborCost?: string;
  totalCost?: string;
  serviceProvider?: string;
  description?: string;
  notes?: string;
}

export interface UpdateRecordInput {
  type?: MaintenanceType;
  performedAt?: string;
  odometerKm?: number;
  scheduleId?: string | null;
  partsCost?: string | null;
  laborCost?: string | null;
  totalCost?: string;
  serviceProvider?: string | null;
  description?: string | null;
  notes?: string | null;
}

export interface ScheduleInput {
  type: MaintenanceType;
  name?: string;
  intervalKm?: number | null;
  intervalMonths?: number | null;
  lastServiceOdometerKm?: number | null;
  lastServiceAt?: string | null;
  notifyBeforeKm?: number;
  notifyBeforeDays?: number;
  isActive?: boolean;
}
