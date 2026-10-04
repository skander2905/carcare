/**
 * The due engine: when a recurring service falls due, and how close it is.
 *
 * Pure, like the consumption engine. Nothing here is stored — a schedule's
 * status depends on today's date and the car's current mileage, so a stored
 * copy would be wrong the moment either moved (database.md, ADR-019).
 *
 * Dates are calendar dates in the owner's time zone, never instants. "Twelve
 * months after 31 January" is the last day of the following February, and
 * "due today" means the owner's today — arithmetic on milliseconds gets both
 * wrong for an hour or a day at a time.
 */

export type MaintenanceStatus = 'UNKNOWN' | 'UPCOMING' | 'DUE_SOON' | 'DUE' | 'OVERDUE';

/** Most urgent first. Also the order a vehicle's schedules are listed in. */
export const URGENCY: Record<MaintenanceStatus, number> = {
  OVERDUE: 0,
  DUE: 1,
  DUE_SOON: 2,
  UNKNOWN: 3,
  UPCOMING: 4,
};

export interface ScheduleTerms {
  intervalKm: number | null;
  intervalMonths: number | null;
  notifyBeforeKm: number;
  notifyBeforeDays: number;
}

/** A service that happened: a logged record, or the schedule's baseline. Either half may be unknown. */
export interface ServicePoint {
  odometerKm: number | null;
  performedAt: Date | null;
}

export interface DueInput {
  terms: ScheduleTerms;
  /** The baseline and every record linked to the schedule, in any order. */
  services: ServicePoint[];
  currentOdometerKm: number;
  now: Date;
  /** IANA name, e.g. Africa/Tunis. */
  timeZone: string;
}

export interface KmDue {
  lastKm: number;
  dueAtKm: number;
  /** Negative once passed. */
  remainingKm: number;
  /** Share of the interval used, from 0; above 1 once passed. */
  progress: number;
  status: Exclude<MaintenanceStatus, 'UNKNOWN'>;
}

export interface TimeDue {
  /** YYYY-MM-DD in the owner's time zone. */
  lastDate: string;
  dueDate: string;
  /** Negative once passed; 0 means due today. */
  remainingDays: number;
  progress: number;
  status: Exclude<MaintenanceStatus, 'UNKNOWN'>;
}

export interface DueState {
  status: MaintenanceStatus;
  /** Null when the schedule has no km interval, or no service with a mileage to count from. */
  km: KmDue | null;
  time: TimeDue | null;
}

export function dueState({ terms, services, currentOdometerKm, now, timeZone }: DueInput): DueState {
  const lastKm = maxOf(services.map((s) => s.odometerKm));
  const lastAt = maxOf(services.map((s) => s.performedAt?.getTime() ?? null));

  const km =
    terms.intervalKm !== null && lastKm !== null
      ? kmDue(lastKm, terms.intervalKm, terms.notifyBeforeKm, currentOdometerKm)
      : null;

  const time =
    terms.intervalMonths !== null && lastAt !== null
      ? timeDue(
          calendarDate(new Date(lastAt), timeZone),
          terms.intervalMonths,
          terms.notifyBeforeDays,
          calendarDate(now, timeZone),
        )
      : null;

  // Whichever comes first: the more urgent of the two dimensions.
  return { status: mostUrgent([km?.status, time?.status]), km, time };
}

function kmDue(lastKm: number, intervalKm: number, notifyBeforeKm: number, currentKm: number): KmDue {
  const dueAtKm = lastKm + intervalKm;
  const remainingKm = dueAtKm - currentKm;
  return {
    lastKm,
    dueAtKm,
    remainingKm,
    progress: ratio(currentKm - lastKm, intervalKm),
    status: classify(remainingKm, notifyBeforeKm),
  };
}

function timeDue(lastDate: string, intervalMonths: number, notifyBeforeDays: number, today: string): TimeDue {
  const dueDate = addMonths(lastDate, intervalMonths);
  const remainingDays = daysBetween(today, dueDate);
  return {
    lastDate,
    dueDate,
    remainingDays,
    progress: ratio(daysBetween(lastDate, today), daysBetween(lastDate, dueDate)),
    status: classify(remainingDays, notifyBeforeDays),
  };
}

