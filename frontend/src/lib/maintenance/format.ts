import { formatKm } from '@/lib/vehicles/format';
import { type Due, type MaintenanceStatus, type MaintenanceType, type Schedule } from './types';

const TYPE_LABELS: Record<MaintenanceType, string> = {
  OIL_CHANGE: 'Oil change',
  OIL_FILTER: 'Oil filter',
  AIR_FILTER: 'Air filter',
  CABIN_FILTER: 'Cabin filter',
  BRAKE_PADS: 'Brake pads',
  BRAKE_DISCS: 'Brake discs',
  TIRES: 'Tyres',
  BATTERY: 'Battery',
  COOLANT: 'Coolant',
  TRANSMISSION: 'Transmission',
  TIMING_BELT: 'Timing belt',
  INSPECTION: 'Inspection',
  OTHER: 'Other',
};

export const maintenanceLabel = (type: MaintenanceType): string => TYPE_LABELS[type] ?? type;

/** Shown first as chips; the rest sit behind "More". Roughly how often each job comes up. */
export const COMMON_TYPES: MaintenanceType[] = [
  'OIL_CHANGE',
  'TIRES',
  'BRAKE_PADS',
  'INSPECTION',
  'BATTERY',
  'AIR_FILTER',
];

export const ALL_TYPES = Object.keys(TYPE_LABELS) as MaintenanceType[];

export interface SchedulePreset {
  type: MaintenanceType;
  name: string;
  intervalKm: number | null;
  intervalMonths: number | null;
}

/**
 * Typical intervals for a petrol or diesel car, as one-tap starting points.
 * Every manufacturer differs, so the form says so and leaves them editable —
 * they save typing, they are not advice.
 */
export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { type: 'OIL_CHANGE', name: 'Oil and filter', intervalKm: 10_000, intervalMonths: 12 },
  { type: 'INSPECTION', name: 'Technical inspection', intervalKm: null, intervalMonths: 12 },
  { type: 'AIR_FILTER', name: 'Air filter', intervalKm: 20_000, intervalMonths: 24 },
  { type: 'CABIN_FILTER', name: 'Cabin filter', intervalKm: 15_000, intervalMonths: 12 },
  { type: 'BRAKE_PADS', name: 'Brake pads', intervalKm: 40_000, intervalMonths: null },
  { type: 'TIRES', name: 'Tyres', intervalKm: 50_000, intervalMonths: 60 },
  { type: 'COOLANT', name: 'Coolant', intervalKm: 60_000, intervalMonths: 48 },
  { type: 'BATTERY', name: 'Battery', intervalKm: null, intervalMonths: 48 },
  { type: 'TIMING_BELT', name: 'Timing belt', intervalKm: 100_000, intervalMonths: 60 },
];

const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  OVERDUE: 'Overdue',
  DUE: 'Due',
  DUE_SOON: 'Due soon',
  UPCOMING: 'OK',
  UNKNOWN: 'Not tracked yet',
};

export const statusLabel = (status: MaintenanceStatus): string => STATUS_LABELS[status];

/** Statuses that ask for something to be done. */
export const needsAttention = (status: MaintenanceStatus): boolean =>
  status === 'OVERDUE' || status === 'DUE' || status === 'DUE_SOON';

/** "1 Mar 2027" for a calendar date. Formatted in UTC so the date never slips a day. */
export function formatCalendarDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function kmPhrase(remainingKm: number): string {
  if (remainingKm > 0) return `in ${formatKm(remainingKm)}`;
  if (remainingKm === 0) return 'now';
  return `${formatKm(-remainingKm)} overdue`;
}

function timePhrase(remainingDays: number, dueDate: string): string {
  if (remainingDays === 0) return 'today';
  if (remainingDays < 0) {
    return remainingDays === -1 ? '1 day overdue' : `${-remainingDays} days overdue`;
  }
  // Close dates read better as a count; far ones as the date itself.
  if (remainingDays <= 45) return remainingDays === 1 ? 'tomorrow' : `in ${remainingDays} days`;
  return `by ${formatCalendarDate(dueDate)}`;
}

/**
 * What `dueSummary` reads. A schedule's `Due` has more (progress, the last
 * service); a reminder's fixed due point has exactly this.
 */
export interface DueLike {
  status: MaintenanceStatus;
  km: { remainingKm: number } | null;
  time: { remainingDays: number; dueDate: string } | null;
}

/**
 * One line saying when a service falls due: "In 3,520 km or by 1 Mar 2027".
 *
 * Both dimensions are named when both are tracked, since whichever comes
 * first is the one that counts — and a person reading "in 3,520 km" alone
 * would not know the calendar was about to beat it.
 */
export function dueSummary(due: DueLike): string {
  if (due.status === 'UNKNOWN') return 'Log the last one, or say when it was done, to start tracking';

  const parts: string[] = [];
  if (due.km) parts.push(kmPhrase(due.km.remainingKm));
  if (due.time) parts.push(timePhrase(due.time.remainingDays, due.time.dueDate));

  const overdue = parts.filter((p) => p.endsWith('overdue'));
  if (overdue.length > 0) return capitalise(overdue.join(' · '));

  return `Due ${parts.join(' or ')}`;
}

/** "Every 10,000 km or 12 months". */
export function intervalSummary(schedule: Pick<Schedule, 'intervalKm' | 'intervalMonths'>): string {
  const parts: string[] = [];
  if (schedule.intervalKm) parts.push(formatKm(schedule.intervalKm));
  if (schedule.intervalMonths) {
    parts.push(schedule.intervalMonths === 1 ? '1 month' : `${schedule.intervalMonths} months`);
  }
  return `Every ${parts.join(' or ')}`;
}

/** The share of the interval used, for a progress bar: the further of the two, capped at 1. */
export function dueProgress(due: Due): number {
  return Math.min(1, Math.max(due.km?.progress ?? 0, due.time?.progress ?? 0));
}

/**
 * The schedule a new service of this type most likely satisfies: the one
 * active schedule of that type. With two or more, guessing would restart the
 * wrong one, so nothing is preselected.
 */
export function matchingSchedule(type: MaintenanceType, schedules: Schedule[]): Schedule | null {
  const candidates = schedules.filter((s) => s.isActive && s.type === type);
  return candidates.length === 1 ? candidates[0] : null;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// --- costs ----------------------------------------------------------------

/** Millimes, allowing zero — a service can be free. Comma accepted, as French keyboards type it. */
function toMillimes(value: string): number | null {
  const normalised = value.trim().replace(',', '.');
  if (!/^\d{1,9}(?:\.\d{0,3})?$/.test(normalised)) return null;
  const [whole, fraction = ''] = normalised.split('.');
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0') || '0');
}

const fromMillimes = (millimes: number) =>
  `${Math.trunc(millimes / 1000)}.${String(millimes % 1000).padStart(3, '0')}`;

/** A cost as the API wants it — three places, dot-separated — or null if it is not one. */
export function normaliseCost(value: string): string | null {
  const millimes = toMillimes(value);
  return millimes === null ? null : fromMillimes(millimes);
}

/** Parts plus labour, exactly; null unless both are valid. */
export function sumCosts(parts: string, labor: string): string | null {
  const p = toMillimes(parts);
  const l = toMillimes(labor);
  return p === null || l === null ? null : fromMillimes(p + l);
}

export const isFree = (cost: string): boolean => toMillimes(cost) === 0;
