import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';

const REQUIRED = {
  DATABASE_URL: 'postgresql://carcare:carcare@localhost:5432/carcare',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a-test-signing-key-of-at-least-32-characters',
};

describe('validateEnv', () => {
  it('applies documented defaults when only the required variables are set', () => {
    const env = validateEnv({ ...REQUIRED });

    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_ROLE).toBe('api');
    expect(env.PORT).toBe(3001);
    expect(env.API_PREFIX).toBe('api');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('fails fast when a required variable is missing', () => {
    expect(() => validateEnv({ REDIS_URL: REQUIRED.REDIS_URL })).toThrow(/DATABASE_URL/);
  });

  it('reports every invalid variable at once rather than one per restart', () => {
    const act = () => validateEnv({ ...REQUIRED, PORT: '70000', LOG_LEVEL: 'chatty' });

    expect(act).toThrow(/PORT/);
    expect(act).toThrow(/LOG_LEVEL/);
  });

  describe('boolean parsing', () => {
    // The reason booleanFromEnv exists: z.coerce.boolean('false') === true,
    // which would silently enable pretty logging (or Swagger) in production.
    it('treats the string "false" as false', () => {
      expect(validateEnv({ ...REQUIRED, LOG_PRETTY: 'false' }).LOG_PRETTY).toBe(false);
    });

    it('accepts the usual truthy spellings', () => {
      for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
        expect(validateEnv({ ...REQUIRED, LOG_PRETTY: value }).LOG_PRETTY).toBe(true);
      }
    });

    it('treats anything unrecognised as false rather than guessing', () => {
      expect(validateEnv({ ...REQUIRED, LOG_PRETTY: 'maybe' }).LOG_PRETTY).toBe(false);
    });
  });

  describe('CORS origins', () => {
    it('splits a comma-separated list and trims whitespace', () => {
      const env = validateEnv({
        ...REQUIRED,
        CORS_ORIGINS: 'http://localhost:3000, https://carcare.app ',
      });

      expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://carcare.app']);
    });

    it('drops empty entries from a trailing comma', () => {
      expect(validateEnv({ ...REQUIRED, CORS_ORIGINS: 'https://carcare.app,' }).CORS_ORIGINS).toEqual([
        'https://carcare.app',
      ]);
    });
  });

  it('coerces numeric variables from their string form', () => {
    const env = validateEnv({
      ...REQUIRED,
      PORT: '8080',
      SHUTDOWN_TIMEOUT_MS: '5000',
    });

    expect(env.PORT).toBe(8080);
    expect(env.SHUTDOWN_TIMEOUT_MS).toBe(5000);
  });

  describe('authentication', () => {
    // The whole point of having no default: an operator who forgets the secret
    // must get a boot failure, not a token anyone who read the repo can forge.
    it('refuses to boot without a signing key', () => {
      const { JWT_ACCESS_SECRET: _omitted, ...withoutSecret } = REQUIRED;

      expect(() => validateEnv(withoutSecret)).toThrow(/JWT_ACCESS_SECRET/);
    });

    it('rejects a signing key short enough to brute-force', () => {
      expect(() => validateEnv({ ...REQUIRED, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
        /at least 32 characters/,
      );
    });

    it('rejects an access TTL that is not a duration', () => {
      expect(() => validateEnv({ ...REQUIRED, JWT_ACCESS_TTL: 'fifteen minutes' })).toThrow(/JWT_ACCESS_TTL/);
    });

    it('accepts the duration spellings jsonwebtoken understands', () => {
      for (const ttl of ['900', '900s', '15m', '1h', '7d']) {
        expect(validateEnv({ ...REQUIRED, JWT_ACCESS_TTL: ttl }).JWT_ACCESS_TTL).toBe(ttl);
      }
    });

    it('applies the documented session defaults', () => {
      const env = validateEnv({ ...REQUIRED });

      expect(env.JWT_ACCESS_TTL).toBe('15m');
      expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30);
      expect(env.REFRESH_COOKIE_NAME).toBe('carcare_refresh_token');
      expect(env.REFRESH_REUSE_GRACE_MS).toBe(10_000);
      expect(env.AUTH_RATE_LIMIT_ENABLED).toBe(true);
    });

    // Left undefined so configuration.ts can derive it from NODE_ENV; a baked-in
    // `false` default would quietly ship an insecure cookie to production.
    it('leaves the Secure flag unset when it is not configured', () => {
      expect(validateEnv({ ...REQUIRED }).REFRESH_COOKIE_SECURE).toBeUndefined();
      expect(validateEnv({ ...REQUIRED, REFRESH_COOKIE_SECURE: 'false' }).REFRESH_COOKIE_SECURE).toBe(false);
      expect(validateEnv({ ...REQUIRED, REFRESH_COOKIE_SECURE: 'true' }).REFRESH_COOKIE_SECURE).toBe(true);
    });
  });
});
