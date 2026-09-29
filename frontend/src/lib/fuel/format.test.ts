import { describe, expect, it } from 'vitest';
import { daysAgo, defaultPumpFuel, formatDistance } from './format';

describe('fuel formatting', () => {
  it('picks the pump fuel from the kind of car', () => {
    expect(defaultPumpFuel('DIESEL')).toBe('DIESEL');
    expect(defaultPumpFuel('HYBRID')).toBe('PETROL');
    expect(defaultPumpFuel('ELECTRIC')).toBe('OTHER');
  });

  it('describes distances and ages briefly', () => {
    expect(formatDistance(42)).toBe('42 m');
    expect(formatDistance(1_340)).toBe('1.3 km');

    const now = new Date('2026-09-29T12:00:00Z');
    expect(daysAgo('2026-09-29T08:00:00Z', now)).toBe('today');
    expect(daysAgo('2026-09-28T08:00:00Z', now)).toBe('yesterday');
    expect(daysAgo('2026-09-20T12:00:00Z', now)).toBe('9 days ago');
  });
});
