/**
 * Exact conversions between the decimal strings the API speaks and the
 * integers the engine counts in. Parsing "38.20" through `Number` would be
 * fine here, but a ledger that is exact everywhere except one helper is not.
 */

/** "38.2" at 2 places → 3820. Expects a string the DTO patterns already accepted. */
export function toUnits(value: string, places: number): number {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 10 ** places + Number(fraction.padEnd(places, '0').slice(0, places) || '0');
}

/** 3820 at 2 places → "38.20". */
export function fromUnits(units: number, places: number): string {
  const scale = 10 ** places;
  const whole = Math.trunc(units / scale);
  const fraction = String(Math.abs(units % scale)).padStart(places, '0');
  return places === 0 ? String(whole) : `${whole}.${fraction}`;
}

/** Price per litre in millimes, rounded half-up: total ÷ litres. */
export function derivePriceMillimes(totalMillimes: number, centilitres: number): number {
  return Math.round((totalMillimes * 100) / centilitres);
}

/**
 * How far a stated price may sit from total ÷ volume.
 *
 * Pumps round each of the three figures independently, so they never agree
 * exactly — but 2% is far beyond rounding, and well inside the typical typo
 * (the price typed as 25.25, or the total in the litres field).
 */
export const PRICE_TOLERANCE = 0.02;

export function priceIsConsistent(
  priceMillimes: number,
  totalMillimes: number,
  centilitres: number,
): boolean {
  const implied = (priceMillimes * centilitres) / 100;
  return Math.abs(implied - totalMillimes) <= totalMillimes * PRICE_TOLERANCE;
}
