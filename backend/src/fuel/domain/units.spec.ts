import { describe, expect, it } from 'vitest';
import { derivePriceMillimes, fromUnits, priceIsConsistent, toUnits } from './units.js';

describe('toUnits / fromUnits', () => {
  it('round-trips without floating point', () => {
    expect(toUnits('38.2', 2)).toBe(3820);
    expect(toUnits('38.20', 2)).toBe(3820);
    expect(toUnits('38', 2)).toBe(3800);
    expect(toUnits('0.7', 3)).toBe(700);
    expect(toUnits('96.455', 3)).toBe(96_455);

    expect(fromUnits(3820, 2)).toBe('38.20');
    expect(fromUnits(7, 2)).toBe('0.07');
    expect(fromUnits(96_455, 3)).toBe('96.455');
  });
});

describe('derivePriceMillimes', () => {
  it('rounds total ÷ litres half-up to the millime', () => {
    // 96.455 / 38.20 = 2.52500
    expect(derivePriceMillimes(96_455, 3820)).toBe(2525);
    // 50.000 / 19.80 = 2.525252…
    expect(derivePriceMillimes(50_000, 1980)).toBe(2525);
  });
});

describe('priceIsConsistent', () => {
  it('accepts pump rounding and refuses a typo', () => {
    expect(priceIsConsistent(2525, 96_455, 3820)).toBe(true);
    expect(priceIsConsistent(2530, 96_455, 3820)).toBe(true); // 0.2% off
    expect(priceIsConsistent(25_250, 96_455, 3820)).toBe(false); // decimal slipped
    expect(priceIsConsistent(2205, 96_455, 3820)).toBe(false); // diesel price on petrol, 13% off
  });
});
