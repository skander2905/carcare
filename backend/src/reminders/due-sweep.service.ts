import { Injectable, Logger } from '@nestjs/common';
import { SchedulesService } from '../maintenance/schedules.service.js';
import { type Alert, reminderAlert, scheduleAlert } from '../notifications/domain/alerts.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { VehicleMemberRepository } from '../vehicles/vehicle-member.repository.js';
import { RemindersRepository } from './reminders.repository.js';
import { RemindersService } from './reminders.service.js';

const PAGE_SIZE = 100;

export interface SweepResult {
  vehicles: number;
  /** Alerts currently standing — most were announced by an earlier sweep. */
  alerts: number;
  /** Notifications actually written this time. */
  created: number;
  failed: number;
}

/**
 * The hourly pass that turns due states into notifications.
 *
 * It reads; it never stores a status. Each run asks the due engine, afresh,
 * where every active schedule and pending reminder stands, and hands whatever
 * is due soon, due or overdue to the inbox — which keeps only what it has not
 * already been told (`dedupeKey`). So running it twice, or two workers running
 * it at once, changes nothing the second time.
 *
 * Everyone with a membership on the car hears about it: they can all see it.
 */
@Injectable()
export class DueSweepService {
  private readonly logger = new Logger(DueSweepService.name);

  constructor(
    private readonly reminderRows: RemindersRepository,
    private readonly reminders: RemindersService,
    private readonly schedules: SchedulesService,
    private readonly members: VehicleMemberRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now = new Date()): Promise<SweepResult> {
    const result: SweepResult = { vehicles: 0, alerts: 0, created: 0, failed: 0 };

    for (let after: string | null = null; ;) {
      const page = await this.reminderRows.vehiclesToSweep(after, PAGE_SIZE);
      if (page.length === 0) break;

      for (const vehicle of page) {
        try {
          const { alerts, created } = await this.sweepVehicle(vehicle, now);
          result.alerts += alerts;
          result.created += created;
        } catch (error) {
          // One car — deleted mid-sweep, say — must not cost everyone else their reminders.
          result.failed += 1;
          this.logger.error(`Sweep failed for vehicle ${vehicle.id}: ${(error as Error).message}`);
        }
        result.vehicles += 1;
      }
      after = page[page.length - 1]?.id ?? null;
    }

    this.logger.log(
      `Swept ${result.vehicles} vehicle(s): ${result.alerts} standing alert(s), ${result.created} new notification(s)` +
        (result.failed > 0 ? `, ${result.failed} failed` : ''),
    );
    return result;
  }

  private async sweepVehicle(
    vehicle: { id: string; name: string },
    now: Date,
  ): Promise<{ alerts: number; created: number }> {
    const [schedules, reminders, members] = await Promise.all([
      this.schedules.list(vehicle.id, now),
      this.reminders.pending(vehicle.id, now),
      this.members.listForVehicle(vehicle.id),
    ]);

    const alerts: Alert[] = [
      ...schedules
        // A paused schedule still shows its status, but never raises a reminder.
        .filter(({ schedule }) => schedule.isActive)
        .map(({ schedule, due }) => scheduleAlert({ id: schedule.id, name: schedule.name }, vehicle, due)),
      ...reminders.map(({ reminder, due }) =>
        due ? reminderAlert({ id: reminder.id, name: reminder.title }, vehicle, due) : null,
      ),
    ].filter((alert): alert is Alert => alert !== null);

    const recipientIds = members.map((m) => m.userId);
    const created = await this.notifications.deliver(
      alerts.map((alert) => ({ vehicleId: vehicle.id, recipientIds, alert })),
    );
    return { alerts: alerts.length, created };
  }
}
