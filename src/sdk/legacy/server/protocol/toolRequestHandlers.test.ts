import { createMockLegacyInboundConnection, createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import logger, * as loggerModule from '@src/logger/logger.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { SchemaBoundaryError } from '@src/core/validation/schemaBoundary.js';
import type { LocalDiagnosticRecord } from '@src/logger/localDiagnostics.js';
import { ErrorCode, OneMcpProtocolError } from '@src/sdk/contracts/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerToolHandlers } from './toolRequestHandlers.js';

vi.mock('@src/config/configuredServerTargets.js', () => ({ getConfiguredServerTargets: () => ({}) }));
vi.mock('@src/core/capabilities/runtimeCapabilityCatalog.js', () => ({ acquireRuntimeCapabilityCatalog: vi.fn() }));
vi.mock('@src/core/capabilities/internalCapabilitiesProvider.js', () => ({
  InternalCapabilitiesProvider: {
    getInstance: () => ({ initialize: async () => undefined, getAvailableTools: () => [], executeTool: vi.fn() }),
  },
}));
vi.mock('@src/core/protocol/requestHandlerUtils.js', () => ({
  getRequestSession: () => undefined,
  resolveCapabilityVisibility: () => ({ serverCandidates: new Map([['backend:private-rendered-hash', 'backend']]) }),
  resolveLazyCapabilityVisibility: () => ({ serverCandidates: new Map() }),
}));
vi.mock('./privateInteractionConnection.js', () => ({
  withPrivateInteractionConnection: async (
    connection: unknown,
    _inbound: unknown,
    _extra: unknown,
    _entry: unknown,
    operation: (selected: unknown) => Promise<unknown>,
  ) => operation(connection),
}));

describe('normal tool request local diagnostics', () => {
  type Handler = (
    request: { params: { name: string; arguments?: Record<string, unknown> } },
    extra: { signal: AbortSignal },
  ) => Promise<unknown>;
  let handler: Handler;
  let request: ReturnType<typeof vi.fn>;
  let validateOutput: ReturnType<typeof vi.fn>;
  let prepare: ReturnType<typeof vi.fn>;
  let records: LocalDiagnosticRecord[];
  let previousLevel: string;

  beforeEach(() => {
    records = [];
    previousLevel = logger.level;
    logger.level = 'debug';
    vi.spyOn(loggerModule, 'writeLocalDiagnosticRecord').mockImplementation((record) => {
      records.push(record);
    });
    request = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const connection = createMockOutboundConnection({ name: 'backend', requestTimeoutMs: 1500, adapter: { request } });
    validateOutput = Object.assign(vi.fn().mockResolvedValue(undefined), { assertCurrent: vi.fn() });
    prepare = vi.fn().mockResolvedValue(validateOutput);
    const route = {
      kind: 'tools',
      origin: 'external',
      server: 'backend',
      upstreamIdentity: 'read_file',
      connectionKey: 'backend:private-rendered-hash',
    };
    const entry = { route, sourceObject: { name: 'read_file', inputSchema: { type: 'object' } } };
    vi.mocked(acquireRuntimeCapabilityCatalog).mockResolvedValue({
      resolve: () => ({ entry, connection }),
      prepareToolCall: prepare,
      isCurrent: () => true,
    } as never);
    const handlers: Handler[] = [];
    const inbound = createMockLegacyInboundConnection({
      server: {
        setRequestHandler: vi.fn((_schema, callback) => {
          handlers.push(callback);
        }),
      } as never,
    });
    registerToolHandlers(new Map([['backend:private-rendered-hash', connection]]), inbound);
    handler = handlers[1];
  });

  afterEach(() => {
    logger.level = previousLevel;
    vi.restoreAllMocks();
  });

  function details(event: string) {
    return records.filter((record) => record.event === event).map((record) => JSON.parse(record.details));
  }

  function call(args: Record<string, unknown> = {}, controller = new AbortController()) {
    return handler({ params: { name: 'backend_1mcp_read_file', arguments: args } }, { signal: controller.signal });
  }

  it('records public and resolved names, timeout and duration without exposing composite keys or credentials', async () => {
    const result = { content: [{ type: 'text', text: 'ok' }], token: 'private-result' };
    request.mockResolvedValueOnce(result);
    await expect(call({ query: 'weather', apiKey: 'private-input' })).resolves.toMatchObject({
      content: result.content,
    });

    expect(details('tool.routed')).toEqual([
      expect.objectContaining({
        requestedTool: 'backend_1mcp_read_file',
        server: 'backend',
        tool: 'read_file',
        timeoutMs: 1500,
        callId: expect.any(String),
      }),
    ]);
    expect(details('tool.completed')).toEqual([
      expect.objectContaining({ outcome: 'success', durationMs: expect.any(Number) }),
    ]);
    expect(details('tool.arguments')[0].arguments.query).toBe('weather');
    expect(details('tool.result')).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain('private-input');
    expect(JSON.stringify(records)).not.toContain('private-result');
    expect(JSON.stringify(records)).not.toContain('private-rendered-hash');
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'tools/call',
        params: { name: 'read_file', arguments: { query: 'weather', apiKey: 'private-input' } },
        timeoutMs: 1500,
      }),
    );
  });

  it.each([
    ['failed', new Error('upstream socket closed')],
    ['timeout', new OneMcpProtocolError(ErrorCode.RequestTimeout, 'upstream timed out')],
  ])('records actual %s errors without changing protocol failure handling', async (outcome, error) => {
    request.mockRejectedValueOnce(error);
    await expect(call()).rejects.toThrow('Error calling tool');
    expect(details('tool.failed')).toEqual([
      expect.objectContaining({
        phase: 'upstream',
        outcome,
        error: expect.objectContaining({ message: error.message }),
      }),
    ]);
    expect(details('tool.failure-details')).toHaveLength(1);
    expect(details('tool.completed')).toHaveLength(0);
  });

  it('records input rejection before invoking the backend', async () => {
    prepare.mockRejectedValueOnce(new SchemaBoundaryError('schema_input_invalid', false, 'input'));
    await expect(call()).resolves.toMatchObject({ isError: true });
    expect(request).not.toHaveBeenCalled();
    expect(details('tool.failed')).toEqual([
      expect.objectContaining({ phase: 'input_validation', outcome: 'validation_failed' }),
    ]);
  });

  it('records output validation failure after the backend returns', async () => {
    validateOutput.mockRejectedValueOnce(new SchemaBoundaryError('schema_output_invalid', false, 'output'));
    await expect(call()).rejects.toThrow('schema_output_invalid');
    expect(details('tool.failed')).toEqual([
      expect.objectContaining({ phase: 'output_validation', outcome: 'validation_failed' }),
    ]);
    expect(details('tool.completed')).toHaveLength(0);
  });

  it('records cancellation during dispatch', async () => {
    const controller = new AbortController();
    request.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('Request cancelled');
    });
    await expect(call({}, controller)).rejects.toThrow('Error calling tool');
    expect(details('tool.failed')).toEqual([expect.objectContaining({ phase: 'upstream', outcome: 'cancelled' })]);
  });

  it('does no body capture when debug is disabled and ignores diagnostic sink failures', async () => {
    logger.level = 'info';
    vi.mocked(loggerModule.writeLocalDiagnosticRecord).mockImplementation(() => {
      throw new Error('sink unavailable');
    });
    await expect(call({ apiKey: 'private-input' })).resolves.toMatchObject({ content: [{ type: 'text', text: 'ok' }] });
    expect(vi.mocked(loggerModule.writeLocalDiagnosticRecord).mock.calls.map(([record]) => record.event)).not.toContain(
      'tool.arguments',
    );
    expect(vi.mocked(loggerModule.writeLocalDiagnosticRecord).mock.calls.map(([record]) => record.event)).not.toContain(
      'tool.result',
    );
  });
});
