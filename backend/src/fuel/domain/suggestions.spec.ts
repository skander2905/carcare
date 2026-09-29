import { describe, expect, it } from 'vitest';
import {
  type PastFill,
  haversineMeters,
  lastPrice,
  nearbyStations,
  recentStations,
  usualAmounts,
} from './suggestions.js';

// Two real forecourts in Tunis, about 1.3 km apart.
const LAC = { latitude: 36.8442, longitude: 10.2425 };
const MARSA_ROAD = { latitude: 36.8551, longitude: 10.2475 };

const past = (day: number, overrides: Partial<PastFill> = {}): PastFill => ({
  filledAt: new Date(Date.UTC(2026, 0, day)),
  stationName: null,
  latitude: null,
  longitude: null,
  costMillimes: 50_000,
  priceMillimes: 2_525,
  fuelType: 'PETROL',
  ...overrides,
});

describe('haversineMeters', () => {
  it('measures a known distance', () => {
    // One thousandth of a degree of latitude is ~111 m anywhere.
    expect(haversineMeters(36.8, 10.2, 36.801, 10.2)).toBeCloseTo(111.2, 0);
    expect(haversineMeters(36.8, 10.2, 36.8, 10.2)).toBe(0);
  });
});

describe('nearbyStations', () => {
  const history = [
    past(1, { stationName: 'Shell Lac 2', ...LAC }),
    past(5, { stationName: 'shell lac 2', latitude: LAC.latitude + 0.0005, longitude: LAC.longitude }),
    past(9, { stationName: 'Agil La Marsa', ...MARSA_ROAD }),
    past(12, { stationName: 'No coordinates' }),
  ];

  it('finds a station logged here before, once, at its closest fill', () => {
    const near = nearbyStations(history, LAC.latitude + 0.0004, LAC.longitude);

    expect(near).toHaveLength(1);
    expect(near[0].name.toLowerCase()).toBe('shell lac 2');
    expect(near[0].distanceMeters).toBeLessThan(15);
  });

  it('ignores stations further than the radius, and fills with no location', () => {
    expect(nearbyStations(history, 36.9, 10.3)).toEqual([]);
  });

  it('orders several nearby stations nearest first', () => {
    // ~350 m from La Marsa, ~850 m from Lac 2.
    const between = { latitude: 36.852, longitude: 10.246 };
    const near = nearbyStations(history, between.latitude, between.longitude, 2_000);

    expect(near.map((s) => s.name)).toEqual(['Agil La Marsa', 'shell lac 2']);
  });
});

describe('recentStations', () => {
  it('lists distinct names, newest first, case-insensitively', () => {
    const names = recentStations([
      past(1, { stationName: 'Agil' }),
      past(3, { stationName: 'Shell' }),
      past(5, { stationName: 'agil' }),
      past(7),
    ]);

    expect(names).toEqual(['agil', 'Shell']);
  });
});

describe('usualAmounts', () => {
  it('offers whole amounts paid at least twice, most frequent first', () => {
    const amounts = usualAmounts([
      past(1, { costMillimes: 50_000 }),
      past(2, { costMillimes: 100_000 }),
      past(3, { costMillimes: 50_000 }),
      past(4, { costMillimes: 100_000 }),
      past(5, { costMillimes: 50_000 }),
      past(6, { costMillimes: 87_340 }), // a brim-full result, not a habit
      past(7, { costMillimes: 87_340 }),
      past(8, { costMillimes: 30_000 }), // seen once
    ]);

    expect(amounts).toEqual([50_000, 100_000]);
  });
});

describe('lastPrice', () => {
  it('takes the newest price for the fuel asked about', () => {
    const fills = [
      past(1, { priceMillimes: 2_400 }),
      past(9, { priceMillimes: 2_525 }),
      past(12, { priceMillimes: 2_205, fuelType: 'DIESEL' }),
    ];

    expect(lastPrice(fills, 'PETROL')).toBe(2_525);
    expect(lastPrice(fills, 'LPG')).toBeNull();
  });
});
