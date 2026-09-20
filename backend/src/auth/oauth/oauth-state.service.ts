import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service.js';

/** Long enough to sign in and pick an account; short enough to bound replay. */
const STATE_TTL_SECONDS = 600;

const KEY_PREFIX = 'oauth:state:';

export interface OAuthState {
  provider: string;
  codeVerifier: string;
  /** In-app path to return the browser to once the callback completes. */
  returnTo: string;
  /**
   * Set when the flow was started from an authenticated session to attach a
   * provider to an existing account, rather than to sign in.
   */
  linkUserId?: string;
}

/**
 * Pending authorization requests.
 *
 * Kept in Redis rather than in a signed cookie so the entry can be **deleted on
 * use**. A self-contained cookie is replayable until it expires: the same
 * callback URL would work twice, and a code intercepted once could be retried.
 * Redis also means a callback can land on any API replica, which a per-process
 * map would not survive.
 *
 * Unlike the rate limiter, this fails **closed**. The limiter degrades a
 * defence when Redis is down; this one *is* the defence — without it a callback
 * cannot be attributed to a request the user actually started.
 */
@Injectable()
export class OAuthStateService {
  private readonly logger = new Logger(OAuthStateService.name);

  constructor(private readonly redis: RedisService) {}

  async save(state: string, value: OAuthState): Promise<void> {
    await this.redis.client.set(KEY_PREFIX + state, JSON.stringify(value), 'EX', STATE_TTL_SECONDS);
  }

  /**
   * Reads a pending request and removes it in the same round trip.
   *
   * `GETDEL` rather than get-then-delete: two callbacks arriving together must
   * not both succeed, and only an atomic read-and-delete guarantees that.
   */
  async consume(state: string): Promise<OAuthState | null> {
    const raw = await this.redis.client.getdel(KEY_PREFIX + state);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as OAuthState;
    } catch {
      // Written by this service, so this should be unreachable; treating it as
      // "no such state" keeps a corrupt value from becoming a 500.
      this.logger.warn('Discarding an unparseable OAuth state entry');
      return null;
    }
  }
}
