/**
 * The three pump figures — litres, price per litre, total — are tied together,
 * so the form asks for one and works out another. All of it in integers, as on
 * the server: "38.2 × 2.525" in floats is 96.45499999999998.
 */

/** Positive, up to `places` decimals; a comma is accepted, as French keyboards type it. */
export function toUnits(value: string, places: number): number | null {
  const normalised = value.trim().replace(',', '.');
  if (!new RegExp(`^\\d{1,9}(?:\\.\\d{0,${places}})?$`).test(normalised)) return null;

  const [whole, fraction = ''] = normalised.split('.');
  const units = Number(whole) * 10 ** places + Number(fraction.padEnd(places, '0') || '0');
  return units > 0 ? units : null;
}

export function fromUnits(units: number, places: number): string {
  const scale = 10 ** places;
  return `${Math.trunc(units / scale)}.${String(units % scale).padStart(places, '0')}`;
}

/** What a number of litres costs at a price: litres × price, to the millime. */
export function totalFor(litres: string, price: string): string | null {
  const centilitres = toUnits(litres, 2);
  const millimesPerLitre = toUnits(price, 3);
  if (centilitres === null || millimesPerLitre === null) return null;

  return fromUnits(Math.round((centilitres * millimesPerLitre) / 100), 3);
}

/** How many litres an amount buys at a price: total ÷ price, to the centilitre. */
export function litresFor(total: string, price: string): string | null {
  const millimes = toUnits(total, 3);
  const millimesPerLitre = toUnits(price, 3);
  if (millimes === null || millimesPerLitre === null) return null;

  return fromUnits(Math.round((millimes * 100) / millimesPerLitre), 2);
}

/** The price a total and a volume imply: total ÷ litres, to the millime. */
export function priceFor(total: string, litres: string): string | null {
  const millimes = toUnits(total, 3);
  const centilitres = toUnits(litres, 2);
  if (millimes === null || centilitres === null) return null;

  return fromUnits(Math.round((millimes * 100) / centilitres), 3);
}

/** A figure as the API wants it — dot-separated — or null if it is not one. */
export function normaliseDecimal(value: string, places: number): string | null {
  const units = toUnits(value, places);
  return units === null ? null : fromUnits(units, places);
}
