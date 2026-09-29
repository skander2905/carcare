/**
 * Finding the station someone is standing at.
 *
 * Two sources, in order. The API first: stations this vehicle has filled at
 * within 300 m, which never leaves CarCare. Then OpenStreetMap, called from
 * the browser so the API never sees a location it is not asked to store — and
 * with the coordinates rounded to about 11 m, which is plenty to find a
 * forecourt and says less about exactly where someone is. See ADR-018.
 */

export interface Position {
  latitude: number;
  longitude: number;
}

export interface StationCandidate {
  name: string;
  distanceMeters: number;
  /** Where the suggestion came from, so the UI can say so. */
  source: 'history' | 'osm';
}

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const OSM_RADIUS_METERS = 300;

/** Four decimal places: ~11 m of latitude. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function roundPosition({ latitude, longitude }: Position): Position {
  return { latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude) };
}

export function haversineMeters(a: Position, b: Position): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Every fuel station (node, way or area) within the radius, with its centre. */
export function overpassQuery({ latitude, longitude }: Position, radius = OSM_RADIUS_METERS): string {
  return `[out:json][timeout:10];nwr["amenity"="fuel"](around:${radius},${latitude},${longitude});out center tags;`;
}

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Named stations from an Overpass answer, nearest first, one per name.
 *
 * `name` is what is on the sign ("Shell Lac 2"); `brand` alone ("Agil") is the
 * fallback. A station with neither is skipped: "Fuel station" is not a name
 * anyone would pick from a list.
 */
export function parseOverpass(json: unknown, from: Position): StationCandidate[] {
  const elements = (json as { elements?: OverpassElement[] } | null)?.elements ?? [];
  const nearest = new Map<string, StationCandidate>();

  for (const element of elements) {
    const name = (element.tags?.name ?? element.tags?.brand)?.trim();
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (!name || lat === undefined || lon === undefined) continue;

    const distanceMeters = Math.round(haversineMeters(from, { latitude: lat, longitude: lon }));
    const key = name.toLocaleLowerCase();
    const known = nearest.get(key);
    if (!known || distanceMeters < known.distanceMeters) {
      nearest.set(key, { name, distanceMeters, source: 'osm' });
    }
  }

  return [...nearest.values()].sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** Stations near a position, from OpenStreetMap. Rounds before sending. */
export async function osmStationsNear(position: Position, signal?: AbortSignal): Promise<StationCandidate[]> {
  const rounded = roundPosition(position);
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: overpassQuery(rounded) }),
    signal,
  });
  if (!response.ok) throw new Error(`OpenStreetMap answered ${response.status}`);
  return parseOverpass(await response.json(), rounded);
}

/**
 * The device's position, or null when there is none to be had — no support,
 * permission refused, or no fix in time. Never throws: a form that cannot
 * locate someone should still let them type.
 */
export function currentPosition(timeoutMs = 8_000): Promise<Position | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => resolve(null),
      // A minute-old fix is fine: nobody drives off mid-form.
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
