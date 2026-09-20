import { env } from '../env';
import { ApiError, NetworkError, toApiError } from './api-error';

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  /** Serialised as JSON unless it is already a FormData/Blob body. */
  body?: unknown;
  /** Appended as a query string, skipping null/undefined values. */
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /**
   * Opts out of the refresh-and-retry on 401.
   *
   * The auth calls themselves set this: having `/auth/refresh` respond to its
   * own 401 by calling `/auth/refresh` is an infinite loop, and a failed login
   * is a wrong password rather than an expired session.
   */
  skipAuthRefresh?: boolean;
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Supplies the bearer token for outgoing requests.
 *
 * Phase 1 has no authentication, so the default returns nothing. Phase 2
 * installs a real provider backed by the in-memory access token — deliberately
 * an injection point rather than a module-level import, so the token store and
 * the transport stay decoupled and testable.
 */
export type TokenProvider = () => string | null;

let tokenProvider: TokenProvider = () => null;

export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

/**
 * Called when a request comes back 401. Returning `true` means a new access
 * token is now available and the request is worth retrying once.
 *
 * Access tokens last fifteen minutes, so an open tab hits this routinely. The
 * alternative — surfacing every expiry to the user as an error — would mean
 * being logged out mid-task several times an hour.
 */
export type UnauthorizedHandler = () => Promise<boolean>;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${env.apiUrl}${path.startsWith('/') ? path : `/${path}`}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, skipAuthRefresh, ...rest } = options;

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const url = buildUrl(path, query);

  const send = async (): Promise<Response> => {
    // Read the token per attempt, not once: the retry must use the token the
    // refresh just produced, not the expired one that caused the 401.
    const token = tokenProvider();

    return fetch(url, {
      method,
      // Required so the httpOnly refresh cookie travels with the request.
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(isFormData || body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: isFormData ? (body as FormData) : JSON.stringify(body) }),
      ...rest,
    }).catch((cause: unknown) => {
      // `fetch` rejects only on network/CORS failure, never on a 4xx/5xx.
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new NetworkError(cause);
    });
  };

  let response = await send();

  // Exactly one retry. If the refreshed token is also rejected, something is
  // wrong that retrying cannot fix, and looping would hammer the API.
  if (response.status === 401 && !skipAuthRefresh && unauthorizedHandler) {
    if (await unauthorizedHandler()) response = await send();
  }

  if (!response.ok) throw await toApiError(response);

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, options?: RequestOptions) => request<T>('POST', path, options),
  patch: <T>(path: string, options?: RequestOptions) => request<T>('PATCH', path, options),
  put: <T>(path: string, options?: RequestOptions) => request<T>('PUT', path, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};

export { ApiError, NetworkError };
