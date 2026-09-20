import { type ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthConfig } from '../../config/config.types.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { type RateLimitService } from './rate-limit.service.js';
import { type RateLimitRule, type RateLimitVerdict } from './rate-limit.types.js';

const AUTH_CONFIG = { rateLimitEnabled: true } as AuthConfig;

const allow = (limit = 10, remaining = 9): RateLimitVerdict => ({
  allowed: true,
  limit,
  remaining,
  retryAfterSec: 0,
});

const deny = (retryAfterSec = 42): RateLimitVerdict => ({
  allowed: false,
  limit: 5,
  remaining: 0,
  retryAfterSec,
});

function buildContext(request: { ip?: string; body?: unknown }, response: { setHeader: unknown }) {
  return {
    getType: () => 'http',
    getClass: () => ({ name: 'AuthController' }),
    getHandler: () => ({ name: 'login' }),
    switchToHttp: () => ({
      getRequest: () => ({ socket: { remoteAddress: undefined }, ...request }),
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard', () => {
  let reflector: Reflector;
  let limiter: { consume: ReturnType<typeof vi.fn> };
  let setHeader: ReturnType<typeof vi.fn>;
  let guard: RateLimitGuard;

  const withRules = (rules: RateLimitRule[] | undefined) => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(rules);
  };

  beforeEach(() => {
    reflector = new Reflector();
    limiter = { consume: vi.fn().mockResolvedValue(allow()) };
    setHeader = vi.fn();
    guard = new RateLimitGuard(reflector, limiter as unknown as RateLimitService, AUTH_CONFIG);
  });

  it('leaves undecorated routes completely alone', async () => {
    withRules(undefined);

    await expect(guard.canActivate(buildContext({ ip: '1.1.1.1' }, { setHeader }))).resolves.toBe(true);
    expect(limiter.consume).not.toHaveBeenCalled();
  });

  it('honours the configuration switch', async () => {
    withRules([{ scope: 'ip', limit: 1, windowSec: 60 }]);
    guard = new RateLimitGuard(
      reflector,
      limiter as unknown as RateLimitService,
      {
        rateLimitEnabled: false,
      } as AuthConfig,
    );

    await expect(guard.canActivate(buildContext({ ip: '1.1.1.1' }, { setHeader }))).resolves.toBe(true);
    expect(limiter.consume).not.toHaveBeenCalled();
  });

  it('keys per route, per scope and per identifier', async () => {
    withRules([{ scope: 'ip', limit: 10, windowSec: 60 }]);

    await guard.canActivate(buildContext({ ip: '203.0.113.7' }, { setHeader }));

    expect(limiter.consume).toHaveBeenCalledWith('ratelimit:AuthController.login:ip:203.0.113.7', 10, 60);
  });

  it('hashes the email instead of putting addresses in Redis keys', async () => {
    withRules([{ scope: 'email', limit: 5, windowSec: 300 }]);

    await guard.canActivate(
      buildContext({ ip: '1.1.1.1', body: { email: 'Sam@Example.com ' } }, { setHeader }),
    );

    const key = limiter.consume.mock.calls[0][0] as string;
    expect(key).not.toContain('example.com');
    expect(key).toMatch(/^ratelimit:AuthController\.login:email:[0-9a-f]{32}$/);
  });

  it('counts the same account regardless of how the address was typed', async () => {
    withRules([{ scope: 'email', limit: 5, windowSec: 300 }]);

    await guard.canActivate(
      buildContext({ ip: '1.1.1.1', body: { email: 'sam@example.com' } }, { setHeader }),
    );
    await guard.canActivate(
      buildContext({ ip: '1.1.1.1', body: { email: ' SAM@EXAMPLE.COM' } }, { setHeader }),
    );

    expect(limiter.consume.mock.calls[0][0]).toBe(limiter.consume.mock.calls[1][0]);
  });

  it('skips an email rule when the body has no email to count by', async () => {
    withRules([{ scope: 'email', limit: 5, windowSec: 300 }]);

    await expect(guard.canActivate(buildContext({ ip: '1.1.1.1', body: {} }, { setHeader }))).resolves.toBe(
      true,
    );
    expect(limiter.consume).not.toHaveBeenCalled();
  });

  it('throws 429 with a Retry-After the client can act on', async () => {
    withRules([{ scope: 'ip', limit: 5, windowSec: 60 }]);
    limiter.consume.mockResolvedValue(deny(42));

    const act = guard.canActivate(buildContext({ ip: '1.1.1.1' }, { setHeader }));

    await expect(act).rejects.toBeInstanceOf(HttpException);
    await expect(act).rejects.toMatchObject({ status: 429 });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', 42);
  });

  it('stops at the first breached rule rather than spending the rest', async () => {
    withRules([
      { scope: 'ip', limit: 5, windowSec: 60 },
      { scope: 'email', limit: 5, windowSec: 300 },
    ]);
    limiter.consume.mockResolvedValue(deny());

    await expect(
      guard.canActivate(buildContext({ ip: '1.1.1.1', body: { email: 'sam@example.com' } }, { setHeader })),
    ).rejects.toBeInstanceOf(HttpException);

    // The email rule must not also be charged for a request already refused.
    expect(limiter.consume).toHaveBeenCalledTimes(1);
  });

  it('reports the rule the caller is closest to breaching', async () => {
    withRules([
      { scope: 'ip', limit: 10, windowSec: 60 },
      { scope: 'email', limit: 5, windowSec: 300 },
    ]);
    limiter.consume.mockResolvedValueOnce(allow(10, 8)).mockResolvedValueOnce(allow(5, 1));

    await guard.canActivate(
      buildContext({ ip: '1.1.1.1', body: { email: 'sam@example.com' } }, { setHeader }),
    );

    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 5);
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 1);
  });
});
