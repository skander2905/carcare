/**
 * What the fill-up form can know before anyone types.
 *
 * All of it is derived from the vehicle's own history, so none of it needs a
 * third party. Finding a station the user has never visited is the browser's
 * job (OpenStreetMap, called directly — see ADR-018), which keeps coordinates
 * away from this API unless the user saves the entry.
 */

export interface PastFill {
  filledAt: Date;
  stationName: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Total cost × 1000. */
  costMillimes: number;
  /** Price per litre × 1000. */
  priceMillimes: number;
  fuelType: string;
}

export interface NearbyStation {
  name: string;
  distanceMeters: number;
}

/** Close enough to be the same forecourt, allowing for a phone's GPS error. */
export const NEARBY_RADIUS_METERS = 300;

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle distance. Accurate to well under a metre at forecourt scale. */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/**
 * Stations this vehicle has filled at within `radius` of a point, nearest first.
 *
 * One entry per name, at its closest recorded fill: the same station logged
 * from either side of the forecourt is still one station.
 */
export function nearbyStations(
  fills: readonly PastFill[],
  latitude: number,
  longitude: number,
  radius = NEARBY_RADIUS_METERS,
): NearbyStation[] {
  const closest = new Map<string, NearbyStation>();

  for (const fill of fills) {
    if (!fill.stationName || fill.latitude === null || fill.longitude === null) continue;

    const distanceMeters = haversineMeters(latitude, longitude, fill.latitude, fill.longitude);
    if (distanceMeters > radius) continue;

    const key = fill.stationName.toLocaleLowerCase();
    const known = closest.get(key);
    if (!known || distanceMeters < known.distanceMeters) {
      closest.set(key, { name: fill.stationName, distanceMeters: Math.round(distanceMeters) });
    }
  }

  return [...closest.values()].sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** Distinct station names, most recently used first. */
export function recentStations(fills: readonly PastFill[], limit = 5): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const fill of [...fills].sort((a, b) => b.filledAt.getTime() - a.filledAt.getTime())) {
    if (!fill.stationName) continue;
    const key = fill.stationName.toLocaleLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    names.push(fill.stationName);
    if (names.length === limit) break;
  }

  return names;
}

/**
 * The amounts someone habitually asks the attendant for — "fifty dinars" —
 * as one-tap choices, most frequent first.
 *
 * Only whole amounts, and only those seen at least twice: a brim-full 87.340
 * is a result, not a habit, and offering it back would be noise.
 */
export function usualAmounts(fills: readonly PastFill[], limit = 3): number[] {
  const counts = new Map<number, { count: number; last: number }>();

  for (const fill of fills) {
    if (fill.costMillimes % 1000 !== 0) continue;
    const seen = counts.get(fill.costMillimes) ?? { count: 0, last: 0 };
    counts.set(fill.costMillimes, {
      count: seen.count + 1,
      last: Math.max(seen.last, fill.filledAt.getTime()),
    });
  }

  return [...counts.entries()]
    .filter(([, { count }]) => count >= 2)
    .sort(([, a], [, b]) => b.count - a.count || b.last - a.last)
    .slice(0, limit)
    .map(([millimes]) => millimes);
}

/**
 * The most recent price paid per litre for a fuel type, in millimes.
 *
 * Tunisian pump prices are set nationally, so the last price is almost always
 * today's — a far better default than a blank.
 */
export function lastPrice(fills: readonly PastFill[], fuelType: string): number | null {
  let latest: PastFill | null = null;

  for (const fill of fills) {
    if (fill.fuelType !== fuelType) continue;
    if (!latest || fill.filledAt > latest.filledAt) latest = fill;
  }

  return latest?.priceMillimes ?? null;
}
