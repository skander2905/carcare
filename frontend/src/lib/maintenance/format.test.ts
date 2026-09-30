import { describe, expect, it } from 'vitest';
import {
  dueProgress,
  dueSummary,
  formatCalendarDate,
  intervalSummary,
  isFree,
  matchingSchedule,
  normaliseCost,
  sumCosts,
} from './format';
import { type Due, type Schedule } from './types';

const km = (remainingKm: number, status: Due['status'] = 'UPCOMING') =>
  ({ lastKm: 0, dueAtKm: 0, remainingKm, progress: 0.5, status }) as NonNullable<Due['km']>;
const time = (remainingDays: number, dueDate = '2027-03-01', status: Due['status'] = 'UPCOMING') =>
  ({ lastDate: '2026-03-01', dueDate, remainingDays, progress: 0.4, status }) as NonNullable<Due['time']>;

describe('dueSummary', () => {
  it('names both dimensions, since whichever comes first counts', () => {
    expect(dueSummary({ status: 'UPCOMING', km: km(3520), time: time(152) })).toBe(
      'Due in 3,520 km or by 1 Mar 2027',
    );
  });

  it('counts close dates in days', () => {
    expect(dueSummary({ status: 'DUE_SOON', km: null, time: time(12) })).toBe('Due in 12 days');
    expect(dueSummary({ status: 'DUE', km: null, time: time(0) })).toBe('Due today');
  });

  it('leads with what is overdue', () => {
    expect(dueSummary({ status: 'OVERDUE', km: km(-1480), time: time(20) })).toBe('1,480 km overdue');
    expect(dueSummary({ status: 'OVERDUE', km: km(-200), time: time(-3) })).toBe(
      '200 km overdue · 3 days overdue',
    );
  });

  it('asks for a starting point when there is none', () => {
    expect(dueSummary({ status: 'UNKNOWN', km: null, time: null })).toMatch(/start tracking/);
  });
});

describe('schedule helpers', () => {
  it('summarises the interval', () => {
    expect(intervalSummary({ intervalKm: 10_000, intervalMonths: 12 })).toBe('Every 10,000 km or 12 months');
    expect(intervalSummary({ intervalKm: null, intervalMonths: 1 })).toBe('Every 1 month');
  });

  it('shows the further dimension on the bar, capped', () => {
    expect(dueProgress({ status: 'OVERDUE', km: { ...km(-1), progress: 1.3 }, time: time(5) })).toBe(1);
    expect(dueProgress({ status: 'UPCOMING', km: km(1), time: { ...time(5), progress: 0.8 } })).toBe(0.8);
  });

  it('formats calendar dates without slipping a day', () => {
    expect(formatCalendarDate('2027-01-01')).toBe('1 Jan 2027');
  });

  it('preselects a schedule only when exactly one active one matches', () => {
    const s = (id: string, type: Schedule['type'], isActive = true) => ({ id, type, isActive }) as Schedule;
    expect(matchingSchedule('OIL_CHANGE', [s('a', 'OIL_CHANGE'), s('b', 'TIRES')])?.id).toBe('a');
    expect(matchingSchedule('OIL_CHANGE', [s('a', 'OIL_CHANGE'), s('b', 'OIL_CHANGE')])).toBeNull();
    expect(matchingSchedule('OIL_CHANGE', [s('a', 'OIL_CHANGE', false)])).toBeNull();
  });
});

describe('costs', () => {
  it('accepts zero, commas and short fractions', () => {
    expect(normaliseCost('0')).toBe('0.000');
    expect(normaliseCost('120,5')).toBe('120.500');
    expect(normaliseCost('-3')).toBeNull();
    expect(normaliseCost('1.2345')).toBeNull();
  });

  it('adds parts and labour exactly', () => {
    expect(sumCosts('0.1', '0.2')).toBe('0.300');
    expect(sumCosts('95.500', '')).toBeNull();
  });

  it('knows a free service', () => {
    expect(isFree('0.000')).toBe(true);
    expect(isFree('0.001')).toBe(false);
  });
});
