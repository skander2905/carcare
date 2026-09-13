import { env } from '../env';
import { ApiError, NetworkError, toApiError } from './api-error';

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  /** Serialised as JSON unless it is already a FormData/Blob body. */
  body?: unknown;
  /** Appended as a query string, skipping null/undefined values. */
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
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

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${env.apiUrl}${path.startsWith('/') ? path : `/${path}`}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options;

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const token = tokenProvider();

  const response = await fetch(buildUrl(path, query), {
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
