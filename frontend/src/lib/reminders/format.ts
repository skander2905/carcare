import { dueSummary } from '@/lib/maintenance/format';
import { type Reminder, type ReminderType } from './types';

export interface ReminderPreset {
  type: ReminderType;
  title: string;
  /** Repeats this often; null for a one-off. */
  repeatEveryMonths: number | null;
  /** Whether it is usually a mileage as well as a date. */
  withKm: boolean;
  notifyBeforeDays: number;
}

/** The common ones, one tap each. Renewals warn a month ahead; a monthly payment a few days. */
export const REMINDER_PRESETS: ReminderPreset[] = [
  {
    type: 'INSURANCE',
    title: 'Insurance renewal',
    repeatEveryMonths: 12,
    withKm: false,
    notifyBeforeDays: 30,
  },
  {
    type: 'ROAD_TAX',
    title: 'Road tax (vignette)',
    repeatEveryMonths: 12,
    withKm: false,
    notifyBeforeDays: 30,
  },
  { type: 'LOAN', title: 'Loan payment', repeatEveryMonths: 1, withKm: false, notifyBeforeDays: 5 },
  { type: 'WARRANTY', title: 'Warranty ends', repeatEveryMonths: null, withKm: true, notifyBeforeDays: 60 },
];

const TYPE_LABELS: Record<ReminderType, string> = {
  INSURANCE: 'Insurance',
  ROAD_TAX: 'Road tax',
  LOAN: 'Loan',
  WARRANTY: 'Warranty',
  OTHER: 'Other',
};

export const reminderTypeLabel = (type: ReminderType) => TYPE_LABELS[type];

/** "Every year", "Every month", "Every 6 months"; null for a one-off. */
export function repeatSummary(months: number | null): string | null {
  if (!months) return null;
  if (months === 12) return 'Every year';
  if (months === 1) return 'Every month';
  return months % 12 === 0 ? `Every ${months / 12} years` : `Every ${months} months`;
}

/** The due line, as on a schedule; a completed reminder says when it was done instead. */
export function reminderSummary(reminder: Reminder): string {
  if (!reminder.due) {
    const done = reminder.completedAt
      ? new Date(reminder.completedAt).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : null;
    return done ? `Done ${done}` : 'Done';
  }
  return dueSummary(reminder.due);
}

/** Today on the user's own calendar, YYYY-MM-DD — what a date input wants. */
export function todayInputValue(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** A date input's value n months on, clamped at month end like the API. */
export function addMonthsToDate(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}
