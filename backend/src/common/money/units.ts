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
