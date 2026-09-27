import { describe, expect, it } from 'vitest';
import { buildCorsOptions } from './cors.js';

describe('buildCorsOptions', () => {
  const options = buildCorsOptions(['http://localhost:3000']);

  /**
   * Found in the browser, not by the integration suite: without this entry the
   * preflight succeeded and Chrome then blocked every expense submission.
   */
  it('lets browsers send an Idempotency-Key', () => {
    expect(options.allowedHeaders).toContain('Idempotency-Key');
  });

  it('lets browser code see that a response was a replay', () => {
    expect(options.exposedHeaders).toContain('Idempotent-Replayed');
  });

  it('allows credentials, or the refresh cookie never travels', () => {
    expect(options.credentials).toBe(true);
  });

  it('only admits the configured origins', () => {
    expect(options.origin).toEqual(['http://localhost:3000']);
  });
});
