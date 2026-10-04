import { type MaintenanceStatus } from '../../maintenance/domain/due.js';

/**
 * What the sweep says when something falls due, and how it recognises having
 * said it already.
 *
 * Pure: the sweep hands in a due state, and gets back a notification to insert
 * or nothing. Wording mirrors the web app's due line, so an email reads the
 * same as the screen it links to.
 */

export type AlertStatus = Extract<MaintenanceStatus, 'DUE_SOON' | 'DUE' | 'OVERDUE'>;
export type AlertType = 'MAINTENANCE_DUE' | 'REMINDER_DUE';

export interface Alert {
  type: AlertType;
  title: string;
  body: string;
  data: AlertData;
  dedupeKey: string;
}

export interface AlertData {
  status: AlertStatus;
  vehicleId: string;
  scheduleId?: string;
  reminderId?: string;
}

/** Either kind of due state, reduced to what the wording needs. */
export interface DueSnapshot {
  status: MaintenanceStatus;
  km: { dueAtKm: number; remainingKm: number } | null;
  time: { dueDate: string; remainingDays: number } | null;
}

export interface Subject {
  id: string;
  /** "Oil and filter", "Insurance renewal". */
  name: string;
}

export interface VehicleLabel {
  id: string;
  /** "Peugeot 208", or the nickname. */
  name: string;
}

const ALERTING: readonly MaintenanceStatus[] = ['DUE_SOON', 'DUE', 'OVERDUE'];

const isAlerting = (status: MaintenanceStatus): status is AlertStatus => ALERTING.includes(status);

/** A recurring service crossing into due-soon, due or overdue; null while it is fine or untracked. */
export function scheduleAlert(schedule: Subject, vehicle: VehicleLabel, due: DueSnapshot): Alert | null {
  if (!isAlerting(due.status)) return null;
  return {
    type: 'MAINTENANCE_DUE',
    title: `${schedule.name} ${HEADLINE[due.status]} · ${vehicle.name}`,
    body: dueSentence(due),
    data: { status: due.status, vehicleId: vehicle.id, scheduleId: schedule.id },
    dedupeKey: dedupeKey('maintenance', schedule.id, due),
  };
}

/** The same for a one-off reminder. */
export function reminderAlert(reminder: Subject, vehicle: VehicleLabel, due: DueSnapshot): Alert | null {
  if (!isAlerting(due.status)) return null;
  return {
    type: 'REMINDER_DUE',
    title: `${reminder.name} ${HEADLINE[due.status]} · ${vehicle.name}`,
    body: dueSentence(due),
    data: { status: due.status, vehicleId: vehicle.id, reminderId: reminder.id },
    dedupeKey: dedupeKey('reminder', reminder.id, due),
  };
}

const HEADLINE: Record<AlertStatus, string> = {
  DUE_SOON: 'is due soon',
  DUE: 'is due',
  OVERDUE: 'is overdue',
};

/**
 * One notification per status per due point.
 *
 * The status alone would say "due soon" once ever, so the second oil change
 * would pass in silence. The due point alone would say it once per cycle and
 * swallow the escalation to overdue. Together: each step is announced once for
 * each cycle, and logging the service moves the due point, opening the next.
 *
 * A status that slips back — a mistaken reading deleted — and returns finds
 * its key already used, which is right: nothing new happened.
 */
export function dedupeKey(kind: 'maintenance' | 'reminder', id: string, due: DueSnapshot): string {
  const point = `${due.km?.dueAtKm ?? '-'}km/${due.time?.dueDate ?? '-'}`;
  return `${kind}:${id}:${due.status}:${point}`;
}

// --- wording, as the web app's dueSummary ----------------------------------

const kmFormat = new Intl.NumberFormat('en-GB');

/** "Due in 820 km or in 12 days." / "1,480 km overdue." */
export function dueSentence(due: DueSnapshot): string {
  const parts: string[] = [];
  if (due.km) parts.push(kmPhrase(due.km.remainingKm));
  if (due.time) parts.push(timePhrase(due.time.remainingDays, due.time.dueDate));

  const overdue = parts.filter((p) => p.endsWith('overdue'));
  if (overdue.length > 0) return `${capitalise(overdue.join(' · '))}.`;
  return `Due ${parts.join(' or ')}.`;
}

function kmPhrase(remainingKm: number): string {
  if (remainingKm > 0) return `in ${kmFormat.format(remainingKm)} km`;
  if (remainingKm === 0) return 'now';
  return `${kmFormat.format(-remainingKm)} km overdue`;
}

function timePhrase(remainingDays: number, dueDate: string): string {
  if (remainingDays === 0) return 'today';
  if (remainingDays < 0) return remainingDays === -1 ? '1 day overdue' : `${-remainingDays} days overdue`;
  if (remainingDays <= 45) return remainingDays === 1 ? 'tomorrow' : `in ${remainingDays} days`;
  return `by ${formatCalendarDate(dueDate)}`;
}

/** "1 Mar 2027". Formatted in UTC so the date never slips a day. */
export function formatCalendarDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
