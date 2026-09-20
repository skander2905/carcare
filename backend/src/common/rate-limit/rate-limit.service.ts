import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Redis } from 'ioredis';
import { RedisService } from '../../redis/redis.service.js';
import { type RateLimitVerdict } from './rate-limit.types.js';

/**
 * Sliding-window log, evaluated atomically.
 *
 * Every request is one member of a sorted set scored by its timestamp. Entries
 * older than the window are dropped, the survivors are counted, and the new
 * request is admitted only if the count is under the limit — all inside one
 * Lua invocation, so two concurrent logins cannot both read "4 of 5" and both
 * proceed.
 *
 * A sliding log rather than a fixed-window counter because a fixed window lets
 * a caller spend the whole allowance at 11:59:59 and the whole next allowance
 * at 12:00:00 — double the intended rate, exactly at the boundary an attacker
 * would aim for. Memory is O(limit) per key, and these limits are small.
 */
const SLIDING_WINDOW_LUA = `
local key     = KEYS[1]
local now     = tonumber(ARGV[1])
local window  = tonumber(ARGV[2])
local limit   = tonumber(ARGV[3])
local member  = ARGV[4]

-- Forget everything that has aged out of the window.
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

local count = redis.call('ZCARD', key)

if count >= limit then
  -- The window frees up when its oldest surviving entry expires.
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfter = window - (now - tonumber(oldest[2]))
  return { 0, count, retryAfter }
end

redis.call('ZADD', key, now, member)
-- Re-armed on every write so an idle key disappears on its own; no sweeper job.
redis.call('PEXPIRE', key, window)

return { 1, count + 1, 0 }
`;

const COMMAND_NAME = 'carcareSlidingWindow';

/** ioredis attaches commands registered with `defineCommand` at runtime. */
type RedisWithSlidingWindow = Redis & {
  [COMMAND_NAME]: (
    key: string,
    now: string,
    windowMs: string,
    limit: string,
    member: string,
  ) => Promise<[number, number, number]>;
};

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly client: RedisWithSlidingWindow;

  constructor(redis: RedisService) {
    this.client = redis.client as RedisWithSlidingWindow;

    // ioredis keeps the script server-side and calls EVALSHA, falling back to
    // EVAL only after a Redis restart flushes the script cache.
    this.client.defineCommand(COMMAND_NAME, { numberOfKeys: 1, lua: SLIDING_WINDOW_LUA });
  }

  /**
   * Records an attempt and reports whether it is permitted.
   *
   * **Fails open.** If Redis is unreachable the request is allowed and the
   * failure is logged: losing rate limiting is bad, refusing every login
   * because a cache is down is worse. See docs/decisions.md ADR-008.
   */
  async consume(key: string, limit: number, windowSec: number): Promise<RateLimitVerdict> {
    const windowMs = windowSec * 1_000;

    try {
      const [allowed, count, retryAfterMs] = await this.client[COMMAND_NAME](
        key,
        String(Date.now()),
        String(windowMs),
        String(limit),
        randomUUID(),
      );

      return {
        allowed: allowed === 1,
        limit,
        remaining: Math.max(0, limit - count),
        retryAfterSec: retryAfterMs > 0 ? Math.max(1, Math.ceil(retryAfterMs / 1_000)) : 0,
      };
    } catch (error) {
      this.logger.warn(
        `Rate limiting unavailable, allowing request: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { allowed: true, limit, remaining: limit, retryAfterSec: 0 };
    }
  }
}
