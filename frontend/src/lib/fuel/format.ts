import { type FuelType } from '@/lib/vehicles/types';

/** The fuels someone can put in a tank. HYBRID and ELECTRIC describe cars, not pumps. */
export const PUMP_FUELS: readonly FuelType[] = ['PETROL', 'DIESEL', 'LPG', 'OTHER'];

/** The fuel a car most likely takes, from what the car is. */
export function defaultPumpFuel(vehicleFuel: FuelType): FuelType {
  if (vehicleFuel === 'HYBRID') return 'PETROL';
  if (vehicleFuel === 'ELECTRIC') return 'OTHER';
  return vehicleFuel;
}

/** "38.20 L" — litres to the centilitre, as the pump shows them. */
export function formatLitres(litres: string): string {
  return `${litres} L`;
}

/** "6.85 L/100 km", or null when there is not enough data. */
export function formatPer100(value: string | null): string | null {
  return value === null ? null : `${value} L/100 km`;
}

/**
 * Past the typical range of a tank. A jump this big since the last logged
 * fill usually means one was not logged, so the form asks.
 */
export const LIKELY_MISSED_FILL_KM = 1_000;

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function daysAgo(iso: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
