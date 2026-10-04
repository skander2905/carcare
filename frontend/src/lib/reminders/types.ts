import { type MaintenanceStatus } from '@/lib/maintenance/types';

export type ReminderType = 'INSURANCE' | 'ROAD_TAX' | 'LOAN' | 'WARRANTY' | 'OTHER';
export type ReminderStatus = 'PENDING' | 'COMPLETED';

/** Derived by the API on every read; null once completed. */
export interface ReminderDue {
  status: MaintenanceStatus;
  km: { dueAtKm: number; remainingKm: number; status: MaintenanceStatus } | null;
  time: { dueDate: string; remainingDays: number; status: MaintenanceStatus } | null;
}

/** Mirrors `ReminderResponse`. */
export interface Reminder {
  id: string;
  vehicleId: string;
  type: ReminderType;
  title: string;
  description: string | null;
  /** YYYY-MM-DD on the owner's calendar. */
  dueDate: string | null;
  dueOdometerKm: number | null;
  notifyBeforeDays: number;
  notifyBeforeKm: number;
  repeatEveryMonths: number | null;
  status: ReminderStatus;
  completedAt: string | null;
  /** Papers kept with it, e.g. the insurance certificate. */
  attachmentCount: number;
  due: ReminderDue | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderInput {
  type: ReminderType;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  dueOdometerKm?: number | null;
  notifyBeforeDays?: number;
  notifyBeforeKm?: number;
  repeatEveryMonths?: number | null;
}

export interface Completion {
  completed: Reminder;
  next: Reminder | null;
}
