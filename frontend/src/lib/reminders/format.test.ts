import { describe, expect, it } from 'vitest';
import { addMonthsToDate, reminderSummary, repeatSummary } from './format';
import { type Reminder } from './types';

const reminder = (patch: Partial<Reminder>) =>
  ({ status: 'PENDING', completedAt: null, due: null, ...patch }) as Reminder;

describe('reminderSummary', () => {
  it('reads like a schedule while pending', () => {
    expect(
      reminderSummary(
        reminder({
          due: {
            status: 'DUE_SOON',
            km: null,
            time: { dueDate: '2027-03-01', remainingDays: 12, status: 'DUE_SOON' },
          },
        }),
      ),
    ).toBe('Due in 12 days');
    expect(
      reminderSummary(
        reminder({
          due: { status: 'OVERDUE', km: { dueAtKm: 1, remainingKm: -300, status: 'OVERDUE' }, time: null },
        }),
      ),
    ).toBe('300 km overdue');
  });

  it('says when it was done once completed', () => {
    expect(reminderSummary(reminder({ status: 'COMPLETED', completedAt: '2026-10-03T09:00:00Z' }))).toBe(
      'Done 3 Oct 2026',
    );
  });
});

describe('repeatSummary', () => {
  it('names the common periods', () => {
    expect(repeatSummary(null)).toBeNull();
    expect(repeatSummary(1)).toBe('Every month');
    expect(repeatSummary(12)).toBe('Every year');
    expect(repeatSummary(24)).toBe('Every 2 years');
    expect(repeatSummary(6)).toBe('Every 6 months');
  });
});

describe('addMonthsToDate', () => {
  it('clamps to the end of a shorter month, as the API does', () => {
    expect(addMonthsToDate('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonthsToDate('2027-12-15', 1)).toBe('2028-01-15');
  });
});
