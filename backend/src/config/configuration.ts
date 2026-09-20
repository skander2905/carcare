import { registerAs } from '@nestjs/config';
import { type Env, validateEnv } from './env.schema.js';

/**
 * Validated environment, parsed exactly once.
 *
 * `ConfigModule.forRoot({ validate })` runs {@link validateEnv} at boot, and the
 * namespace factories below read the cached result. That keeps every namespace
 * strongly typed without re-parsing, and guarantees they can never observe an
 * unvalidated value.
 */
let cachedEnv: Env | undefined;

export function loadEnv(raw: Record<string, unknown> = process.env): Env {
  cachedEnv ??= validateEnv(raw);
  return cachedEnv;
}

/** Test-only: drop the cache so a suite can load a different environment. */
export function resetEnvCache(): void {
  cachedEnv = undefined;
}

export const appConfig = registerAs('app', () => {
  const env = loadEnv();
  return {
    nodeEnv: env.NODE_ENV,
    role: env.APP_ROLE,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
  };
});

export const httpConfig = registerAs('http', () => {
  const env = loadEnv();
  return {
    port: env.PORT,
    globalPrefix: env.API_PREFIX,
    corsOrigins: env.CORS_ORIGINS,
    trustProxy: env.TRUST_PROXY,
  };
});

export const databaseConfig = registerAs('database', () => ({
  url: loadEnv().DATABASE_URL,
}));

export const redisConfig = registerAs('redis', () => ({
  url: loadEnv().REDIS_URL,
}));

export const authConfig = registerAs('auth', () => {
  const env = loadEnv();
  return {
    accessSecret: env.JWT_ACCESS_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    cookieName: env.REFRESH_COOKIE_NAME,
    cookieDomain: env.REFRESH_COOKIE_DOMAIN,
    // On unless explicitly overridden in production: a refresh cookie sent over
    // plaintext HTTP is the whole credential, in the clear.
    cookieSecure: env.REFRESH_COOKIE_SECURE ?? env.NODE_ENV === 'production',
    reuseGraceMs: env.REFRESH_REUSE_GRACE_MS,
    rateLimitEnabled: env.AUTH_RATE_LIMIT_ENABLED,
  };
});

export const oauthConfig = registerAs('oauth', () => {
  const env = loadEnv();
  return {
    apiPublicUrl: env.API_PUBLIC_URL.replace(/\/+$/, ''),
    webAppUrl: env.WEB_APP_URL.replace(/\/+$/, ''),
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : undefined,
  };
});

export const loggingConfig = registerAs('logging', () => {
  const env = loadEnv();
  return {
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
  };
});

export const swaggerConfig = registerAs('swagger', () => {
  const env = loadEnv();
  return {
    // Never expose the schema of a production API by accident.
    enabled: env.SWAGGER_ENABLED && env.NODE_ENV !== 'production',
    path: env.SWAGGER_PATH,
  };
});

export const configNamespaces = [
  appConfig,
  httpConfig,
  databaseConfig,
  redisConfig,
  authConfig,
  oauthConfig,
  loggingConfig,
  swaggerConfig,
];
