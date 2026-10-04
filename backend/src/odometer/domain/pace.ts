/**
 * How much a car is usually driven, from its own readings.
 *
 * Pure. Used only to *suggest* a mileage the person then confirms, so it
 * prefers saying nothing to saying something shaky: too few readings, or
 * readings too close together, give null.
 */

export interface PacePoint {
  odometerKm: number;
  recordedAt: Date;
}

const DAY = 86_400_000;
/** Shorter spans are dominated by one long trip. */
export const MIN_SPAN_DAYS = 14;

/** Kilometres per day across the readings, one decimal; null when there is not enough to go on. */
export function kmPerDay(points: PacePoint[]): number | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const days = (last.recordedAt.getTime() - first.recordedAt.getTime()) / DAY;
  if (days < MIN_SPAN_DAYS) return null;
  const distance = last.odometerKm - first.odometerKm;
  if (distance <= 0) return null;
  return Math.round((distance / days) * 10) / 10;
}
