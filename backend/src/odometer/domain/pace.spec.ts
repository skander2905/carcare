import { describe, expect, it } from 'vitest';
import { kmPerDay } from './pace.js';

const at = (km: number, date: string) => ({ odometerKm: km, recordedAt: new Date(date) });

describe('kmPerDay', () => {
  it('averages over the whole span: 2,700 km over 90 days', () => {
    expect(kmPerDay([at(120_000, '2026-07-01'), at(121_000, '2026-07-21'), at(122_700, '2026-09-29')])).toBe(
      30,
    );
  });

  it('does not care about order', () => {
    expect(kmPerDay([at(121_400, '2026-08-15'), at(120_000, '2026-08-01')])).toBe(100);
  });

  it('says nothing with too little to go on', () => {
    expect(kmPerDay([])).toBeNull();
    expect(kmPerDay([at(120_000, '2026-09-01')])).toBeNull();
    // Ten days: one road trip would make it look like the car's normal pace.
    expect(kmPerDay([at(120_000, '2026-09-01'), at(121_000, '2026-09-11')])).toBeNull();
    // A car that has not moved has no pace to suggest from.
    expect(kmPerDay([at(120_000, '2026-08-01'), at(120_000, '2026-09-01')])).toBeNull();
  });
});
