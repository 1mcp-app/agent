import { describe, expect, it } from 'vitest';

import { telemetryErrorOutcome, telemetryFailureFacts, telemetryResultOutcome } from './telemetryOutcome.js';

describe('protocol telemetry outcomes', () => {
  it('classifies Tool errors and RPC errors returned without throwing', () => {
    expect(telemetryResultOutcome({ isError: true })).toBe('tool-error');
    expect(telemetryResultOutcome({ jsonrpc: '2.0', error: { code: -32602 } })).toBe('caller-error');
    expect(telemetryResultOutcome({ jsonrpc: '2.0', error: { code: -32603 } })).toBe('upstream-error');
    expect(telemetryResultOutcome({ result: { isError: true } })).toBe('tool-error');
  });
  it('keeps caller denial and cancellation distinct from serving failures', () => {
    expect(telemetryErrorOutcome({ kind: 'authorization', message: 'secret' })).toBe('denied');
    expect(telemetryErrorOutcome({ kind: 'cancelled' })).toBe('cancelled');
    expect(telemetryErrorOutcome({ code: -32601 })).toBe('not-found');
    expect(telemetryErrorOutcome({ kind: 'transport' })).toBe('transport-error');
    expect(telemetryErrorOutcome(new Error('secret'))).toBe('internal-error');
  });
});

it('normalizes failure facts without exporting arbitrary codes or messages', () => {
  expect(
    telemetryFailureFacts({ kind: 'transport', code: 'private-provider-code', message: 'private-message' }),
  ).toEqual({ outcome: 'transport-error', failureKind: 'transport', failureCode: 'other' });
  expect(telemetryFailureFacts({ kind: 'transport', code: 'gateway_overloaded' })).toEqual({
    outcome: 'transport-error',
    failureKind: 'transport',
    failureCode: 'gateway_overloaded',
  });
});
