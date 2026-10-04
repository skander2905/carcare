import { describe, expect, it } from 'vitest';
import {
  type MileageContext,
  assessReading,
  completeReading,
  estimateReading,
  fromTrip,
  groupDigits,
  photoCandidates,
} from './mileage-entry';

const NOW = new Date('2026-10-04T10:00:00Z');
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const context = (patch: Partial<MileageContext> = {}): MileageContext => ({
  previous: { odometerKm: 122_700, recordedAt: daysBefore(6) },
  next: null,
  kmPerDay: 45,
  lastFuelFill: { odometerKm: 122_300, recordedAt: daysBefore(12) },
  ...patch,
});

describe('completeReading', () => {
  it('completes the last digits from the previous reading', () => {
    expect(completeReading('980', 122_700)).toEqual({ km: 122_980, completed: true });
    // Past the next thousand, like an odometer's wheels rolling over.
    expect(completeReading('050', 122_700)).toEqual({ km: 123_050, completed: true });
    expect(completeReading('50', 122_700)).toEqual({ km: 122_750, completed: true });
    // Exactly the previous reading is allowed: the car may not have moved.
    expect(completeReading('700', 122_700)).toEqual({ km: 122_700, completed: true });
  });

  it('takes a full number as typed', () => {
    expect(completeReading('123,412', 122_700)).toEqual({ km: 123_412, completed: false });
    expect(completeReading('1 000 000', 122_700)).toEqual({ km: 1_000_000, completed: false });
    expect(completeReading('480', null)).toEqual({ km: 480, completed: false });
  });

  it('is nothing until something is typed', () => {
    expect(completeReading('', 122_700)).toBeNull();
    expect(completeReading('km', 122_700)).toBeNull();
  });
});

describe('groupDigits', () => {
  it('writes kilometres the way the app does', () => {
    expect(groupDigits('122700')).toBe('122,700');
    expect(groupDigits('1234')).toBe('1,234');
    expect(groupDigits('')).toBe('');
  });

  it('keeps leading zeros, which mean "ends in"', () => {
    expect(groupDigits('050')).toBe('050');
    expect(groupDigits('0050')).toBe('0,050');
  });
});

describe('fromTrip', () => {
  it('adds the trip counter to the last fill-up', () => {
    expect(fromTrip(412, 122_300)).toBe(122_712);
  });
});

describe('estimateReading', () => {
  it('adds the usual pace since the previous reading, to the nearest 10', () => {
    // 6 days at 45 km a day: 270 km.
    expect(estimateReading(context(), NOW)).toBe(122_970);
  });

  it('offers nothing without a pace or a previous reading, or on the same day', () => {
    expect(estimateReading(context({ kmPerDay: null }), NOW)).toBeNull();
    expect(estimateReading(context({ previous: null }), NOW)).toBeNull();
    expect(
      estimateReading(context({ previous: { odometerKm: 122_700, recordedAt: NOW.toISOString() } }), NOW),
    ).toBeNull();
  });
});

describe('assessReading', () => {
  it('says how far the car went since the previous reading', () => {
    const result = assessReading(123_112, context(), NOW);
    expect(result.level).toBe('ok');
    // "Sep" or "Sept", depending on the runtime's date data.
    expect(result.message).toMatch(/^\+412 km since 28 Sept?$/);
  });

  it('warns about a jump that is probably a typo', () => {
    const result = assessReading(132_700, context(), NOW);
    expect(result.level).toBe('warn');
    expect(result.message).toMatch(/That's a lot for 6 days: check for a typo/);
  });

  it('refuses what the server would refuse, saying why', () => {
    const lower = assessReading(122_000, context(), NOW);
    expect(lower.level).toBe('error');
    expect(lower.message).toMatch(/^Lower than the 122,700 km recorded 28 Sept?$/);
    const backdated = context({ next: { odometerKm: 123_000, recordedAt: daysBefore(2) } });
    expect(assessReading(123_500, backdated, NOW).level).toBe('error');
  });
});

describe('photoCandidates', () => {
  it('keeps numbers that fit this car, closest to what was expected first', () => {
    const text = ['12:45  21°C', 'ODO 123 048 km', 'TRIP 412.6', '123048', '3048'];
    expect(photoCandidates(text, context(), 122_970)).toEqual([123_048]);
  });

  it('offers a few when it is unsure, and none when nothing fits', () => {
    expect(photoCandidates(['122980 122930 99999'], context(), 122_970)).toEqual([122_980, 122_930]);
    expect(photoCandidates(['12:45', '21°C'], context(), null)).toEqual([]);
  });
});
