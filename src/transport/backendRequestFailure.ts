/**
 * Bounded, structured facts about a failed backend (MCP resource) request.
 *
 * Retry decisions must use affirmative transient evidence, not error prose. The category is
 * derived only from Node/undici error codes and HTTP statuses, so it never carries URLs,
 * credentials, response bodies or raw exception chains.
 */
export type BackendFailureCategory =
  | 'connection_refused'
  | 'connection_reset'
  | 'dns_temporary'
  | 'dns_not_found'
  | 'timeout'
  | 'tls'
  | 'aborted'
  | 'http_status'
  | 'unknown';

const TRANSIENT_CATEGORIES: ReadonlySet<BackendFailureCategory> = new Set([
  'connection_refused',
  'connection_reset',
  'dns_temporary',
  'timeout',
]);

/** HTTP statuses that mean "try again later" rather than "this backend is incompatible". */
export const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

const CODE_CATEGORIES: Readonly<Record<string, BackendFailureCategory>> = {
  ECONNREFUSED: 'connection_refused',
  ECONNRESET: 'connection_reset',
  EPIPE: 'connection_reset',
  UND_ERR_SOCKET: 'connection_reset',
  EAI_AGAIN: 'dns_temporary',
  ENOTFOUND: 'dns_not_found',
  ETIMEDOUT: 'timeout',
  UND_ERR_CONNECT_TIMEOUT: 'timeout',
  UND_ERR_HEADERS_TIMEOUT: 'timeout',
  ABORT_ERR: 'aborted',
};

const MAX_CAUSE_DEPTH = 5;

export class BackendRequestError extends Error {
  readonly category: BackendFailureCategory;
  readonly httpStatus?: number;

  constructor(category: BackendFailureCategory, httpStatus?: number) {
    const status = category === 'http_status' && httpStatus !== undefined ? ` (HTTP ${httpStatus})` : '';
    super(`Backend request failed: ${category}${status}. Check that the backend is running and reachable.`);
    this.name = 'BackendRequestError';
    this.category = category;
    if (category === 'http_status') this.httpStatus = httpStatus;
  }

  get transient(): boolean {
    if (this.category === 'http_status') return this.httpStatus !== undefined && isTransientHttpStatus(this.httpStatus);
    return TRANSIENT_CATEGORIES.has(this.category);
  }
}

export function isTransientHttpStatus(status: unknown): boolean {
  return typeof status === 'number' && TRANSIENT_HTTP_STATUSES.has(status);
}

function readCode(error: object): string | undefined {
  try {
    const code: unknown = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

function categoryForCode(code: string): BackendFailureCategory | undefined {
  if (code in CODE_CATEGORIES) return CODE_CATEGORIES[code];
  if (/CERT|SSL|TLS/.test(code)) return 'tls';
  return undefined;
}

function categorize(error: unknown, depth: number): BackendFailureCategory | undefined {
  if (depth > MAX_CAUSE_DEPTH || typeof error !== 'object' || error === null) return undefined;
  if (error instanceof BackendRequestError) return error.category;
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  const code = readCode(error);
  const own = code ? categoryForCode(code) : undefined;
  if (own) return own;
  // Happy-eyeballs connects report one error per address; only a uniform verdict is evidence.
  if (error instanceof AggregateError && error.errors.length > 0) {
    const categories = new Set(error.errors.map((item) => categorize(item, depth + 1) ?? 'unknown'));
    if (categories.size === 1) return [...categories][0];
    return categories.has('tls') ? 'tls' : 'unknown';
  }
  return error instanceof Error ? categorize(error.cause, depth + 1) : undefined;
}

/** Classify a failure raised by a backend request (Node http, undici fetch, or this module). */
export function classifyBackendFailure(error: unknown): BackendFailureCategory {
  return categorize(error, 0) ?? 'unknown';
}

/**
 * True only when the failure carries affirmative evidence of a transient condition. A failure
 * from native fetch is read from its structured cause chain; anything unrecognized is not.
 */
export function isTransientBackendFailure(error: unknown): boolean {
  if (error instanceof BackendRequestError) return error.transient;
  return TRANSIENT_CATEGORIES.has(classifyBackendFailure(error));
}

/** The MCP version negotiation probe is the only request where a 408/429 can be misread as era evidence. */
export function isNegotiationProbeRequest(method: string | undefined, body: unknown): boolean {
  if ((method ?? 'GET').toUpperCase() !== 'POST' || typeof body !== 'string' || body.length > 64 * 1024) return false;
  try {
    const message: unknown = JSON.parse(body);
    return (
      typeof message === 'object' &&
      message !== null &&
      !Array.isArray(message) &&
      (message as { method?: unknown }).method === 'server/discover'
    );
  } catch {
    return false;
  }
}
