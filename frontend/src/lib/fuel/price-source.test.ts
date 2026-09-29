import { describe, expect, it } from 'vitest';
import { defaultPrice, officialPricesNeedChecking } from './price-source';

const official = {
  effectiveFrom: '2022-11-24',
  verifiedAt: '2026-09-29',
  source: 'https://www.energiemines.gov.tn/',
  prices: {
    PETROL: [
      { grade: 'Sans plomb', pricePerLiter: '2.525' },
      { grade: 'Sans plomb premier', pricePerLiter: '2.855' },
    ],
    DIESEL: [
      { grade: 'Gasoil sans soufre', pricePerLiter: '2.205' },
      { grade: 'Gasoil ordinaire', pricePerLiter: '1.985' },
    ],
  },
};

describe('defaultPrice', () => {
  it("takes the state's price for the pump's usual grade", () => {
    expect(defaultPrice('PETROL', { officialPrices: official, lastPrices: {} })).toEqual({
      price: '2.525',
      grade: 'Sans plomb',
      source: 'official',
    });
  });

  it('keeps the grade this car was last filled with', () => {
    const choice = defaultPrice('DIESEL', { officialPrices: official, lastPrices: { DIESEL: '1.985' } });
    expect(choice?.grade).toBe('Gasoil ordinaire');
  });

  it('prefers official over a last price that is out of date', () => {
    // Paid 2.400 before a price rise: the pump now charges 2.525.
    const choice = defaultPrice('PETROL', { officialPrices: official, lastPrices: { PETROL: '2.400' } });
    expect(choice).toMatchObject({ price: '2.525', source: 'official' });
  });

  it('honours a grade picked by hand', () => {
    const choice = defaultPrice('PETROL', { officialPrices: official, lastPrices: {} }, 'Sans plomb premier');
    expect(choice?.price).toBe('2.855');
  });

  it('falls back to the last price paid where the state sets none', () => {
    expect(defaultPrice('LPG', { officialPrices: official, lastPrices: { LPG: '0.960' } })).toEqual({
      price: '0.960',
      grade: null,
      source: 'last-paid',
    });
    expect(defaultPrice('LPG', { officialPrices: null, lastPrices: {} })).toBeNull();
  });
});

describe('officialPricesNeedChecking', () => {
  it('asks for a glance at the pump once the table is six months old', () => {
    const now = new Date('2026-09-29');
    expect(officialPricesNeedChecking('2026-09-29', now)).toBe(false);
    expect(officialPricesNeedChecking('2026-03-01', now)).toBe(true);
  });
});
