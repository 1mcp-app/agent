import { describe, expect, it, vi } from 'vitest';

import { ModernOutboundEraAdapter } from '../adapters/modern/modernOutboundEraAdapter.js';
import type { GatewayOperation, ImmutableJsonValue } from '../contracts/index.js';

describe('broker-owned modern rounds', () => {
  it.each(['tools/call', 'prompts/get', 'resources/read'] as const)(
    'mediates %s with fresh wire ids and exact state',
    async (operation: GatewayOperation) => {
      const frames: ImmutableJsonValue[] = [];
      const upstream = vi.fn(async (frame: ImmutableJsonValue) => {
        frames.push(frame);
        return frames.length === 1
          ? {
              resultType: 'input_required',
              requestState: 'opaque\u0000state',
              inputRequests: {
                root: { method: 'roots/list' },
                sample: { method: 'sampling/createMessage', params: { maxTokens: 1 } },
                form: { method: 'elicitation/create', params: { message: 'confirm' } },
              },
            }
          : { resultType: 'complete', content: [] };
      });
      const adapter = new ModernOutboundEraAdapter({
        revision: '2026-07-28',
        request: upstream,
        cancel: async () => undefined,
      });
      const interaction = vi.fn(async () => ({ answer: true }));
      await adapter.request(
        {
          requestId: 'one',
          operation,
          params: { name: 'tool' },
          authority: { connectionIds: ['one'], provenance: [] },
          deadlineUnixMs: Date.now() + 5000,
        },
        { interaction },
      );
      expect(interaction).toHaveBeenCalledTimes(3);
      expect(frames[1]).toMatchObject({
        requestId: 'one:round:1',
        requestState: 'opaque\u0000state',
        params: { name: 'tool' },
        inputResponses: { root: { answer: true }, sample: { answer: true }, form: { answer: true } },
      });
    },
  );

  it('does not retry after interaction or upstream uncertainty', async () => {
    const request = vi.fn(async () => ({
      resultType: 'input_required',
      inputRequests: { one: { method: 'roots/list' } },
    }));
    const adapter = new ModernOutboundEraAdapter({ revision: '2026-07-28', request, cancel: async () => undefined });
    await expect(
      adapter.request(
        {
          requestId: 'one',
          operation: 'tools/call',
          authority: { connectionIds: ['one'], provenance: [] },
          deadlineUnixMs: Date.now() + 5000,
        },
        {
          interaction: async () => {
            throw new Error('lost');
          },
        },
      ),
    ).rejects.toBeDefined();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('caps state-only rounds and refuses 33 inputs', async () => {
    const request = vi.fn(async () => ({ resultType: 'input_required', requestState: 'state' }));
    const adapter = new ModernOutboundEraAdapter({ revision: '2026-07-28', request, cancel: async () => undefined });
    await expect(
      adapter.request({
        requestId: 'one',
        operation: 'tools/call',
        authority: { connectionIds: ['one'], provenance: [] },
        deadlineUnixMs: Date.now() + 5000,
      }),
    ).rejects.toBeDefined();
    expect(request).toHaveBeenCalledTimes(4);
  });
});
