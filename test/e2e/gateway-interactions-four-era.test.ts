import { describe, expect, it } from 'vitest';

import { runGatewayInteractionCell } from './fixtures/gatewayInteractionMatrix.js';

const traceparent = '00-12345678901234567890123456789012-1234567890123456-01';
function expectTrace(params: unknown, label = '') {
  const meta = (params as { _meta?: Record<string, unknown> } | undefined)?._meta;
  expect(meta?.traceparent, label).toBe(traceparent);
  expect(meta?.tracestate).toBe('vendor=opaque');
  expect(meta).not.toHaveProperty('baggage');
  expect(meta).not.toHaveProperty('contextProof');
}

describe('real gateway interaction peers across protocol eras', () => {
  it.each([
    ['legacy', 'legacy', 1],
    ['legacy', 'modern', 1],
    ['modern', 'legacy', 1],
    ['modern', 'modern', 1],
    ['modern', 'modern', 32],
    ['legacy', 'modern', 32],
  ] as const)(
    'routes Roots, Sampling and Elicitation for all eligible methods: %s inbound / %s upstream / %i inputs',
    (inboundEra, upstreamEra, inputCount) =>
      runGatewayInteractionCell(inboundEra, upstreamEra, inputCount, expectTrace),
  );
});
