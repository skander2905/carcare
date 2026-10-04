import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job } from 'bullmq';
import { DigestService, type DigestOutcome } from '../notifications/digest.service.js';
import { DIGEST_JOB, type DigestJobData, NOTIFICATIONS_QUEUE } from './queues.js';

/** Sends one user's digest. A failure throws, and BullMQ retries with backoff. */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  constructor(private readonly digest: DigestService) {
    super();
  }

  process(job: Job<DigestJobData>): Promise<DigestOutcome> {
    if (job.name !== DIGEST_JOB) throw new Error(`Unknown job ${job.name} on ${NOTIFICATIONS_QUEUE}`);
    return this.digest.send(job.data.userId);
  }
}
