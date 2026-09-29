import { describe, expect, it } from 'vitest';
import { TUNISIA_PRICES, officialPricesOn } from './official-prices.js';

describe('official prices', () => {
  it('keeps lists oldest first, so the newest in force is found', () => {
    const days = TUNISIA_PRICES.lists.map((list) => list.effectiveFrom);
    expect([...days].sort()).toEqual(days);
  });

  it('prices Tunisian petrol and diesel to the millime', () => {
    const prices = officialPricesOn('TND', new Date('2026-09-29T08:00:00Z'));

    expect(prices?.prices.PETROL?.[0]).toEqual({ grade: 'Sans plomb', priceMillimes: 2525 });
    expect(prices?.prices.DIESEL?.[0]).toEqual({ grade: 'Gasoil sans soufre', priceMillimes: 2205 });
    // No exact figure is published, so none is claimed.
    expect(prices?.prices.LPG).toBeUndefined();
  });

  it('applies nothing to another currency, or before the table begins', () => {
    expect(officialPricesOn('EUR', new Date('2026-09-29'))).toBeNull();
    expect(officialPricesOn('TND', new Date('2020-01-01'))).toBeNull();
  });

  it('uses the list in force on the day, not the newest', () => {
    const table = {
      ...TUNISIA_PRICES,
      lists: [
        { effectiveFrom: '2022-11-24', prices: { PETROL: [{ grade: 'Sans plomb', priceMillimes: 2525 }] } },
        { effectiveFrom: '2027-01-01', prices: { PETROL: [{ grade: 'Sans plomb', priceMillimes: 2700 }] } },
      ],
    };

    expect(
      officialPricesOn('TND', new Date('2026-12-31T12:00:00Z'), table)?.prices.PETROL?.[0].priceMillimes,
    ).toBe(2525);
    expect(
      officialPricesOn('TND', new Date('2027-01-02T12:00:00Z'), table)?.prices.PETROL?.[0].priceMillimes,
    ).toBe(2700);
  });
});
