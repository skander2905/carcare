import { z } from 'zod';

/**
 * `z.coerce.boolean()` is a trap: it applies JavaScript truthiness, so the
 * string "false" coerces to `true`. Environment variables are always strings,
 * so booleans need an explicit parser.
 */
const booleanFromEnv = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) =>
      typeof value === 'boolean'
        ? value
        : ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()),
    );

/** Comma-separated list -> trimmed, non-empty string array. */
const listFromEnv = (defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

/**
 * The single source of truth for every environment variable the API reads.
 * Validated once at boot; the process refuses to start on a bad value rather
 * than failing later with an undefined deep inside a request.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  /**
   * One image, two roles. `api` serves HTTP, `worker` only drains queues,
   * `all` runs both and exists for local development convenience.
   */
  APP_ROLE: z.enum(['api', 'worker', 'all']).default('api'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_PREFIX: z.string().default('api'),

  /** Required so the app fails fast rather than booting against nothing. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_PRETTY: booleanFromEnv(false),

  CORS_ORIGINS: listFromEnv('http://localhost:3000'),

  /** Behind a load balancer this must be on, or rate limiting sees one IP. */
  TRUST_PROXY: booleanFromEnv(false),

  SWAGGER_ENABLED: booleanFromEnv(true),
  SWAGGER_PATH: z.string().default('docs'),

  /** Shutdown grace period: stop accepting work, drain, then exit. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Formats every failing variable at once. Fixing a broken `.env` one error per
 * restart is miserable, so report the full set.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const problems = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}
