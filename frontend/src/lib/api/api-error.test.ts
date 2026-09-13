import { describe, expect, it } from 'vitest';
import { ApiError, toApiError } from './api-error';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ApiError', () => {
  it('exposes the backend envelope as typed fields', () => {
    const error = new ApiError({
      statusCode: 400,
      message: 'Odometer cannot be lower than the previous reading',
      error: 'BadRequest',
      details: ['odometerKm must not be less than 120000'],
      requestId: 'req-123',
    });

    expect(error.status).toBe(400);
    expect(error.code).toBe('BadRequest');
    expect(error.message).toBe('Odometer cannot be lower than the previous reading');
    expect(error.details).toEqual(['odometerKm must not be less than 120000']);
    expect(error.requestId).toBe('req-123');
  });

  it('classifies 4xx as a client error so retries are skipped', () => {
    const clientError = new ApiError({ statusCode: 409, message: 'Conflict', error: 'Conflict' });
    const serverError = new ApiError({ statusCode: 503, message: 'Down', error: 'ServiceUnavailable' });

    expect(clientError.isClientError).toBe(true);
    expect(serverError.isClientError).toBe(false);
  });

  it('flags 401 so the UI can trigger a token refresh', () => {
    expect(new ApiError({ statusCode: 401, message: 'nope', error: 'Unauthorized' }).isUnauthorized).toBe(
      true,
    );
    expect(new ApiError({ statusCode: 403, message: 'nope', error: 'Forbidden' }).isUnauthorized).toBe(false);
  });

  it('defaults details to an empty array so callers can map over it safely', () => {
    expect(new ApiError({ statusCode: 500, message: 'boom', error: 'InternalServerError' }).details).toEqual(
      [],
    );
  });
});

describe('toApiError', () => {
  it('parses the standard error envelope', async () => {
    const error = await toApiError(
      jsonResponse({ statusCode: 404, message: 'Vehicle not found', error: 'NotFound' }, 404),
    );

    expect(error.status).toBe(404);
    expect(error.code).toBe('NotFound');
    expect(error.message).toBe('Vehicle not found');
  });

  it('falls back gracefully when a proxy returns HTML instead of JSON', async () => {
    const response = new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'content-type': 'text/html' },
    });

    const error = await toApiError(response);

    expect(error.status).toBe(502);
    expect(error.code).toBe('UnexpectedResponse');
    expect(error.message).toBe('Bad Gateway');
  });

  it('tolerates an empty body', async () => {
    const error = await toApiError(new Response(null, { status: 500, statusText: 'Internal Server Error' }));

    expect(error.status).toBe(500);
    expect(error.code).toBe('UnexpectedResponse');
  });
});
