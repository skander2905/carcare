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

export const storageConfig = registerAs('storage', () => {
  const env = loadEnv();
  const credentials =
    env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
      : undefined;

  return {
    enabled: credentials !== undefined,
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials,
  };
});

export const mailConfig = registerAs('mail', () => {
  const env = loadEnv();
  return {
    enabled: env.SMTP_HOST !== undefined,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER && env.SMTP_PASSWORD ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    from: env.MAIL_FROM,
    // Links in an email must be absolute. Most point at the web app; the
    // one-click unsubscribe is posted by the mail client straight to the API.
    webAppUrl: env.WEB_APP_URL.replace(/\/+$/, ''),
    apiBaseUrl: `${env.API_PUBLIC_URL.replace(/\/+$/, '')}/${env.API_PREFIX}/v1`,
    // Signs unsubscribe links. Derived from the access-token key rather than a
    // new required secret; rotating that key retires old links, which is fine.
    linkSigningKey: env.JWT_ACCESS_SECRET,
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
  storageConfig,
  mailConfig,
  loggingConfig,
  swaggerConfig,
];
