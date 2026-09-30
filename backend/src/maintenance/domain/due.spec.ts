import { describe, expect, it } from 'vitest';
import { type ScheduleTerms, addMonths, byUrgency, calendarDate, daysBetween, dueState } from './due.js';

const TUNIS = 'Africa/Tunis';
const NOW = new Date('2026-09-30T10:00:00Z');

const oil: ScheduleTerms = {
  intervalKm: 10_000,
  intervalMonths: 12,
  notifyBeforeKm: 1000,
  notifyBeforeDays: 30,
};
const kmOnly: ScheduleTerms = { ...oil, intervalMonths: null };
const monthsOnly: ScheduleTerms = { ...oil, intervalKm: null };

const at = (odometerKm: number | null, performedAt: string | null) => ({
  odometerKm,
  performedAt: performedAt ? new Date(performedAt) : null,
});

describe('dueState', () => {
  it('is UNKNOWN with no service to count from', () => {
    const state = dueState({
      terms: oil,
      services: [],
      currentOdometerKm: 121_480,
      now: NOW,
      timeZone: TUNIS,
    });
    expect(state).toEqual({ status: 'UNKNOWN', km: null, time: null });
  });

  it.each([
    [118_999, 'UPCOMING', 1001],
    [119_000, 'DUE_SOON', 1000],
    [119_999, 'DUE_SOON', 1],
    [120_000, 'DUE', 0],
    [120_999, 'DUE', -999],
    [121_000, 'OVERDUE', -1000],
  ])('at %i km of a service due at 120,000 is %s', (current, status, remainingKm) => {
    const state = dueState({
      terms: kmOnly,
      services: [at(110_000, null)],
      currentOdometerKm: current,
      now: NOW,
      timeZone: TUNIS,
    });
    expect(state.status).toBe(status);
    expect(state.km).toMatchObject({ lastKm: 110_000, dueAtKm: 120_000, remainingKm });
  });

  it('keeps one kilometre of DUE when the window is zero', () => {
    const run = (current: number) =>
      dueState({
        terms: { ...kmOnly, notifyBeforeKm: 0 },
        services: [at(110_000, null)],
        currentOdometerKm: current,
        now: NOW,
        timeZone: TUNIS,
      }).status;
    expect([run(119_999), run(120_000), run(120_001)]).toEqual(['UPCOMING', 'DUE', 'OVERDUE']);
  });

  it.each([
    ['2025-11-15T09:00:00Z', 'UPCOMING', 46],
    ['2025-10-30T09:00:00Z', 'DUE_SOON', 30],
    ['2025-09-30T09:00:00Z', 'DUE', 0],
    ['2025-08-31T09:00:00Z', 'OVERDUE', -30],
  ])('for a yearly service last done %s is %s', (last, status, remainingDays) => {
    const state = dueState({
      terms: monthsOnly,
      services: [at(null, last)],
      currentOdometerKm: 0,
      now: NOW,
      timeZone: TUNIS,
    });
    expect(state.status).toBe(status);
    expect(state.time?.remainingDays).toBe(remainingDays);
  });

  it('takes whichever dimension comes first', () => {
    // Mileage is nowhere near, but a year has passed.
    const state = dueState({
      terms: oil,
      services: [at(118_000, '2025-08-31T09:00:00Z')],
      currentOdometerKm: 121_480,
      now: NOW,
      timeZone: TUNIS,
    });
    expect(state.km?.status).toBe('UPCOMING');
    expect(state.time?.status).toBe('OVERDUE');
    expect(state.status).toBe('OVERDUE');
  });

  it('counts from the latest service in each dimension, whatever order they come in', () => {
    const state = dueState({
      terms: oil,
      services: [at(100_000, '2024-09-01T09:00:00Z'), at(115_000, '2026-03-01T09:00:00Z'), at(null, null)],
      currentOdometerKm: 121_480,
      now: NOW,
      timeZone: TUNIS,
    });
    expect(state.km).toMatchObject({ lastKm: 115_000, dueAtKm: 125_000, remainingKm: 3520, progress: 0.648 });
    expect(state.time).toMatchObject({ lastDate: '2026-03-01', dueDate: '2027-03-01' });
  });

  it('reports the dimension it can when a baseline knows only the date', () => {
    const state = dueState({
      terms: oil,
      services: [at(null, '2026-06-01T09:00:00Z')],
      currentOdometerKm: 121_480,
      now: NOW,
      timeZone: TUNIS,
    });
    expect(state.km).toBeNull();
    expect(state.time?.status).toBe('UPCOMING');
    expect(state.status).toBe('UPCOMING');
  });

  it("uses the owner's calendar, not UTC's", () => {
    // 23:30 UTC on 31 August is already 1 September in Tunis (UTC+1).
    const state = dueState({
      terms: { ...monthsOnly, intervalMonths: 1 },
      services: [at(null, '2026-08-31T23:30:00Z')],
      currentOdometerKm: 0,
      now: new Date('2026-09-30T23:30:00Z'),
      timeZone: TUNIS,
    });
    expect(state.time).toMatchObject({ lastDate: '2026-09-01', dueDate: '2026-10-01', remainingDays: 0 });
  });
});

describe('byUrgency', () => {
  it('lists overdue first, unknown before upcoming, then by how far through the interval', () => {
    const state = (status: string, progress: number) =>
      ({ status, km: { progress }, time: null }) as unknown as ReturnType<typeof dueState>;
    const sorted = [
      state('UPCOMING', 0.2),
      state('UNKNOWN', 0),
      state('UPCOMING', 0.7),
      state('OVERDUE', 1.2),
      state('DUE_SOON', 0.95),
    ].sort(byUrgency);
    expect(sorted.map((s) => `${s.status}:${s.km!.progress}`)).toEqual([
      'OVERDUE:1.2',
      'DUE_SOON:0.95',
      'UNKNOWN:0',
      'UPCOMING:0.7',
      'UPCOMING:0.2',
    ]);
  });
});

describe('calendar helpers', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-03-31', 1, '2026-04-30'],
    ['2026-11-15', 3, '2027-02-15'],
    ['2026-09-30', 24, '2028-09-30'],
  ])('%s + %i months is %s', (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected);
  });

  it('counts days across a DST-free zone and a month end', () => {
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1);
    expect(daysBetween('2026-10-01', '2026-09-30')).toBe(-1);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('formats in the given zone', () => {
    expect(calendarDate(new Date('2026-12-31T23:30:00Z'), TUNIS)).toBe('2027-01-01');
    expect(calendarDate(new Date('2026-12-31T23:30:00Z'), 'UTC')).toBe('2026-12-31');
  });
});
