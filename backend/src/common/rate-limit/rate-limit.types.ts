/** What a rule counts requests by. */
export type RateLimitScope = 'ip' | 'email';

export interface RateLimitRule {
  scope: RateLimitScope;
  /** Requests permitted within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the oldest request leaves the window. Zero when allowed. */
  retryAfterSec: number;
}
