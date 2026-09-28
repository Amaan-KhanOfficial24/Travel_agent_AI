// The ONE place the frontend talks to the API. Every request goes through apiFetch, so
// cookies, timeouts, JSON parsing and error handling are done the same way everywhere.

// Development: "/api" (Vite proxies it to the API). Production (Stage 10): the API's URL.
const BASE = import.meta.env.VITE_API_URL ?? '/api';
const TIMEOUT_MS = 15_000;

export type FieldError = { field: string; message: string };

/** Every failure becomes an ApiError with the same shape as the API's error body. */
export class ApiError extends Error {
  constructor(
    public readonly status: number, // HTTP status, or 0 when the server was never reached
    public readonly code: string,
    message: string,
    public readonly details: FieldError[] = [],
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

// Anything that must react to "you are no longer logged in" (the auth context) registers here.
let onUnauthenticated: (() => void) | undefined;
export const setUnauthenticatedHandler = (fn: () => void) => {
  onUnauthenticated = fn;
};

export async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: options.method ?? 'GET',
      // Send and accept the session cookie. Same origin in development; needed
      // explicitly when the API is on another site (Stage 10).
      credentials: 'include',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    // fetch only throws when there is NO HTTP response at all: server down, network
    // gone, DNS failure, CORS refusal, or our own timeout.
    const timedOut = (err as Error).name === 'AbortError';
    throw new ApiError(
      0,
      timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      timedOut ? 'The server took too long to respond. Please try again.' : 'Cannot reach the server. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T; // No Content: nothing to parse

  // Parse JSON if there is any. A proxy error page (HTML) must not crash the app.
  const body = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const e = body?.error;
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') onUnauthenticated?.();
    throw new ApiError(
      res.status,
      e?.code ?? 'HTTP_' + res.status,
      e?.message ?? (res.status >= 500 ? 'The server had a problem. Please try again.' : 'Request failed'),
      e?.details ?? [],
      e?.requestId ?? res.headers.get('x-request-id') ?? undefined,
    );
  }
  return body?.data as T;
}
