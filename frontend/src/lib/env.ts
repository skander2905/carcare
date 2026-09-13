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

const origin = parsed.data.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');

export const env = {
  /** e.g. http://localhost:3001 */
  apiOrigin: origin,
  /** e.g. http://localhost:3001/api/v1 — where the resource endpoints live. */
  apiUrl: `${origin}/api/v1`,
  appName: parsed.data.NEXT_PUBLIC_APP_NAME,
} as const;