/**
 * One notify window either side of the due point:
 *
 *   UPCOMING  more than the window away
 *   DUE_SOON  within the window, not yet reached
 *   DUE       reached, and passed by less than the window
 *   OVERDUE   passed by the window or more
 *
 * A window of zero still leaves one unit of "due" — the day, or the kilometre,
 * it falls on — rather than jumping straight from upcoming to overdue.
 */
function classify(remaining: number, window: number): Exclude<MaintenanceStatus, 'UNKNOWN'> {
  if (remaining > window) return 'UPCOMING';
  if (remaining > 0) return 'DUE_SOON';
  if (-remaining < Math.max(window, 1)) return 'DUE';
  return 'OVERDUE';
}

/**
 * A fixed due point rather than an interval: "the insurance renews on
 * 1 March", "the warranty ends at 100,000 km". Used by reminders, which fall
 * due once; classified by exactly the same rule as a schedule.
 */
export interface DuePoint {
  dueAtKm: number | null;
  /** YYYY-MM-DD in the owner's time zone. */
  dueDate: string | null;
  notifyBeforeKm: number;
  notifyBeforeDays: number;
}

export interface PointDueState {
  /** UNKNOWN only when neither half is set, which the reminders table refuses. */
  status: MaintenanceStatus;
  km: { dueAtKm: number; remainingKm: number; status: Exclude<MaintenanceStatus, 'UNKNOWN'> } | null;
  time: { dueDate: string; remainingDays: number; status: Exclude<MaintenanceStatus, 'UNKNOWN'> } | null;
}

export function dueAt(
  point: DuePoint,
  { currentOdometerKm, now, timeZone }: { currentOdometerKm: number; now: Date; timeZone: string },
): PointDueState {
  const km =
    point.dueAtKm === null
      ? null
      : {
          dueAtKm: point.dueAtKm,
          remainingKm: point.dueAtKm - currentOdometerKm,
          status: classify(point.dueAtKm - currentOdometerKm, point.notifyBeforeKm),
        };

  const time =
    point.dueDate === null
      ? null
      : (() => {
          const remainingDays = daysBetween(calendarDate(now, timeZone), point.dueDate);
          return {
            dueDate: point.dueDate,
            remainingDays,
            status: classify(remainingDays, point.notifyBeforeDays),
          };
        })();

  return { status: mostUrgent([km?.status, time?.status]), km, time };
}

/** Most urgent of whichever statuses are known; UNKNOWN when none are. */
function mostUrgent(statuses: (MaintenanceStatus | undefined)[]): MaintenanceStatus {
  const known = statuses.filter((s) => s !== undefined);
  return known.length === 0 ? 'UNKNOWN' : known.reduce((a, b) => (URGENCY[a] <= URGENCY[b] ? a : b));
}

/** Compares two states for listing: most urgent first, then furthest through its interval. */
export function byUrgency(a: DueState, b: DueState): number {
  return URGENCY[a.status] - URGENCY[b.status] || progressOf(b) - progressOf(a);
}

function progressOf(state: DueState): number {
  return Math.max(state.km?.progress ?? 0, state.time?.progress ?? 0);
}

/** Three places is plenty for a progress bar, and keeps responses stable. */
function ratio(used: number, whole: number): number {
  return Math.max(0, Math.round((used / whole) * 1000) / 1000);
}

function maxOf(values: (number | null)[]): number | null {
  return values.reduce<number | null>((max, v) => (v !== null && (max === null || v > max) ? v : max), null);
}

// --- calendar dates -------------------------------------------------------

/** The instant's date as the owner's wall calendar shows it, YYYY-MM-DD. */
export function calendarDate(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Calendar months, clamped to the end of a shorter month: 2026-01-31 + 1 → 2026-02-28. */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return [targetYear, targetMonth, Math.min(day, lastDay)]
    .map((part, i) => String(part).padStart(i === 0 ? 4 : 2, '0'))
    .join('-');
}

/** Whole days from one calendar date to another; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
