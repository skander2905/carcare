import { describe, expect, it } from 'vitest';
import {
  type Fill,
  consumptionWindows,
  litresPer100Km,
  summarise,
  windowsEndingBetween,
} from './consumption.js';

let sequence = 0;

/** A fill on day `day` of 2026 at `km`, with `litres` litres at 2.5/L. */
const fill = (day: number, km: number, litres: number, flags: Partial<Fill> = {}): Fill => {
  sequence += 1;
  const centilitres = Math.round(litres * 100);

  return {
    id: `fill-${String(sequence).padStart(3, '0')}`,
    filledAt: new Date(Date.UTC(2026, 0, day, 12)),
    odometerKm: km,
    centilitres,
    costMillimes: centilitres * 25,
    isFullTank: true,
    isMissedFill: false,
    ...flags,
  };
};

const partial = { isFullTank: false };

describe('consumptionWindows', () => {
  it('needs two full tanks: the first only opens a window', () => {
    expect(consumptionWindows([fill(1, 1000, 40)])).toEqual([]);

    const [window] = consumptionWindows([fill(1, 1000, 40), fill(8, 1500, 35)]);
    expect(window).toMatchObject({ distanceKm: 500, centilitres: 3500, fillCount: 1 });
    expect(litresPer100Km(window)).toBe(7);
  });

  it('counts every partial fill in the window, not only the one that closes it', () => {
    // The example in ADR-012: 10 + 15 + 20 litres over 600 km is 7.5 L/100km.
    // The naive "last fill over the distance" answer would be 3.33 — false.
    const windows = consumptionWindows([
      fill(1, 120_000, 42),
      fill(3, 120_200, 10, partial),
      fill(5, 120_400, 15, partial),
      fill(8, 120_600, 20),
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ centilitres: 4500, distanceKm: 600, fillCount: 3 });
    expect(litresPer100Km(windows[0])).toBe(7.5);
  });

  it('abandons the window a missed fill falls in, rather than reporting it low', () => {
    const windows = consumptionWindows([
      fill(1, 1000, 40),
      fill(10, 1900, 30, { isMissedFill: true }), // litres went in unrecorded before this
      fill(15, 2400, 35),
    ]);

    // 1000→1900 is missing fuel. 1900 was still a full tank, so it opens the
    // next window cleanly.
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ startOdometerKm: 1900, endOdometerKm: 2400 });
  });

  it('waits for the next full tank when the missed fill was only partial', () => {
    const windows = consumptionWindows([
      fill(1, 1000, 40),
      fill(5, 1300, 15, { ...partial, isMissedFill: true }),
      fill(9, 1700, 30), // no known starting level: anchors, measures nothing
      fill(14, 2200, 32),
    ]);

    expect(windows.map((w) => [w.startOdometerKm, w.endOdometerKm])).toEqual([[1700, 2200]]);
  });

  it('ignores partial fills before the first full tank', () => {
    const windows = consumptionWindows([fill(1, 1000, 12, partial), fill(3, 1200, 40), fill(9, 1800, 36)]);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ centilitres: 3600, distanceKm: 600 });
  });

  it('gives no figure for two full tanks at the same mileage', () => {
    // Topping off at the same pump: 0 km is "not enough data", not 0 or ∞.
    const windows = consumptionWindows([fill(1, 1000, 40), fill(1, 1000, 2), fill(8, 1500, 34)]);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ startOdometerKm: 1000, centilitres: 3400, distanceKm: 500 });
  });

  it('orders by mileage, so input order does not matter', () => {
    const history = [fill(1, 1000, 40), fill(5, 1400, 18, partial), fill(9, 1800, 20)];
    const shuffled = [history[2], history[0], history[1]];

    expect(consumptionWindows(shuffled)).toEqual(consumptionWindows(history));
  });

  it('sums cost exactly, with no floating-point drift', () => {
    const windows = consumptionWindows([
      fill(1, 0, 40),
      fill(2, 100, 10.1, partial),
      fill(3, 200, 38.2, partial),
      fill(4, 300, 0.7),
    ]);

    // 10.1 + 38.2 + 0.7 is 49.00000000000001 in floats; 4900 cl here.
    expect(windows[0].centilitres).toBe(4900);
    expect(windows[0].costMillimes).toBe(4900 * 25);
  });
});

describe('summarise', () => {
  it('weights by distance instead of averaging the windows', () => {
    const windows = consumptionWindows([
      fill(1, 0, 40),
      fill(2, 60, 6.6), // 11 L/100km over 60 km
      fill(9, 960, 54), // 6 L/100km over 900 km
    ]);

    const summary = summarise(windows);

    // Mean of the figures would be 8.5; per kilometre it is 60.6 / 960.
    expect(summary.averageLitresPer100Km).toBeCloseTo(6.3125, 6);
    expect(summary.measuredDistanceKm).toBe(960);
    expect(summary.windowCount).toBe(2);
  });

  it('is an honest blank when nothing was measured', () => {
    expect(summarise([])).toEqual({
      averageLitresPer100Km: null,
      measuredDistanceKm: 0,
      costMillimesPerKm: null,
      windowCount: 0,
    });
  });

  it('prices each kilometre from the same windows', () => {
    const summary = summarise(consumptionWindows([fill(1, 0, 40), fill(8, 500, 35)]));

    // 35 L at 2.5 = 87.5 over 500 km = 0.175/km = 175 millimes.
    expect(summary.costMillimesPerKm).toBe(175);
  });
});

describe('windowsEndingBetween', () => {
  it('keeps windows by the day they closed, bounds inclusive', () => {
    const windows = consumptionWindows([fill(1, 0, 40), fill(10, 500, 35), fill(20, 1000, 33)]);

    const tenth = new Date(Date.UTC(2026, 0, 10, 12));
    expect(windowsEndingBetween(windows, tenth, tenth)).toHaveLength(1);
    expect(windowsEndingBetween(windows, undefined, undefined)).toHaveLength(2);
    expect(windowsEndingBetween(windows, new Date(Date.UTC(2026, 0, 11)), undefined)).toHaveLength(1);
  });
});
