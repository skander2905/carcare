import { type NextFunction, type Request, type Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { notFoundHandler } from './not-found.handler.js';

function buildContext(overrides: Partial<{ headersSent: boolean; id: unknown; url: string }> = {}) {
  const request = {
    method: 'GET',
    originalUrl: overrides.url ?? '/api/v1/does-not-exist',
    id: 'id' in overrides ? overrides.id : 'req-abc',
  } as unknown as Request;

  const response = {
    headersSent: overrides.headersSent ?? false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

  const next = vi.fn() as unknown as NextFunction;

  return { request, response, next };
}

/**
 * Regression cover for a real gap: a URL matching no route never reaches Nest,
 * so Express answered it with an HTML error page and the uniform JSON error
 * envelope silently did not apply to 404s.
 */
describe('notFoundHandler', () => {
  it('answers an unmatched route with the standard JSON envelope', () => {
    const { request, response, next } = buildContext();

    notFoundHandler(request, response, next);

    expect(response.status).toHaveBeenCalledWith(404);

    const body = response.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      statusCode: 404,
      error: 'NotFound',
      message: 'Cannot GET /api/v1/does-not-exist',
      path: '/api/v1/does-not-exist',
      requestId: 'req-abc',
    });
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it('names the actual method so the message is useful for any verb', () => {
    const { request, response, next } = buildContext();
    (request as { method: string }).method = 'DELETE';

    notFoundHandler(request, response, next);

    expect((response.json.mock.calls[0]?.[0] as { message: string }).message).toBe(
      'Cannot DELETE /api/v1/does-not-exist',
    );
  });

  it('defers when a response has already been sent rather than writing twice', () => {
    const { request, response, next } = buildContext({ headersSent: true });

    notFoundHandler(request, response, next);

    expect(next).toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('tolerates a missing correlation id', () => {
    const { request, response, next } = buildContext({ id: undefined });

    notFoundHandler(request, response, next);

    expect((response.json.mock.calls[0]?.[0] as { requestId: string }).requestId).toBe('');
  });
});
