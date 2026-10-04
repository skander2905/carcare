import { z } from 'zod';

/**
 * Browser-visible configuration.
 *
 * Next.js inlines `NEXT_PUBLIC_*` at build time, so these must be referenced as
 * full literals (`process.env.NEXT_PUBLIC_API_URL`) rather than looked up
 * dynamically — a computed key would be replaced with `undefined`.
 */
const publicEnvSchema = z.object({
  /** Origin only. The versioned prefix is appended by the API client, and the
      health probes deliberately sit outside it. */
  NEXT_PUBLIC_API_URL: z.url().default('http://localhost:3001'),
  NEXT_PUBLIC_APP_NAME: z.string().default('CarCare'),
});

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
});

if (!parsed.success) {
  throw new Error(
    `Invalid public environment configuration:\n${parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')}`,
  );
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The API's origin as this page should reach it.
 *
 * In development the API is configured as `localhost`, which on a phone
 * opening the app at `http://192.168.1.28:3000` is the phone itself. When the
 * configured host is local and the page was opened at another host, the
 * page's host is used with the configured port — the API runs on the same
 * machine as the web app. A real API domain is never rewritten.
 */
export function resolveApiOrigin(configured: string, pageHostname: string | undefined): string {
  const url = new URL(configured);
  if (pageHostname && LOCAL_HOSTS.has(url.hostname) && !LOCAL_HOSTS.has(pageHostname)) {
    url.hostname = pageHostname;
  }
  return url.origin;
}

const origin = resolveApiOrigin(
  parsed.data.NEXT_PUBLIC_API_URL,
  typeof window === 'undefined' ? undefined : window.location.hostname,
);

export const env = {
  /** e.g. http://localhost:3001 */
  apiOrigin: origin,
  /** e.g. http://localhost:3001/api/v1 — where the resource endpoints live. */
  apiUrl: `${origin}/api/v1`,
  appName: parsed.data.NEXT_PUBLIC_APP_NAME,
} as const;
