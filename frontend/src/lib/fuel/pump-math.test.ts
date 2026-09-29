import { describe, expect, it } from 'vitest';
import { litresFor, normaliseDecimal, priceFor, toUnits, totalFor } from './pump-math';

describe('pump maths', () => {
  it('prices litres exactly, where floats would not', () => {
    // 38.2 * 2.525 === 96.45499999999998 in JavaScript.
    expect(totalFor('38.2', '2.525')).toBe('96.455');
    expect(totalFor('38,20', '2,525')).toBe('96.455');
  });

  it('turns an amount into litres at the price', () => {
    expect(litresFor('50', '2.525')).toBe('19.80');
    expect(litresFor('100', '2.525')).toBe('39.60');
  });

  it('works out the price from what the pump showed', () => {
    expect(priceFor('96.455', '38.20')).toBe('2.525');
    expect(priceFor('50', '19,8')).toBe('2.525');
  });

  it('answers null for anything that is not a positive figure', () => {
    expect(totalFor('', '2.525')).toBeNull();
    expect(totalFor('abc', '2.525')).toBeNull();
    expect(litresFor('50', '0')).toBeNull();
    expect(toUnits('1.2345', 3)).toBeNull();
    expect(toUnits('-4', 2)).toBeNull();
  });

  it('normalises what someone typed into what the API accepts', () => {
    expect(normaliseDecimal('38,2', 2)).toBe('38.20');
    expect(normaliseDecimal('50', 3)).toBe('50.000');
    expect(normaliseDecimal('0', 3)).toBeNull();
  });
});
