import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, type Queue } from 'bullmq';
import { delayUntilSendWindow } from '../notifications/domain/send-window.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DueSweepService, type SweepResult } from '../reminders/due-sweep.service.js';
import {
  DIGEST_JOB,
  type DigestJobData,
  NOTIFICATIONS_QUEUE,
  REMINDERS_QUEUE,
  SWEEP_JOB,
  digestJobId,
} from './queues.js';

/**
 * Runs the sweep, then asks for a digest for everyone owed an email.
 *
 * "Everyone owed an email" is read from the table, not from what this sweep
 * created — so a digest that was lost (Redis restarted, a job exhausted its
 * retries) is asked for again by the next sweep. The table is the outbox.
 */
@Processor(REMINDERS_QUEUE)
export class RemindersProcessor extends WorkerHost {
  private readonly logger = new Logger(RemindersProcessor.name);

  constructor(
    private readonly sweep: DueSweepService,
    private readonly notifications: NotificationsService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notificationsQueue: Queue<DigestJobData>,
  ) {
    super();
  }

  async process(job: Job): Promise<SweepResult> {
    if (job.name !== SWEEP_JOB) throw new Error(`Unknown job ${job.name} on ${REMINDERS_QUEUE}`);

    const now = new Date();
    const result = await this.sweep.run(now);

    const owed = await this.notifications.usersAwaitingEmail();
    for (const user of owed) {
      await this.notificationsQueue.add(
        DIGEST_JOB,
        { userId: user.id },
        { jobId: digestJobId(user.id), delay: delayUntilSendWindow(now, user.timezone) },
      );
    }
    if (owed.length > 0) this.logger.log(`Queued a digest for ${owed.length} user(s)`);
    return result;
  }
}
