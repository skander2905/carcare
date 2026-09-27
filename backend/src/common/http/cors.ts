import { type CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

/**
 * Request headers the API reads beyond the CORS-safelisted ones.
 *
 * A browser sends none of these cross-origin unless the preflight lists them —
 * and a header missing here fails silently from the API's side: the preflight
 * answers 204, and the browser then refuses to send the real request at all.
 * Integration tests never see it, because supertest does not enforce CORS.
 */
export const ALLOWED_REQUEST_HEADERS = ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'];

/** Response headers browser code may read. Everything else is hidden from it. */
export const EXPOSED_RESPONSE_HEADERS = ['X-Request-Id', 'Idempotent-Replayed'];

export function buildCorsOptions(origins: string[]): CorsOptions {
  return {
    origin: origins,
    // Required for the httpOnly refresh-token cookie to be sent at all.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ALLOWED_REQUEST_HEADERS,
    exposedHeaders: EXPOSED_RESPONSE_HEADERS,
    maxAge: 86_400,
  };
}
