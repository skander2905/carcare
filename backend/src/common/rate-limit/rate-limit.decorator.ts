import { SetMetadata } from '@nestjs/common';
import { type RateLimitRule } from './rate-limit.types.js';

export const RATE_LIMIT_KEY = 'rateLimit:rules';

/**
 * Declares the limits for a route.
 *
 * Several rules can apply at once, and they answer different questions:
 * per-IP stops one host brute-forcing many accounts, per-email stops a
 * distributed attempt on one account. Either alone leaves the other attack
 * wide open, which is why the auth endpoints carry both.
 *
 *   @RateLimit({ scope: 'ip', limit: 10, windowSec: 60 }, { scope: 'email', limit: 5, windowSec: 300 })
 */
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT_KEY, rules);
