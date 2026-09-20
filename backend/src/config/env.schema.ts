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
      typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()),
    );

/** Same parsing, but absent means "unset" rather than a fixed default — so the
    caller can derive the default from another variable (see REFRESH_COOKIE_SECURE). */
const optionalBooleanFromEnv = () =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : typeof value === 'boolean'
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

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/**
 * The single source of truth for every environment variable the API reads.
 * Validated once at boot; the process refuses to start on a bad value rather
 * than failing later with an undefined deep inside a request.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

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

  /**
   * Access-token signing key. Deliberately has **no default**: a predictable
   * secret is indistinguishable from no authentication at all, so an operator
   * who forgets it gets a boot failure rather than a forgeable token.
   */
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  /** Any `ms` duration string. Short by design — revocation is the refresh
      token's job, so a leaked access token must expire quickly on its own. */
  JWT_ACCESS_TTL: z
    .string()
    .regex(/^\d+(?:ms|s|m|h|d|w|y)?$/, 'JWT_ACCESS_TTL must be a duration such as 15m, 900s or 900')
    .default('15m'),
  JWT_ISSUER: z.string().default('carcare'),
  JWT_AUDIENCE: z.string().default('carcare-api'),

  /** Refresh-token lifetime, i.e. how long "stay logged in" actually lasts. */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
  REFRESH_COOKIE_NAME: z.string().default('carcare_refresh_token'),
  /** Unset means host-only, which is correct unless the API and the web app
      live on different subdomains of one site. */
  REFRESH_COOKIE_DOMAIN: z.string().optional(),
  /** Defaults to on in production; see configuration.ts. */
  REFRESH_COOKIE_SECURE: optionalBooleanFromEnv(),
  /**
   * Two tabs can refresh at the same instant. Within this window a
   * already-rotated token is treated as the same logical refresh rather than a
   * replay, so a race logs nobody out. See docs/decisions.md ADR-010.
   */
  REFRESH_REUSE_GRACE_MS: z.coerce.number().int().nonnegative().max(60_000).default(10_000),

  /**
   * Public origins, as a browser sees them. OAuth needs absolute URLs: the
   * provider redirects the browser back here, so a relative path is meaningless
   * and a value inferred from the request Host header would be attacker-
   * controlled.
   */
  API_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),

  /**
   * Google sign-in. Both optional: without them the provider is simply not
   * registered, the button does not render, and the rest of the API is
   * unaffected — a fresh clone and CI must not need credentials to boot.
   */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  /** Escape hatch for tests and local debugging; never turn this off in production. */
  AUTH_RATE_LIMIT_ENABLED: booleanFromEnv(true),

  /** Shutdown grace period: stop accepting work, drain, then exit. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

/**
 * Half-configured OAuth is worse than none: the button renders, the user
 * clicks it, and the failure lands after the redirect where there is no good
 * way to explain it. Fail at boot instead.
 */
export const envSchemaWithRules = envSchema.superRefine((env, ctx) => {
  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_CLIENT_SECRET'],
      message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together, or both left unset',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Formats every failing variable at once. Fixing a broken `.env` one error per
 * restart is miserable, so report the full set.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchemaWithRules.safeParse(raw);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}
