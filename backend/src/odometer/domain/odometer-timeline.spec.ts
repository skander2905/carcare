import { describe, expect, it } from 'vitest';
import {
  describeConflict,
  distanceBetween,
  findTimelineConflict,
  nextCurrentOdometer,
  type TimelineNeighbour,
} from './odometer-timeline.js';

const at = (iso: string, odometerKm: number): TimelineNeighbour => ({
  odometerKm,
  recordedAt: new Date(iso),
});

describe('findTimelineConflict', () => {
  it('accepts a reading with no neighbours', () => {
    expect(findTimelineConflict(120_000, null, null)).toBeNull();
  });

  it('accepts a reading above its predecessor', () => {
    expect(findTimelineConflict(120_500, at('2026-08-01', 120_000), null)).toBeNull();
  });

  it('rejects a reading below its predecessor', () => {
    const conflict = findTimelineConflict(119_000, at('2026-08-01', 120_000), null);

    expect(conflict).toEqual({ kind: 'below-previous', neighbour: at('2026-08-01', 120_000) });
  });

  it('rejects a backdated reading above the one that follows it', () => {
    // Recording 125,000 km for last month when this month already says 121,000
    // would mean the car drove backwards in between.
    const conflict = findTimelineConflict(125_000, null, at('2026-09-01', 121_000));

    expect(conflict).toEqual({ kind: 'above-next', neighbour: at('2026-09-01', 121_000) });
  });

  it('accepts a backdated reading that fits between its neighbours', () => {
    // The case the naive "must exceed current mileage" rule gets wrong, and the
    // most common correction anyone actually makes.
    expect(findTimelineConflict(120_500, at('2026-08-01', 120_000), at('2026-09-01', 121_000))).toBeNull();
  });

  it('allows an unchanged reading on either side', () => {
    // A car can sit on a driveway for a month. Requiring strict growth would
    // make a parked vehicle impossible to log.
    expect(findTimelineConflict(120_000, at('2026-08-01', 120_000), null)).toBeNull();
    expect(findTimelineConflict(120_000, null, at('2026-09-01', 120_000))).toBeNull();
  });

  it('reports the predecessor first when both neighbours conflict', () => {
    // Only possible if the timeline is already inconsistent; reporting the
    // earlier problem points at the reading that has to be fixed first.
    const conflict = findTimelineConflict(50_000, at('2026-08-01', 120_000), at('2026-09-01', 10_000));

    expect(conflict?.kind).toBe('below-previous');
  });
});

describe('describeConflict', () => {
  it('names the reading in the way, with its value and date', () => {
    const message = describeConflict({
      kind: 'below-previous',
      neighbour: at('2026-08-01T10:00:00Z', 120_000),
    });

    expect(message).toBe('Odometer cannot be lower than the previous reading of 120,000 km on 2026-08-01');
  });

  it('phrases a forward conflict differently', () => {
    expect(describeConflict({ kind: 'above-next', neighbour: at('2026-09-01T10:00:00Z', 121_000) })).toMatch(
      /^Odometer cannot be higher than the next reading of 121,000 km/,
    );
  });
});

describe('nextCurrentOdometer', () => {
  it('advances on a newer, higher reading', () => {
    expect(nextCurrentOdometer(120_000, 121_000)).toBe(121_000);
  });

  it('never goes backwards on a backdated reading', () => {
    // The headline figure is the highest mileage seen, not the latest entered.
    expect(nextCurrentOdometer(121_000, 120_500)).toBe(121_000);
  });

  it('is stable when the reading matches', () => {
    expect(nextCurrentOdometer(120_000, 120_000)).toBe(120_000);
  });
});

describe('distanceBetween', () => {
  it('is the span between the lowest and highest readings', () => {
    expect(distanceBetween([{ odometerKm: 120_000 }, { odometerKm: 121_500 }, { odometerKm: 120_800 }])).toBe(
      1_500,
    );
  });

  it('is unknown rather than zero with fewer than two readings', () => {
    // ADR-012: a number that is confidently wrong is worse than an honest blank,
    // because this is the denominator of cost per kilometre.
    expect(distanceBetween([])).toBeNull();
    expect(distanceBetween([{ odometerKm: 120_000 }])).toBeNull();
  });

  it('is unknown when the car did not move', () => {
    // Dividing by zero here would report an infinite cost per kilometre.
    expect(distanceBetween([{ odometerKm: 120_000 }, { odometerKm: 120_000 }])).toBeNull();
  });
});
