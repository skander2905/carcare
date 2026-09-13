/** Mirrors the backend's `ApiErrorResponse` envelope. */
export interface ApiErrorBody {
  statusCode: number;
  message: string;
  error: string;
  details?: string[];
  path?: string;
  timestamp?: string;
  requestId?: string;
}

/**
 * Every failed API call surfaces as this one type, so UI code branches on
 * `error.status` / `error.code` rather than re-parsing response shapes.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string[];
  readonly requestId?: string;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = body.statusCode;
    this.code = body.error;
    this.details = body.details ?? [];
    this.requestId = body.requestId;
  }

  /** True when retrying cannot help — the request itself is wrong. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** Network failure, CORS rejection, or an unparseable response. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('Could not reach the CarCare API. Check your connection and try again.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.statusCode === 'number' && typeof candidate.message === 'string';
}

/**
 * Builds an {@link ApiError} from a failed response, tolerating servers that
 * return HTML or an empty body (a proxy 502, say) instead of our envelope.
 */
export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (isApiErrorBody(body)) return new ApiError(body);

  return new ApiError({
    statusCode: response.status,
    message: response.statusText || 'Request failed',
    error: 'UnexpectedResponse',
  });
}
