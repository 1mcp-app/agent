import { getActiveTraceCorrelation, withMcpTraceContext } from '@src/observability/tracing/context.js';

import { describe, expect, it, vi } from 'vitest';

import { ModernOutboundEraAdapter } from '../adapters/modern/modernOutboundEraAdapter.js';
import type { GatewayOperation, ImmutableJsonValue } from '../contracts/index.js';

describe('broker-owned modern rounds', () => {
  it('forwards initial driver material only on the first frame and replaces it with actual round replies', async () => {
    const frames: ImmutableJsonValue[] = [];
    const adapter = new ModernOutboundEraAdapter({
      revision: '2026-07-28',
      request: async (frame) => {
        frames.push(frame);
        if (frames.length === 1)
          return {
            resultType: 'input_required',
            requestState: 'owned-state',
            inputRequests: { root: { method: 'roots/list' } },
          };
        return { resultType: 'complete', content: [] };
      },
      cancel: async () => undefined,
    });
    await adapter.request(
      {
        requestId: 'initial-driver',
        operation: 'tools/call',
        params: { name: 'raw', arguments: { original: true } },
        authority: { connectionIds: ['one'], provenance: [] },
        deadlineUnixMs: Date.now() + 5000,
      },
      { initialInputResponses: { unknown: { untouched: true } }, interaction: async () => ({ roots: [] }) },
    );
    expect(frames[0]).toMatchObject({
      inputResponses: { unknown: { untouched: true } },
      params: { name: 'raw', arguments: { original: true } },
    });
    expect(frames[0]).not.toHaveProperty('requestState');
    expect(frames[1]).toMatchObject({
      inputResponses: { root: { roots: [] } },
      requestState: 'owned-state',
      params: { name: 'raw', arguments: { original: true } },
    });
    expect(frames[1]).not.toHaveProperty('inputResponses.unknown');
    expect(frames).toHaveLength(2);
  });

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

  it.each([false, true])('honors input remote context without changing the owner (round=%s)', async (round) => {
    const owner = '00-11111111111111111111111111111111-2222222222222222-01';
    const remote = '00-33333333333333333333333333333333-4444444444444444-01';
    const upstream = vi.fn(async () => {
      expect(getActiveTraceCorrelation()?.trace_id).toBe('11111111111111111111111111111111');
      return upstream.mock.calls.length === 1
        ? {
            resultType: 'input_required',
            inputRequests: {
              root: { method: 'roots/list', params: { _meta: { traceparent: remote, baggage: 'private' } } },
            },
          }
        : { resultType: 'complete', content: [] };
    });
    const adapter = new ModernOutboundEraAdapter({
      revision: '2026-07-28',
      request: upstream,
      cancel: async () => undefined,
    });
    await withMcpTraceContext({ _meta: { traceparent: owner } }, () =>
      adapter.request(
        {
          requestId: 'remote-parent',
          operation: 'tools/call',
          authority: { connectionIds: ['one'], provenance: [] },
          deadlineUnixMs: Date.now() + 5000,
        },
        round
          ? {
              interactionRound: async (inputs) => {
                expect(inputs.root.params).toEqual({ _meta: { traceparent: remote } });
                expect(getActiveTraceCorrelation()?.trace_id).toBe('11111111111111111111111111111111');
                return { root: { roots: [] } };
              },
            }
          : {
              interaction: async (input) => {
                expect(input.params).toEqual({ _meta: { traceparent: remote } });
                expect(getActiveTraceCorrelation()?.trace_id).toBe('33333333333333333333333333333333');
                return { roots: [] };
              },
            },
      ),
    );
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(getActiveTraceCorrelation()).toBeUndefined();
  });

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
