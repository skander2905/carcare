import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setTokenProvider, setUnauthorizedHandler } from './client';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function unauthorized(): Response {
  return json({ statusCode: 401, message: 'Authentication required', error: 'Unauthorized' }, 401);
}

function authHeaderOf(callIndex: number): string | undefined {
  const call = vi.mocked(globalThis.fetch).mock.calls[callIndex];
  const headers = (call?.[1]?.headers ?? {}) as Record<string, string>;
  return headers.Authorization;
}

describe('api client — expired access tokens', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    setTokenProvider(() => null);
    setUnauthorizedHandler(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    setTokenProvider(() => null);
    vi.restoreAllMocks();
  });

  it('refreshes and retries once on a 401', async () => {
    let token = 'expired';
    setTokenProvider(() => token);
    setUnauthorizedHandler(() => {
      token = 'refreshed';
      return Promise.resolve(true);
    });

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(json({ id: 'v1' }));

    await expect(api.get('/vehicles')).resolves.toEqual({ id: 'v1' });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    // The retry must carry the *new* token; re-sending the expired one would
    // just 401 again.
    expect(authHeaderOf(0)).toBe('Bearer expired');
    expect(authHeaderOf(1)).toBe('Bearer refreshed');
  });

  it('gives up when the refresh fails, without a second attempt', async () => {
    setUnauthorizedHandler(() => Promise.resolve(false));
    vi.mocked(globalThis.fetch).mockResolvedValue(unauthorized());

    await expect(api.get('/vehicles')).rejects.toBeInstanceOf(ApiError);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries at most once, so a still-401 response cannot loop', async () => {
    setUnauthorizedHandler(() => Promise.resolve(true));
    vi.mocked(globalThis.fetch).mockResolvedValue(unauthorized());

    await expect(api.get('/vehicles')).rejects.toMatchObject({ status: 401 });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('leaves requests that opted out alone', async () => {
    const handler = vi.fn(() => Promise.resolve(true));
    setUnauthorizedHandler(handler);
    vi.mocked(globalThis.fetch).mockResolvedValue(unauthorized());

    // This is what stops /auth/refresh from responding to its own 401 by
    // calling /auth/refresh.
    await expect(api.post('/auth/refresh', { skipAuthRefresh: true })).rejects.toBeInstanceOf(ApiError);

    expect(handler).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry anything other than a 401', async () => {
    const handler = vi.fn(() => Promise.resolve(true));
    setUnauthorizedHandler(handler);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      json({ statusCode: 403, message: 'Forbidden', error: 'Forbidden' }, 403),
    );

    await expect(api.get('/vehicles')).rejects.toMatchObject({ status: 403 });

    // A 403 means "authenticated, but not allowed" — a new token changes nothing.
    expect(handler).not.toHaveBeenCalled();
  });

  it('re-sends the original body on the retry', async () => {
    setUnauthorizedHandler(() => Promise.resolve(true));
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(json({ id: 'e1' }, 201));

    await api.post('/expenses', { body: { amount: '42.500' } });

    const retry = vi.mocked(globalThis.fetch).mock.calls[1]?.[1];
    expect(retry?.body).toBe(JSON.stringify({ amount: '42.500' }));
  });
});
