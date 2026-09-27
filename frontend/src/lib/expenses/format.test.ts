import { describe, expect, it } from 'vitest';
import { AMOUNT_PATTERN, dayRange, incurredAtFromDate, sourceLabel, toDateInputValue } from './format';

describe('AMOUNT_PATTERN', () => {
  it.each(['1', '0.001', '321.75', '999999999.999'])('accepts %j', (value) => {
    expect(AMOUNT_PATTERN.test(value)).toBe(true);
  });

  it.each(['0', '0.000', '-1', '1.2345', '1e3', '1,5', '1234567890', ''])('rejects %j', (value) => {
    expect(AMOUNT_PATTERN.test(value)).toBe(false);
  });
});

describe('toDateInputValue', () => {
  it('pads month and day', () => {
    expect(toDateInputValue(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('incurredAtFromDate', () => {
  const now = new Date(2026, 8, 27, 14, 12, 0);

  it('uses the current moment for today, so it sorts after this morning’s entries', () => {
    expect(incurredAtFromDate('2026-09-27', now)).toBe(now.toISOString());
  });

  it('uses local midday for a past day', () => {
    expect(incurredAtFromDate('2026-09-01', now)).toBe(new Date(2026, 8, 1, 12).toISOString());
  });
});

describe('dayRange', () => {
  it('runs from the start of the first day to the end of the last', () => {
    expect(dayRange('2026-09-01', '2026-09-30')).toEqual({
      from: new Date(2026, 8, 1, 0, 0, 0, 0).toISOString(),
      to: new Date(2026, 8, 30, 23, 59, 59, 999).toISOString(),
    });
  });

  it('omits an end that was left blank', () => {
    expect(dayRange('', '2026-09-30')).not.toHaveProperty('from');
    expect(dayRange('2026-09-01', '')).not.toHaveProperty('to');
  });
});

describe('sourceLabel', () => {
  it('says nothing for a hand-entered expense', () => {
    expect(sourceLabel('MANUAL')).toBeNull();
  });

  it('explains where a derived expense came from', () => {
    expect(sourceLabel('FUEL')).toBe('From a fill-up');
  });
});
