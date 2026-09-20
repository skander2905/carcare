import { describe, expect, it } from 'vitest';
import { formatKm, formatMoney, vehicleSpec } from './format';
import { type Vehicle } from './types';

const vehicle = (overrides: Partial<Vehicle> = {}): Vehicle => ({
  id: 'v1',
  make: 'Volkswagen',
  model: 'Golf',
  year: 2019,
  licensePlate: '123 TUN 4567',
  vin: null,
  fuelType: 'DIESEL',
  engineSize: '1.6',
  transmission: 'MANUAL',
  currentOdometerKm: 121_500,
  purchaseDate: null,
  purchasePrice: null,
  color: null,
  notes: null,
  archivedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

describe('formatMoney', () => {
  it('groups thousands and keeps every millime', () => {
    expect(formatMoney('38500.000')).toBe('38 500.000 TND');
  });

  it('preserves the exact digits it was given', () => {
    // The whole point: the schema stores numeric(12,3) so that 321.750 is
    // exact, and parsing it to a float here would undo that.
    expect(formatMoney('321.750')).toBe('321.750 TND');
    expect(formatMoney('0.001')).toBe('0.001 TND');
  });

  it('does not round a value a float could not represent', () => {
    expect(formatMoney('1234567.891')).toBe('1 234 567.891 TND');
  });

  it('handles a whole amount with no decimal part', () => {
    expect(formatMoney('500')).toBe('500 TND');
  });

  it('is blank when there is no amount', () => {
    expect(formatMoney(null)).toBeNull();
  });

  it('takes the currency it is given', () => {
    expect(formatMoney('10.000', 'EUR')).toBe('10.000 EUR');
  });
});

describe('formatKm', () => {
  it('groups thousands', () => {
    expect(formatKm(121_500)).toBe('121,500 km');
  });

  it('handles a brand-new odometer', () => {
    expect(formatKm(0)).toBe('0 km');
  });
});

describe('vehicleSpec', () => {
  it('reads as a spec line', () => {
    expect(vehicleSpec(vehicle())).toBe('1.6 L · diesel · Manual');
  });

  it('omits what the owner never recorded', () => {
    expect(vehicleSpec(vehicle({ engineSize: null, transmission: null }))).toBe('diesel');
  });

  it('works for an EV, which has no displacement', () => {
    expect(vehicleSpec(vehicle({ fuelType: 'ELECTRIC', engineSize: null, transmission: 'AUTOMATIC' }))).toBe(
      'electric · Automatic',
    );
  });
});
