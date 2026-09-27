import { type ExpenseCategory, type ExpenseSource } from './types';

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  FUEL: 'Fuel',
  MAINTENANCE: 'Maintenance',
  REPAIR: 'Repair',
  INSURANCE: 'Insurance',
  TAX: 'Tax',
  PARKING: 'Parking',
  TOLL: 'Toll',
  CLEANING: 'Cleaning',
  ACCESSORIES: 'Accessories',
  TIRES: 'Tyres',
  INSPECTION: 'Inspection',
  OTHER: 'Other',
};

export const categoryLabel = (value: ExpenseCategory): string => CATEGORY_LABELS[value] ?? value;

const SOURCE_LABELS: Record<Exclude<ExpenseSource, 'MANUAL'>, string> = {
  FUEL: 'From a fill-up',
  MAINTENANCE: 'From a service',
};

/** Null for a hand-entered expense, which needs no explanation. */
export const sourceLabel = (value: ExpenseSource): string | null =>
  value === 'MANUAL' ? null : SOURCE_LABELS[value];

/** Positive, up to three decimal places — the server's rule, checked early. */
export const AMOUNT_PATTERN = /^(?!0+(?:\.0+)?$)\d{1,9}(?:\.\d{1,3})?$/;

/** `YYYY-MM-DD` for a local date, as an `<input type="date">` wants it. */
export function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDate(value: string, hours: number, minutes = 0, seconds = 0, ms = 0): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds, ms);
}

/**
 * The instant to file an expense at, from the day someone picked.
 *
 * Today means now, so an expense entered after this morning's odometer reading
 * lands after it on the timeline rather than at midnight, before it. A past day
 * has no known time, so it takes midday: the date then survives being shown in
 * any timezone within twelve hours of this one, where midnight would slip back
 * to the previous day for anyone west of here.
 */
export function incurredAtFromDate(value: string, now: Date = new Date()): string {
  if (value === toDateInputValue(now)) return now.toISOString();
  return localDate(value, 12).toISOString();
}

/**
 * A day range as the inclusive instants the API filters on.
 *
 * `to` is the *end* of the chosen day. Sending its start — what a bare
 * `YYYY-MM-DD` would mean — silently drops everything spent on that day.
 */
export function dayRange(from: string, to: string): { from?: string; to?: string } {
  return {
    ...(from ? { from: localDate(from, 0).toISOString() } : {}),
    ...(to ? { to: localDate(to, 23, 59, 59, 999).toISOString() } : {}),
  };
}

export function formatExpenseDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
