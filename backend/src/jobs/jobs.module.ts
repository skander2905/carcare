import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { redisConfig } from '../config/configuration.js';
import { type RedisConfig } from '../config/config.types.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RemindersModule } from '../reminders/reminders.module.js';
import { JobScheduler } from './job-scheduler.js';
import { NotificationsProcessor } from './notifications.processor.js';
import { RemindersProcessor } from './reminders.processor.js';
import { NOTIFICATIONS_QUEUE, REMINDERS_QUEUE } from './queues.js';
import { bullConnection } from './redis-connection.js';

/**
 * The worker role (architecture.md §7). Imported only when `APP_ROLE` is
 * `worker` or `all`: an API process never runs a processor, and the
 * integration suites — which boot `AppModule` — never start a schedule.
 *
 * Every job is idempotent. Retries back off exponentially; finished jobs are
 * dropped so a digest's fixed id is free for the next one. A job that exhausts
 * its retries is dropped too, because its work is still owed in the table and
 * the next sweep asks for it again.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [redisConfig.KEY],
      useFactory: (redis: RedisConfig) => ({
        connection: bullConnection(redis.url),
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      }),
    }),
    BullModule.registerQueue({ name: REMINDERS_QUEUE }, { name: NOTIFICATIONS_QUEUE }),
    RemindersModule,
    NotificationsModule,
  ],
  providers: [RemindersProcessor, NotificationsProcessor, JobScheduler],
})
export class JobsModule {}
