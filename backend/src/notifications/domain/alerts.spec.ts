import { describe, expect, it } from 'vitest';
import { type DueSnapshot, dedupeKey, dueSentence, reminderAlert, scheduleAlert } from './alerts.js';

const oil = { id: 'sched-1', name: 'Oil and filter' };
const insurance = { id: 'rem-1', name: 'Insurance renewal' };
const car = { id: 'car-1', name: 'Peugeot 208' };

const due = (status: DueSnapshot['status'], remainingKm: number | null, remainingDays: number | null) => ({
  status,
  km: remainingKm === null ? null : { dueAtKm: 130_000, remainingKm },
  time: remainingDays === null ? null : { dueDate: '2027-03-01', remainingDays },
});

describe('scheduleAlert', () => {
  it('says nothing while a service is fine or untracked', () => {
    expect(scheduleAlert(oil, car, due('UPCOMING', 5000, 200))).toBeNull();
    expect(scheduleAlert(oil, car, due('UNKNOWN', null, null))).toBeNull();
  });

  it('names the service, the step reached and the car', () => {
    expect(scheduleAlert(oil, car, due('DUE_SOON', 820, 200))).toEqual({
      type: 'MAINTENANCE_DUE',
      title: 'Oil and filter is due soon · Peugeot 208',
      body: 'Due in 820 km or by 1 Mar 2027.',
      data: { status: 'DUE_SOON', vehicleId: 'car-1', scheduleId: 'sched-1' },
      dedupeKey: 'maintenance:sched-1:DUE_SOON:130000km/2027-03-01',
    });
    expect(scheduleAlert(oil, car, due('OVERDUE', -1480, 20))?.title).toBe(
      'Oil and filter is overdue · Peugeot 208',
    );
  });
});

describe('reminderAlert', () => {
  it('links to the reminder rather than a schedule', () => {
    const alert = reminderAlert(insurance, car, due('DUE', null, 0));
    expect(alert).toMatchObject({
      type: 'REMINDER_DUE',
      title: 'Insurance renewal is due · Peugeot 208',
      body: 'Due today.',
      data: { reminderId: 'rem-1' },
      dedupeKey: 'reminder:rem-1:DUE:-km/2027-03-01',
    });
  });
});

describe('dedupeKey', () => {
  it('is stable while nothing changes, so the hourly sweep repeats nothing', () => {
    const state = due('DUE_SOON', 820, 30);
    expect(dedupeKey('maintenance', 's', state)).toBe(dedupeKey('maintenance', 's', { ...state }));
    // The distance shrinking as the car is driven is not news.
    expect(dedupeKey('maintenance', 's', due('DUE_SOON', 400, 29))).toBe(
      dedupeKey('maintenance', 's', state),
    );
  });

  it('changes with the step, so escalating to overdue is announced', () => {
    expect(dedupeKey('maintenance', 's', due('OVERDUE', -10, 30))).not.toBe(
      dedupeKey('maintenance', 's', due('DUE_SOON', 820, 30)),
    );
  });

  it('changes with the due point, so the next cycle is announced', () => {
    const next = { ...due('DUE_SOON', 820, null), km: { dueAtKm: 140_000, remainingKm: 820 } };
    expect(dedupeKey('maintenance', 's', next)).not.toBe(
      dedupeKey('maintenance', 's', due('DUE_SOON', 820, null)),
    );
  });

  it('fits the column', () => {
    const uuid = '0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b';
    expect(dedupeKey('maintenance', uuid, due('DUE_SOON', 1, 1)).length).toBeLessThanOrEqual(200);
  });
});

describe('dueSentence', () => {
  it('reads like the web app', () => {
    expect(dueSentence(due('DUE_SOON', 3520, 12))).toBe('Due in 3,520 km or in 12 days.');
    expect(dueSentence(due('DUE', 0, null))).toBe('Due now.');
    expect(dueSentence(due('DUE_SOON', null, 1))).toBe('Due tomorrow.');
  });

  it('leads with what is overdue', () => {
    expect(dueSentence(due('OVERDUE', -200, -3))).toBe('200 km overdue · 3 days overdue.');
    expect(dueSentence(due('OVERDUE', -1480, 20))).toBe('1,480 km overdue.');
  });
});
