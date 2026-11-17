import { describe, expect, it } from 'vitest';

import {
  BackendRequestError,
  classifyBackendFailure,
  isNegotiationProbeRequest,
  isTransientBackendFailure,
  isTransientHttpStatus,
} from './backendRequestFailure.js';

const withCode = (code: string, message = 'fixture') => Object.assign(new Error(message), { code });
const fetchFailure = (cause: unknown) => new TypeError('fetch failed', { cause });

describe('backend request failure classification', () => {
  it.each([
    ['ECONNREFUSED', 'connection_refused', true],
    ['ECONNRESET', 'connection_reset', true],
    ['EPIPE', 'connection_reset', true],
    ['UND_ERR_SOCKET', 'connection_reset', true],
    ['EAI_AGAIN', 'dns_temporary', true],
    ['ETIMEDOUT', 'timeout', true],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout', true],
    ['UND_ERR_HEADERS_TIMEOUT', 'timeout', true],
    ['ENOTFOUND', 'dns_not_found', false],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls', false],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'tls', false],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls', false],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'tls', false],
    ['ABORT_ERR', 'aborted', false],
    ['ESOMETHINGELSE', 'unknown', false],
  ] as const)('reads %s from a native fetch cause chain as %s', (code, category, transient) => {
    const error = fetchFailure(withCode(code));
    expect(classifyBackendFailure(error)).toBe(category);
    expect(isTransientBackendFailure(error)).toBe(transient);
  });

  it('does not treat a bare fetch TypeError or error prose as transient evidence', () => {
    expect(isTransientBackendFailure(new TypeError('fetch failed'))).toBe(false);
    expect(isTransientBackendFailure(new Error('connect ECONNREFUSED 127.0.0.1:1'))).toBe(false);
    expect(
      isTransientBackendFailure(new Error('OAuth network: network_failure. Check provider reachability and DNS.')),
    ).toBe(false);
    expect(isTransientBackendFailure(undefined)).toBe(false);
  });

  it('treats an AbortError as aborted even when its cause is transient', () => {
    const error = Object.assign(new Error('aborted', { cause: withCode('ECONNRESET') }), { name: 'AbortError' });
    expect(classifyBackendFailure(error)).toBe('aborted');
  });

  it('uses a uniform verdict from happy-eyeballs aggregate errors and lets TLS win a mixed one', () => {
    expect(classifyBackendFailure(new AggregateError([withCode('ECONNREFUSED'), withCode('ECONNREFUSED')]))).toBe(
      'connection_refused',
    );
    expect(classifyBackendFailure(new AggregateError([withCode('ECONNREFUSED'), withCode('ETIMEDOUT')]))).toBe(
      'unknown',
    );
    expect(classifyBackendFailure(new AggregateError([withCode('ECONNREFUSED'), withCode('CERT_HAS_EXPIRED')]))).toBe(
      'tls',
    );
  });

  it('stops walking a cyclic or deep cause chain', () => {
    const cyclic: Error & { cause?: unknown } = new Error('loop');
    cyclic.cause = cyclic;
    expect(classifyBackendFailure(cyclic)).toBe('unknown');
  });

  it('accepts exactly the transient HTTP statuses', () => {
    expect([408, 429, 500, 502, 503, 504].every(isTransientHttpStatus)).toBe(true);
    expect([400, 401, 403, 404, 409, 501, 505, 599].some(isTransientHttpStatus)).toBe(false);
    expect(new BackendRequestError('http_status', 503).transient).toBe(true);
    expect(new BackendRequestError('http_status', 501).transient).toBe(false);
  });

  it('carries only the bounded category, never the raw failure', () => {
    const error = new BackendRequestError('connection_refused');
    expect(error.message).toBe(
      'Backend request failed: connection_refused. Check that the backend is running and reachable.',
    );
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error).sort()).toEqual(['category', 'httpStatus', 'name']);
    expect(error.httpStatus).toBeUndefined();
    expect(new BackendRequestError('http_status', 429).message).toContain('(HTTP 429)');
  });

  it('recognizes only the server/discover negotiation probe', () => {
    const body = (method: string) => JSON.stringify({ jsonrpc: '2.0', id: 1, method });
    expect(isNegotiationProbeRequest('POST', body('server/discover'))).toBe(true);
    expect(isNegotiationProbeRequest('post', body('server/discover'))).toBe(true);
    expect(isNegotiationProbeRequest('POST', body('tools/call'))).toBe(false);
    expect(isNegotiationProbeRequest('GET', body('server/discover'))).toBe(false);
    expect(isNegotiationProbeRequest('POST', '[' + body('server/discover') + ']')).toBe(false);
    expect(isNegotiationProbeRequest('POST', 'not json')).toBe(false);
    expect(isNegotiationProbeRequest('POST', undefined)).toBe(false);
  });
});
