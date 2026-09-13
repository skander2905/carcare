import { type ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { type PinoLogger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppConfig } from '../../config/config.types.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

interface CapturedResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function buildHost(overrides: Partial<{ originalUrl: string; method: string; id: unknown }> = {}) {
  const response: CapturedResponse = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };

  const request = {
    originalUrl: overrides.originalUrl ?? '/api/v1/vehicles/123/fuel',
    method: overrides.method ?? 'POST',
    id: 'id' in overrides ? overrides.id : 'req-0f9c3a5e',
  };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

function buildFilter(isProduction: boolean) {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    setContext: vi.fn(),
  } as unknown as PinoLogger;

  const config = { isProduction } as AppConfig;

  return { filter: new AllExceptionsFilter(logger, config), logger };
}

function bodyOf(response: CapturedResponse): Record<string, unknown> {
  return response.json.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let logger: PinoLogger;

  beforeEach(() => {
    ({ filter, logger } = buildFilter(false));
  });

  describe('the error envelope', () => {
    it('returns every documented field', () => {
      const { host, response } = buildHost();

      filter.catch(new BadRequestException('Odometer cannot be lower than the previous reading'), host);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(bodyOf(response)).toMatchObject({
        statusCode: 400,
        message: 'Odometer cannot be lower than the previous reading',
        error: 'BadRequest',
        path: '/api/v1/vehicles/123/fuel',
        requestId: 'req-0f9c3a5e',
      });
      expect(bodyOf(response).timestamp).toEqual(expect.any(String));
    });

    it('maps each status onto a stable machine-readable error name', () => {
      const cases: [number, string][] = [
        [HttpStatus.UNAUTHORIZED, 'Unauthorized'],
        [HttpStatus.FORBIDDEN, 'Forbidden'],
        [HttpStatus.NOT_FOUND, 'NotFound'],
        [HttpStatus.CONFLICT, 'Conflict'],
        [HttpStatus.TOO_MANY_REQUESTS, 'TooManyRequests'],
      ];

      for (const [status, expected] of cases) {
        const { host, response } = buildHost();
        filter.catch(new HttpException('boom', status), host);
        expect(bodyOf(response).error).toBe(expected);
      }
    });

    it('falls back to an empty request id when no correlation id is present', () => {
      const { host, response } = buildHost({ id: undefined });

      filter.catch(new BadRequestException('nope'), host);

      expect(bodyOf(response).requestId).toBe('');
    });
  });

  describe('validation failures', () => {
    it('promotes the first field error to the headline and keeps the full list', () => {
      const { host, response } = buildHost();

      filter.catch(
        new BadRequestException({
          message: ['email must be an email', 'password is too short'],
          error: 'BadRequest',
          statusCode: 400,
        }),
        host,
      );

      expect(bodyOf(response)).toMatchObject({
        message: 'email must be an email',
        details: ['email must be an email', 'password is too short'],
      });
    });

    it('omits `details` entirely for non-validation errors', () => {
      const { host, response } = buildHost();

      filter.catch(new BadRequestException('single problem'), host);

      expect(bodyOf(response)).not.toHaveProperty('details');
    });
  });

  describe('unexpected errors', () => {
    it('surfaces the real message in development to keep debugging cheap', () => {
      const { host, response } = buildHost();

      filter.catch(new Error('connect ECONNREFUSED 127.0.0.1:5432'), host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(bodyOf(response).message).toContain('ECONNREFUSED');
    });

    it('never leaks internal detail in production', () => {
      const production = buildFilter(true);
      const { host, response } = buildHost();

      production.filter.catch(new Error('password authentication failed for user "carcare"'), host);

      const body = bodyOf(response);
      expect(body.statusCode).toBe(500);
      expect(JSON.stringify(body)).not.toContain('password authentication failed');
      expect(body.message).toContain('request id');
    });

    it('handles a thrown non-Error value without crashing the filter', () => {
      const { host, response } = buildHost();

      filter.catch('a bare string', host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(bodyOf(response).error).toBe('InternalServerError');
    });
  });

  describe('log routing', () => {
    it('logs 5xx at error level — these are incidents', () => {
      const { host } = buildHost();

      filter.catch(new Error('kaboom'), host);

      expect(logger.error).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('logs 4xx at warn level so client mistakes do not page anyone', () => {
      const { host } = buildHost();

      filter.catch(new BadRequestException('bad input'), host);

      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
