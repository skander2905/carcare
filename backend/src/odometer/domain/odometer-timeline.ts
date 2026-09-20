/** A neighbouring reading on the timeline, as far as validation cares. */
export interface TimelineNeighbour {
  odometerKm: number;
  recordedAt: Date;
}

export type TimelineConflict =
  | { kind: 'below-previous'; neighbour: TimelineNeighbour }
  | { kind: 'above-next'; neighbour: TimelineNeighbour };

/**
 * Whether a reading can sit where it claims to on the timeline.
 *
 * The naive rule — "must exceed the vehicle's current mileage" — is wrong as
 * soon as someone records a reading they forgot to enter last month, which is
 * the single most common correction. The real invariant is local: an odometer
 * only counts up, so a reading must be at least its predecessor in time and at
 * most its successor.
 *
 * Equal values are allowed on both sides. A car can genuinely sit unused
 * between two readings, and rejecting that would make a parked vehicle
 * impossible to log.
 */
export function findTimelineConflict(
  odometerKm: number,
  previous: TimelineNeighbour | null,
  next: TimelineNeighbour | null,
): TimelineConflict | null {
  if (previous && odometerKm < previous.odometerKm) {
    return { kind: 'below-previous', neighbour: previous };
  }

  if (next && odometerKm > next.odometerKm) {
    return { kind: 'above-next', neighbour: next };
  }

  return null;
}

/**
 * Explains a conflict in terms the person can act on.
 *
 * It names the reading in the way, and its value and date, because "invalid
 * odometer" leaves someone staring at a form with no idea which of their
 * entries is the problem.
 */
export function describeConflict(conflict: TimelineConflict): string {
  const km = conflict.neighbour.odometerKm.toLocaleString('en-GB');
  const on = conflict.neighbour.recordedAt.toISOString().slice(0, 10);

  return conflict.kind === 'below-previous'
    ? `Odometer cannot be lower than the previous reading of ${km} km on ${on}`
    : `Odometer cannot be higher than the next reading of ${km} km on ${on}`;
}

/**
 * The vehicle's headline mileage after a reading lands.
 *
 * Takes the maximum rather than the new value, because a backdated reading is
 * older than the current figure and must not drag it down.
 */
export function nextCurrentOdometer(current: number, reading: number): number {
  return Math.max(current, reading);
}

/**
 * Distance covered between the first and last readings in a period.
 *
 * Returns `null`, never zero, when there is not enough data — a single reading
 * says nothing about distance. This is the denominator of cost per kilometre,
 * and ADR-012 is explicit that an honest blank beats a confidently wrong zero.
 */
export function distanceBetween(readings: readonly { odometerKm: number }[]): number | null {
  if (readings.length < 2) return null;

  let lowest = readings[0].odometerKm;
  let highest = readings[0].odometerKm;

  for (const { odometerKm } of readings) {
    if (odometerKm < lowest) lowest = odometerKm;
    if (odometerKm > highest) highest = odometerKm;
  }

  const distance = highest - lowest;
  return distance > 0 ? distance : null;
}
