import { type ConnectionOptions } from 'bullmq';

/**
 * BullMQ's own connection settings, from the same `REDIS_URL` the API uses.
 *
 * Not the shared `RedisService` client: BullMQ holds blocking connections open
 * and needs `maxRetriesPerRequest: null`, which would make an ordinary request
 * wait forever on a Redis outage instead of failing.
 */
export function bullConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  const db = parsed.pathname.replace('/', '');
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: db ? Number(db) : 0,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
