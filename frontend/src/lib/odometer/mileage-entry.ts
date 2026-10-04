/**
 * The thinking behind the mileage box, kept apart from the screen so it can be
 * tested: completing a number from its last digits, the trip counter, the
 * suggestion, the typo checks, and picking sensible numbers out of a photo.
 *
 * None of it ever fills the box by itself — it turns what the person typed or
 * tapped into a full reading, and says plainly what that reading means.
 */

export interface ReadingPoint {
  odometerKm: number;
  recordedAt: string;
}

/** Mirrors the API's `MileageContextResponse`. */
export interface MileageContext {
  previous: ReadingPoint | null;
  next: ReadingPoint | null;
  kmPerDay: number | null;
  lastFuelFill: ReadingPoint | null;
}

const DAY = 86_400_000;

/** Above this, a gap between two readings is almost certainly a typo: 1,500 km is a long day's drive. */
export const MAX_PLAUSIBLE_KM_PER_DAY = 1500;

/** Only the digits: people type spaces, commas and dots as separators. */
export const digitsOnly = (text: string) => text.replace(/\D/g, '');

/**
 * "122700" → "122,700", as the rest of the app writes kilometres. Done on the
 * text, not as a number, so leading zeros survive: "050" means "ends in 050".
 */
export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const groupKm = (km: number) => km.toLocaleString('en-GB');

/**
 * What the typed digits mean as a full reading.
 *
 * Fewer digits than the previous reading are its *end*: after 122,700 km,
 * "980" is 122,980 and "050" is 123,050 — the first reading at or above the
 * previous one that ends that way, like the wheels of a mechanical odometer.
 * As many digits as the previous reading, or more, are a full number.
 */
export function completeReading(
  typed: string,
  previousKm: number | null,
): { km: number; completed: boolean } | null {
  const digits = digitsOnly(typed);
  if (digits === '') return null;
  const value = Number(digits);
  if (previousKm === null || digits.length >= String(previousKm).length)
    return { km: value, completed: false };

  const base = 10 ** digits.length;
  let km = previousKm - (previousKm % base) + value;
  if (km < previousKm) km += base;
  return { km, completed: true };
}

/** The trip counter, reset at the last fill-up, added to that fill-up's reading. */
export const fromTrip = (tripKm: number, lastFillKm: number) => lastFillKm + tripKm;

/** "About 123,050 km": the previous reading plus the usual pace, to the nearest 10. */
export function estimateReading(context: MileageContext, at: Date): number | null {
  const { previous, kmPerDay } = context;
  if (!previous || kmPerDay === null) return null;
  const days = (at.getTime() - new Date(previous.recordedAt).getTime()) / DAY;
  if (days < 1) return null;
  const estimate = Math.round((previous.odometerKm + kmPerDay * days) / 10) * 10;
  return estimate > previous.odometerKm ? estimate : null;
}

export type Assessment =
  { level: 'ok'; message: string } | { level: 'warn'; message: string } | { level: 'error'; message: string };

/**
 * What a reading means next to the ones around it, in words.
 *
 * Errors are what the server would refuse anyway (below the previous reading,
 * above the next); a warning is something that passes but is probably a typo.
 */
export function assessReading(km: number, context: MileageContext, at: Date): Assessment {
  const { previous, next } = context;
  if (previous && km < previous.odometerKm) {
    return {
      level: 'error',
      message: `Lower than the ${groupKm(previous.odometerKm)} km recorded ${dayLabel(previous.recordedAt)}`,
    };
  }
  if (next && km > next.odometerKm) {
    return {
      level: 'error',
      message: `Higher than the ${groupKm(next.odometerKm)} km recorded later, ${dayLabel(next.recordedAt)}`,
    };
  }
  if (!previous) return { level: 'ok', message: `${groupKm(km)} km` };

  const distance = km - previous.odometerKm;
  const days = Math.max(1, Math.round((at.getTime() - new Date(previous.recordedAt).getTime()) / DAY));
  const when = dayLabel(previous.recordedAt);
  const since = `+${groupKm(distance)} km since ${when === 'today' ? 'earlier today' : when}`;
  if (distance / days > MAX_PLAUSIBLE_KM_PER_DAY) {
    const span = days === 1 ? 'a day' : `${days} days`;
    return { level: 'warn', message: `${since}. That's a lot for ${span}: check for a typo` };
  }
  return { level: 'ok', message: since };
}

/** "28 Sep", or "today". */
function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (date.toDateString() === now.toDateString()) return 'today';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * Numbers in a photo's text that could be this car's mileage.
 *
 * Dashboards show the clock, the trip counter and the temperature too, and
 * the reader mistakes digits. So: every run of digits (a space or a dot inside
 * a number is a separator), kept only when it fits between the readings either
 * side — and, after the previous one, within a plausible distance — closest to
 * the expected value first.
 */
export function photoCandidates(texts: string[], context: MileageContext, expected: number | null): number[] {
  const floor = context.previous?.odometerKm ?? 0;
  const ceiling = context.next?.odometerKm ?? (context.previous ? floor + 20_000 : 2_000_000);
  const found = new Set<number>();

  for (const text of texts) {
    for (const match of text.matchAll(/\d[\d .,]*\d|\d/g)) {
      // "123 048" is one number with a separator; "122980 122930" is two.
      // Without knowing which, try both: the whole run, and each piece.
      for (const piece of [match[0], ...match[0].split(/\s+/)]) {
        const digits = digitsOnly(piece);
        if (digits.length < 3 || digits.length > 7) continue;
        const km = Number(digits);
        if (km >= floor && km <= ceiling) found.add(km);
      }
    }
  }

  const target = expected ?? floor;
  return [...found].sort((a, b) => Math.abs(a - target) - Math.abs(b - target)).slice(0, 3);
}
