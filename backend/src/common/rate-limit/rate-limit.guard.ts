import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import { authConfig } from '../../config/configuration.js';
import { type AuthConfig } from '../../config/config.types.js';
import { RATE_LIMIT_KEY } from './rate-limit.decorator.js';
import { RateLimitService } from './rate-limit.service.js';
import { type RateLimitRule, type RateLimitVerdict } from './rate-limit.types.js';

/**
 * Enforces the `@RateLimit()` rules on a route. Routes without the decorator
 * are untouched, so this can sit globally without throttling ordinary reads.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    @Inject(authConfig.KEY) private readonly auth: AuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const rules = this.reflector.getAllAndOverride<RateLimitRule[]>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!rules?.length || !this.auth.rateLimitEnabled) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const route = `${context.getClass().name}.${context.getHandler().name}`;
    let tightest: RateLimitVerdict | undefined;

    for (const rule of rules) {
      const identifier = this.identify(rule, request);
      // Nothing to count by — a login attempt with no email in the body, say.
      // The IP rule still applies, and validation will reject the request next.
      if (!identifier) continue;

      const verdict = await this.limiter.consume(
        `ratelimit:${route}:${rule.scope}:${identifier}`,
        rule.limit,
        rule.windowSec,
      );

      // Report the rule the caller is closest to breaching, not merely the last.
      if (!tightest || verdict.remaining < tightest.remaining) tightest = verdict;
      if (!verdict.allowed) break;
    }

    if (!tightest) return true;

    response.setHeader('X-RateLimit-Limit', tightest.limit);
    response.setHeader('X-RateLimit-Remaining', tightest.remaining);

    if (!tightest.allowed) {
      response.setHeader('Retry-After', tightest.retryAfterSec);
      throw new HttpException(
        `Too many attempts. Try again in ${tightest.retryAfterSec} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private identify(rule: RateLimitRule, request: Request): string | undefined {
    if (rule.scope === 'ip') {
      // `request.ip` respects Express's trust-proxy setting, which is why
      // TRUST_PROXY exists: behind a load balancer every caller would
      // otherwise share the proxy's address and one bad actor would lock
      // everyone out.
      return request.ip ?? request.socket.remoteAddress ?? 'unknown';
    }

    const body: unknown = request.body;
    const email =
      typeof body === 'object' && body !== null && 'email' in body
        ? (body as { email?: unknown }).email
        : undefined;

    if (typeof email !== 'string' || email.length === 0) return undefined;

    // Hashed, not stored verbatim: Redis keys turn up in logs, `MONITOR`
    // output and metrics, and a key namespace full of real addresses is a
    // user list waiting to leak. The hash still counts the same account.
    return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
  }
}
