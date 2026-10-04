import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Queue } from 'bullmq';
import { REMINDERS_QUEUE, SWEEP_JOB, SWEEP_PATTERN } from './queues.js';

/**
 * Registers the hourly sweep when a worker starts.
 *
 * `upsertJobScheduler` is keyed by name, so every worker — and every restart —
 * converges on one schedule rather than adding another. One extra sweep runs
 * at boot so a deploy does not wait up to an hour to notice anything; it is
 * idempotent, so two workers booting together cost a duplicate read, nothing
 * more.
 */
@Injectable()
export class JobScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobScheduler.name);

  constructor(@InjectQueue(REMINDERS_QUEUE) private readonly reminders: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.reminders.upsertJobScheduler(
      'reminders-sweep',
      { pattern: SWEEP_PATTERN },
      { name: SWEEP_JOB },
    );
    await this.reminders.add(SWEEP_JOB, {});
    this.logger.log(`Reminder sweep scheduled (${SWEEP_PATTERN}); one queued now`);
  }
}
