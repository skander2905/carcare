/**
 * The conversions moved to common/money once maintenance needed them too;
 * re-exported so the fuel module keeps one import for its unit maths.
 */
export { fromUnits, toUnits } from '../../common/money/units.js';

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
