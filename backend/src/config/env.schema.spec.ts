import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';

const REQUIRED = {
  DATABASE_URL: 'postgresql://carcare:carcare@localhost:5432/carcare',
  REDIS_URL: 'redis://localhost:6379',
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
    expect(() => validateEnv({ REDIS_URL: REQUIRED.REDIS_URL })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('reports every invalid variable at once rather than one per restart', () => {
    const act = () =>
      validateEnv({ ...REQUIRED, PORT: '70000', LOG_LEVEL: 'chatty' });

    expect(act).toThrow(/PORT/);
    expect(act).toThrow(/LOG_LEVEL/);
  });

  describe('boolean parsing', () => {
    // The reason booleanFromEnv exists: z.coerce.boolean('false') === true,
    // which would silently enable pretty logging (or Swagger) in production.
    it('treats the string "false" as false', () => {
      expect(validateEnv({ ...REQUIRED, LOG_PRETTY: 'false' }).LOG_PRETTY).toBe(
        false,
      );
    });

    it('accepts the usual truthy spellings', () => {
      for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
        expect(validateEnv({ ...REQUIRED, LOG_PRETTY: value }).LOG_PRETTY).toBe(
          true,
        );
      }
    });

    it('treats anything unrecognised as false rather than guessing', () => {
      expect(validateEnv({ ...REQUIRED, LOG_PRETTY: 'maybe' }).LOG_PRETTY).toBe(
        false,
      );
    });
  });

  describe('CORS origins', () => {
    it('splits a comma-separated list and trims whitespace', () => {
      const env = validateEnv({
        ...REQUIRED,
        CORS_ORIGINS: 'http://localhost:3000, https://carcare.app ',
      });

      expect(env.CORS_ORIGINS).toEqual([
        'http://localhost:3000',
        'https://carcare.app',
      ]);
    });

    it('drops empty entries from a trailing comma', () => {
      expect(
        validateEnv({ ...REQUIRED, CORS_ORIGINS: 'https://carcare.app,' })
          .CORS_ORIGINS,
      ).toEqual(['https://carcare.app']);
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
});
