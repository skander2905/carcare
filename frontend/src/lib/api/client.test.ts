import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, api, setTokenProvider } from './client';

const ORIGIN = 'http://localhost:3001/api/v1';

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function lastCall(): [string, RequestInit] {
  const mock = vi.mocked(globalThis.fetch);
  const call = mock.mock.calls.at(-1);
  return [String(call?.[0]), (call?.[1] ?? {}) as RequestInit];
}

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    setTokenProvider(() => null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prefixes the versioned API base', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(ok({ id: 'v1' }));

    await api.get('/vehicles');

    expect(lastCall()[0]).toBe(`${ORIGIN}/vehicles`);
  });

  it('tolerates a path given without a leading slash', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(ok([]));

    await api.get('vehicles');

    expect(lastCall()[0]).toBe(`${ORIGIN}/vehicles`);
  });

  it('serialises query parameters and drops null/undefined ones', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(ok([]));

    await api.get('/expenses', {
      query: { page: 1, category: 'FUEL', vendor: undefined, search: null, includeArchived: false },
    });

    const url = new URL(lastCall()[0]);
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('category')).toBe('FUEL');
    expect(url.searchParams.get('includeArchived')).toBe('false');
    expect(url.searchParams.has('vendor')).toBe(false);
    expect(url.searchParams.has('search')).toBe(false);
  });

  it('sends credentials so the httpOnly refresh cookie is included', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(ok({}));

    await api.get('/auth/me');

    expect(lastCall()[1].credentials).toBe('include');
  });

  it('attaches the bearer token supplied by the token provider', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(ok({}));
    setTokenProvider(() => 'access-token-123');

    await api.get('/vehicles');

    const headers = lastCall()[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-token-123');
  });

  it('omits the Authorization header when there is no token', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(ok({}));

    await api.get('/vehicles');

    expect(lastCall()[1].headers as Record<string, string>).not.toHaveProperty('Authorization');
  });

  it('JSON-encodes the body and sets the content type', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(ok({ id: 'x' }, 201));

    await api.post('/vehicles', { body: { make: 'Volkswagen', model: 'Golf 7' } });

    const [, init] = lastCall();
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"make":"Volkswagen","model":"Golf 7"}');
  });

  it('does not set a content type for requests without a body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(ok({}));

    await api.get('/vehicles');

    expect(lastCall()[1].headers as Record<string, string>).not.toHaveProperty('Content-Type');
  });

  it('throws a typed ApiError carrying the backend envelope', async () => {
    // A Response body is a one-shot stream, so build a fresh one per call.
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve(
        ok({ statusCode: 400, message: 'Odometer cannot go backwards', error: 'BadRequest' }, 400),
      ),
    );

    const failure = api.post('/vehicles/1/fuel', { body: {} });

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      status: 400,
      code: 'BadRequest',
      message: 'Odometer cannot go backwards',
    });
  });

  it('translates a transport failure into a NetworkError', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(api.get('/vehicles')).rejects.toBeInstanceOf(NetworkError);
  });

  it('returns undefined for a 204 rather than failing to parse an empty body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 204 }));

    await expect(api.delete('/vehicles/1')).resolves.toBeUndefined();
  });

  it('propagates an abort so TanStack Query can cancel in-flight requests', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    vi.mocked(globalThis.fetch).mockRejectedValue(abort);

    await expect(api.get('/vehicles')).rejects.toBe(abort);
  });
});
