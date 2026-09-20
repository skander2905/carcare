import { type Vehicle } from './types';

/**
 * Money arrives as an exact decimal string and must stay one.
 *
 * `Number("38500.000")` is the bug this project's schema exists to prevent:
 * a float cannot represent every millime, and a total assembled from parsed
 * floats drifts. The string is grouped textually instead, so the digits shown
 * are exactly the digits stored.
 */
export function formatMoney(amount: string | null, currency = 'TND'): string | null {
  if (!amount) return null;

  const [whole, fraction] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  return fraction ? `${grouped}.${fraction} ${currency}` : `${grouped} ${currency}`;
}

export function formatKm(km: number): string {
  return `${km.toLocaleString('en-GB')} km`;
}

export function vehicleTitle(vehicle: Vehicle): string {
  return `${vehicle.make} ${vehicle.model}`;
}

const FUEL_LABELS: Record<string, string> = {
  PETROL: 'Petrol',
  DIESEL: 'Diesel',
  HYBRID: 'Hybrid',
  ELECTRIC: 'Electric',
  LPG: 'LPG',
  OTHER: 'Other',
};

const TRANSMISSION_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  AUTOMATIC: 'Automatic',
  SEMI_AUTOMATIC: 'Semi-automatic',
  CVT: 'CVT',
};

export const fuelLabel = (value: string): string => FUEL_LABELS[value] ?? value;
export const transmissionLabel = (value: string): string => TRANSMISSION_LABELS[value] ?? value;

/** "1.6 L diesel · Manual", skipping whatever the owner did not record. */
export function vehicleSpec(vehicle: Vehicle): string {
  return [
    vehicle.engineSize ? `${vehicle.engineSize} L` : null,
    fuelLabel(vehicle.fuelType).toLowerCase(),
    vehicle.transmission ? transmissionLabel(vehicle.transmission) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
