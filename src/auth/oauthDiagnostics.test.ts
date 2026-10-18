import { describe, expect, it, vi } from 'vitest';

import { oauthDiagnosticMessage, readOAuthDiagnostic, safeOAuthDiagnosticMessage } from './oauthDiagnostics.js';

describe('OAuth diagnostic admission', () => {
  it('admits the existing constant authority failure without exposing arbitrary error messages', () => {
    expect(
      safeOAuthDiagnosticMessage(
        new Error('OAuth authority or authorization attempt is no longer valid; start authorization again'),
      ),
    ).toBe(oauthDiagnosticMessage('authority_mismatch'));
    expect(safeOAuthDiagnosticMessage(new Error('sensitive-sentinel'))).toBeUndefined();
  });
  it.each([400, 403, 404, 599])('round-trips bounded metadata HTTP status %s', (status) => {
    expect(readOAuthDiagnostic(oauthDiagnosticMessage('metadata_http_error', status))).toEqual({
      stage: 'metadata',
      reason: 'metadata_http_error',
      httpStatus: status,
      guidance: 'Check provider metadata availability and access policy.',
    });
  });

  it('rejects arbitrary provider text, appended secrets and invalid statuses without invoking error accessors', () => {
    const getter = vi.fn(() => {
      throw new Error('sensitive-sentinel');
    });
    const error = Object.defineProperty({}, 'message', { get: getter });
    expect(safeOAuthDiagnosticMessage(error)).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    for (const value of [
      'sensitive-sentinel',
      oauthDiagnosticMessage('network_failure') + '?token=secret',
      'OAuth metadata: metadata_http_error (HTTP 999). Check provider metadata availability and access policy.',
    ]) {
      expect(readOAuthDiagnostic(value)).toBeUndefined();
    }
  });
});
