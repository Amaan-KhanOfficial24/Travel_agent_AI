// Duffel HTTP client. Every call goes through `request`, which adds auth and version
// headers, applies a timeout, and turns every failure into a ProviderError that tells
// the caller three things: what category of problem it is, whether it is safe to
// retry, and whether we KNOW the outcome (a timed-out order creation may have worked).
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import type { DuffelErrorBody, DuffelOffer, DuffelOfferRequest, DuffelOrder } from './types.js';

export type ProviderErrorCategory =
  | 'NOT_CONFIGURED'
  | 'OFFER_UNAVAILABLE' // offer gone, expired or price changed: recoverable by re-shopping
  | 'INVALID_REQUEST' // our data was rejected (e.g. passenger name format)
  | 'AUTH' // token missing, wrong or expired
  | 'RATE_LIMITED'
  | 'FUNDING' // insufficient Duffel balance
  | 'AIRLINE_ERROR'
  | 'TIMEOUT'
  | 'UNAVAILABLE'; // network failure or Duffel 5xx

export class ProviderError extends Error {
  constructor(
    public readonly category: ProviderErrorCategory,
    message: string,
    public readonly retryable: boolean,
    public readonly outcomeKnown: boolean,
    public readonly code?: string,
    public readonly status?: number,
    public readonly providerRequestId?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

const UNAVAILABLE_CODES = new Set(['offer_no_longer_available', 'price_changed', 'offer_expired']);

function classify(status: number, body: DuffelErrorBody | null, write: boolean): ProviderError {
  const e = body?.errors?.[0];
  const code = e?.code;
  const msg = e?.message ?? e?.title ?? `Duffel responded ${status}`;
  const rid = body?.meta?.request_id;
  if (code && UNAVAILABLE_CODES.has(code)) return new ProviderError('OFFER_UNAVAILABLE', msg, false, true, code, status, rid);
  if (code === 'insufficient_balance') return new ProviderError('FUNDING', msg, false, true, code, status, rid);
  if (status === 401 || status === 403 || e?.type === 'authentication_error')
    return new ProviderError('AUTH', msg, false, true, code, status, rid);
  if (status === 429) return new ProviderError('RATE_LIMITED', msg, !write, true, code, status, rid);
  if (status === 504 || code === 'airline_timeout') return new ProviderError('TIMEOUT', msg, !write, !write, code, status, rid);
  // The airline answered with an error: the order was NOT made (outcome known), unless
  // it was a 5xx during a write, where we cannot be sure.
  if (e?.type === 'airline_error') return new ProviderError('AIRLINE_ERROR', msg, false, status < 500 || !write, code, status, rid);
  if (status >= 500) return new ProviderError('UNAVAILABLE', msg, !write, !write, code, status, rid);
  return new ProviderError('INVALID_REQUEST', msg, false, true, code, status, rid);
}

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; query?: Record<string, string>; write?: boolean; timeoutMs?: number } = {},
): Promise<{ status: number; data: T | null }> {
  if (!config.DUFFEL_ACCESS_TOKEN) {
    throw new ProviderError('NOT_CONFIGURED', 'Flight search is not configured: set DUFFEL_ACCESS_TOKEN', false, true);
  }
  const url = new URL(path, config.DUFFEL_BASE_URL);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const write = opts.write ?? false;
  const started = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.DUFFEL_ACCESS_TOKEN}`,
        'Duffel-Version': 'v2',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify({ data: opts.body }) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    logger.warn({ method, path, ms: Date.now() - started, err: (err as Error).message }, 'Duffel request failed');
    // A failed READ is safe to retry. A failed WRITE (order creation) has an UNKNOWN
    // outcome: the airline may have booked it before the connection dropped.
    return Promise.reject(
      new ProviderError(timedOut ? 'TIMEOUT' : 'UNAVAILABLE', timedOut ? 'Duffel timed out' : 'Cannot reach Duffel', !write, !write),
    );
  }

  const text = await res.text();
  const json = text ? (JSON.parse(text) as { data?: T } & DuffelErrorBody) : null;
  logger.info({ method, path, status: res.status, ms: Date.now() - started, duffelRequestId: json?.meta?.request_id }, 'Duffel call');
  if (!res.ok) throw classify(res.status, json, write);
  return { status: res.status, data: json?.data ?? null };
}

/** Reads are retried twice with backoff on retryable errors. Writes never are. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ProviderError) || !err.retryable || attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 200));
    }
  }
}

export type SearchSlice = { origin: string; destination: string; departure_date: string };
export type SearchPassenger = { type: 'adult' } | { age: number };

export const duffel = {
  isConfigured: () => Boolean(config.DUFFEL_ACCESS_TOKEN),
  isTestMode: () => config.DUFFEL_ACCESS_TOKEN.startsWith('duffel_test_'),

  async searchOffers(input: {
    slices: SearchSlice[];
    passengers: SearchPassenger[];
    cabin_class: string;
    max_connections?: number;
  }): Promise<DuffelOfferRequest> {
    const { data } = await withRetry(() =>
      request<DuffelOfferRequest>('POST', '/air/offer_requests', {
        body: input,
        query: { return_offers: 'true', supplier_timeout: String(config.DUFFEL_SUPPLIER_TIMEOUT_MS) },
        timeoutMs: config.DUFFEL_SUPPLIER_TIMEOUT_MS + 15_000,
      }),
    );
    return data ?? { id: '', offers: [] };
  },

  /** Latest state of one offer, or null if it no longer exists. */
  async getOffer(providerOfferId: string): Promise<DuffelOffer | null> {
    try {
      const { data } = await withRetry(() => request<DuffelOffer>('GET', `/air/offers/${encodeURIComponent(providerOfferId)}`));
      return data;
    } catch (err) {
      if (err instanceof ProviderError && (err.category === 'OFFER_UNAVAILABLE' || err.status === 404)) return null;
      throw err;
    }
  },

  /** Instant order paid from the Duffel balance. Returns status 201 (done) or 202/200 (accepted, pending). */
  async createOrder(body: {
    selected_offers: string[];
    passengers: Record<string, unknown>[];
    amount: string;
    currency: string;
    metadata: Record<string, string>;
  }): Promise<{ status: number; order: DuffelOrder | null }> {
    const { status, data } = await request<DuffelOrder>('POST', '/air/orders', {
      write: true,
      timeoutMs: 90_000,
      body: {
        type: 'instant',
        selected_offers: body.selected_offers,
        passengers: body.passengers,
        payments: [{ type: 'balance', amount: body.amount, currency: body.currency }],
        metadata: body.metadata,
      },
    });
    return { status, order: data };
  },

  async getOrder(orderId: string): Promise<DuffelOrder | null> {
    const { data } = await withRetry(() => request<DuffelOrder>('GET', `/air/orders/${encodeURIComponent(orderId)}`));
    return data;
  },

  /** Recent orders; used to find an order whose creation response we never received. */
  async listRecentOrders(): Promise<DuffelOrder[]> {
    const { data } = await withRetry(() => request<DuffelOrder[]>('GET', '/air/orders', { query: { limit: '50' } }));
    return data ?? [];
  },
};
