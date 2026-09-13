import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The single error envelope every failing endpoint returns.
 *
 * Keeping this shape stable matters more than it looks: the frontend has one
 * error parser, and API consumers never have to branch on which layer failed.
 */
export class ApiErrorResponse {
  @ApiProperty({
    example: 400,
    description: 'HTTP status code, mirrored in the response status.',
  })
  statusCode: number;

  @ApiProperty({
    example: 'Odometer cannot be lower than the previous reading',
    description: 'Human-readable description, safe to display to an end user.',
  })
  message: string;

  @ApiProperty({
    example: 'BadRequest',
    description: 'Stable machine-readable error name.',
  })
  error: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['email must be an email', 'password must be at least 12 characters'],
    description: 'Field-level problems. Present for validation failures.',
  })
  details?: string[];

  @ApiProperty({ example: '/api/v1/vehicles/123/fuel' })
  path: string;

  @ApiProperty({ example: '2026-09-13T09:24:11.482Z' })
  timestamp: string;

  @ApiProperty({
    example: '0f9c3a5e-6f1b-4a2f-9a9a-2d1b0f4c77e1',
    description: 'Correlates this response with the server logs for the same request.',
  })
  requestId: string;
}

/** Maps an HTTP status onto the stable `error` name used in the envelope. */
export const HTTP_ERROR_NAMES: Readonly<Record<number, string>> = {
  400: 'BadRequest',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'NotFound',
  405: 'MethodNotAllowed',
  409: 'Conflict',
  410: 'Gone',
  413: 'PayloadTooLarge',
  415: 'UnsupportedMediaType',
  422: 'UnprocessableEntity',
  429: 'TooManyRequests',
  500: 'InternalServerError',
  502: 'BadGateway',
  503: 'ServiceUnavailable',
  504: 'GatewayTimeout',
};

export function httpErrorName(status: number): string {
  return HTTP_ERROR_NAMES[status] ?? (status >= 500 ? 'InternalServerError' : 'Error');
}

export interface ErrorEnvelopeInput {
  status: number;
  message: string;
  details?: string[];
  path: string;
  requestId: string;
}

/**
 * Single constructor for the error envelope.
 *
 * Both the Nest exception filter and the Express-level 404 fallback build their
 * response through here, so the two paths cannot drift into returning different
 * shapes for the same class of failure.
 */
export function buildErrorEnvelope({
  status,
  message,
  details,
  path,
  requestId,
}: ErrorEnvelopeInput): ApiErrorResponse {
  return {
    statusCode: status,
    message,
    error: httpErrorName(status),
    ...(details && details.length > 0 ? { details } : {}),
    path,
    timestamp: new Date().toISOString(),
    requestId,
  };
}

/**
 * `pino-http` attaches a request id to the raw request. Express has no
 * declaration for it, so read it defensively rather than asserting a shape.
 */
export function readRequestId(request: { id?: unknown }): string {
  const { id } = request;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
}
