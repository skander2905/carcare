/** Queue and job names, in one place so producer and processor cannot drift apart. */
export const REMINDERS_QUEUE = 'reminders';
export const NOTIFICATIONS_QUEUE = 'notifications';

export const SWEEP_JOB = 'sweep';
export const DIGEST_JOB = 'digest';

/** Hourly, a few minutes past so it does not land on everyone else's cron. */
export const SWEEP_PATTERN = '7 * * * *';

export interface DigestJobData {
  userId: string;
}

/**
 * One queued digest per user at a time. BullMQ ignores an add whose id is
 * already queued, so every sweep can safely ask for a digest without stacking
 * them. (BullMQ forbids `:` in custom ids.)
 */
export const digestJobId = (userId: string) => `digest-${userId}`;
