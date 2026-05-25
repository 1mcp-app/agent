import { InboundConnectionConfig, ServerStatus } from '@src/core/types/index.js';
import {
  StreamableSessionLifecycle,
  StreamableSessionMissingReason,
  StreamableSessionRestoreErrorType,
  StreamableSessionStatus,
} from '@src/transport/http/streamableSessionLifecycle.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

function createMockTransport(sessionId: string) {
  return {
    sessionId,
    handleRequest: vi.fn().mockResolvedValue(undefined),
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((error: Error) => void) | undefined,
  };
}

function createMockRestorableTransport(sessionId: string) {
  return {
    ...createMockTransport(sessionId),
    markAsRestored: vi.fn(),
    isRestored: vi.fn(() => true),
  };
}

describe('StreamableSessionLifecycle', () => {
  let serverManager: {
    getTransport: ReturnType<typeof vi.fn>;
    connectTransport: ReturnType<typeof vi.fn>;
    disconnectTransport: ReturnType<typeof vi.fn>;
    getServer: ReturnType<typeof vi.fn>;
  };
  let sessionRepository: {
    get: ReturnType<typeof vi.fn>;
    getSessionData: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    updateAccess: ReturnType<typeof vi.fn>;
    storeInitializeResponse: ReturnType<typeof vi.fn>;
  };
  let lifecycle: StreamableSessionLifecycle;

  beforeEach(() => {
    serverManager = {
      getTransport: vi.fn(),
      connectTransport: vi.fn().mockResolvedValue(undefined),
      disconnectTransport: vi.fn().mockResolvedValue(undefined),
      getServer: vi.fn(),
    };
    sessionRepository = {
      get: vi.fn(),
      getSessionData: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      updateAccess: vi.fn(),
      storeInitializeResponse: vi.fn(),
    };
    lifecycle = new StreamableSessionLifecycle(serverManager as any, sessionRepository as any, undefined, {
      createTransport: createMockTransport as any,
      createRestorableTransport: createMockRestorableTransport as any,
      isStreamableTransport: ((transport: unknown) =>
        Boolean(
          transport && typeof (transport as ReturnType<typeof createMockTransport>).handleRequest === 'function',
        )) as any,
    });
  });

  it('returns an active session and records access when a streamable transport is already connected', async () => {
    const transport = createMockTransport('active-session');
    serverManager.getTransport.mockReturnValue(transport);

    const result = await lifecycle.resolveExistingSession('active-session');

    expect(result).toMatchObject({ status: StreamableSessionStatus.Active, sessionId: 'active-session', transport });
    expect(sessionRepository.updateAccess).toHaveBeenCalledWith('active-session');
  });

  it('restores a persisted session when no active transport exists', async () => {
    sessionRepository.getSessionData.mockReturnValue({
      initializeResponse: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'test', version: '1.0' },
      },
    });
    sessionRepository.get.mockReturnValue({ tags: ['restored'], enablePagination: false });
    serverManager.getServer.mockReturnValue({});

    const result = await lifecycle.resolveExistingSession('restored-session');

    expect(result.status).toBe(StreamableSessionStatus.Restored);
    expect(serverManager.connectTransport).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'restored-session' }),
      'restored-session',
      expect.objectContaining({ tags: ['restored'] }),
      undefined,
    );
    expect(sessionRepository.updateAccess).toHaveBeenCalledWith('restored-session');
  });

  it('returns structured restore failure when persisted session data cannot reconnect', async () => {
    sessionRepository.getSessionData.mockReturnValue({
      initializeResponse: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'test', version: '1.0' },
      },
    });
    sessionRepository.get.mockReturnValue({ tags: [], enablePagination: false });
    serverManager.connectTransport.mockRejectedValue(new Error('backend unavailable'));

    const result = await lifecycle.resolveExistingSession('broken-session');

    expect(result).toMatchObject({
      status: StreamableSessionStatus.Missing,
      sessionId: 'broken-session',
      reason: StreamableSessionMissingReason.RestoreFailed,
      restoreErrorType: StreamableSessionRestoreErrorType.ConnectionFailed,
      error: 'backend unavailable',
    });
  });

  it('recovers a missing POST session only for initialize requests', async () => {
    const config: InboundConnectionConfig = { tags: ['init'], enablePagination: false };

    const result = await lifecycle.resolvePostSession({
      sessionId: 'client-provided-session',
      isInitializeRequest: true,
      createSessionData: () => ({ config }),
    });

    expect(result.status).toBe(StreamableSessionStatus.InitializeRecovered);
    expect(sessionRepository.create).toHaveBeenCalledWith('client-provided-session', expect.objectContaining(config));
  });

  it('keeps non-initialize requests for missing sessions as missing', async () => {
    const result = await lifecycle.resolvePostSession({
      sessionId: 'missing-session',
      isInitializeRequest: false,
      createSessionData: () => ({ config: { tags: [], enablePagination: false } }),
    });

    expect(result).toMatchObject({
      status: StreamableSessionStatus.Missing,
      sessionId: 'missing-session',
      reason: StreamableSessionMissingReason.InitializeRequired,
    });
    expect(sessionRepository.create).not.toHaveBeenCalled();
  });

  it('canonicalizes stored and connected context to the actual transport session id', async () => {
    const context = {
      project: { name: 'project' },
      user: { username: 'tester' },
      environment: { variables: {} },
      sessionId: 'context-session',
      version: 'test',
      transport: { type: 'run' },
    };

    await lifecycle.createSession({ tags: ['new'], enablePagination: false }, context, 'transport-session');

    expect(serverManager.connectTransport).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'transport-session' }),
      'transport-session',
      expect.objectContaining({
        tags: ['new'],
        enablePagination: false,
        context: expect.objectContaining({ sessionId: 'transport-session' }),
      }),
      expect.objectContaining({ sessionId: 'transport-session' }),
    );
    expect(sessionRepository.create).toHaveBeenCalledWith(
      'transport-session',
      expect.objectContaining({
        context: expect.objectContaining({ sessionId: 'transport-session' }),
      }),
    );
    expect(context.sessionId).toBe('context-session');
  });

  it('reports persistence warnings without failing the connected session', async () => {
    sessionRepository.create.mockImplementation(() => {
      throw new Error('disk full');
    });

    const result = await lifecycle.createSession(
      { tags: ['new'], enablePagination: false },
      undefined,
      'memory-session',
    );

    expect(result).toMatchObject({
      status: StreamableSessionStatus.Created,
      sessionId: 'memory-session',
      persisted: false,
      persistenceError: 'disk full',
    });
    expect(serverManager.connectTransport).toHaveBeenCalled();
  });

  it('records initialize responses for later restoration', () => {
    lifecycle.storeInitializeResponse('initialized-session', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      serverInfo: { name: '1mcp', version: '0.0.0' },
    });

    expect(sessionRepository.storeInitializeResponse).toHaveBeenCalledWith('initialized-session', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      serverInfo: { name: '1mcp', version: '0.0.0' },
    });
  });

  it('cleans transport membership on abnormal disconnect without deleting persisted session state', async () => {
    await lifecycle.handleAbnormalDisconnect('stream-session');

    expect(serverManager.disconnectTransport).toHaveBeenCalledWith('stream-session');
    expect(sessionRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes persisted state and disconnects transport membership on explicit delete', async () => {
    await lifecycle.completeExplicitDelete('delete-session');

    expect(sessionRepository.delete).toHaveBeenCalledWith('delete-session');
    expect(serverManager.disconnectTransport).toHaveBeenCalledWith('delete-session', true);
  });

  it('marks the inbound server errored when a streamable transport reports an error', async () => {
    const server = { status: ServerStatus.Connected, lastError: undefined as Error | undefined };
    serverManager.getServer.mockReturnValue(server);

    const result = await lifecycle.createSession({ tags: [], enablePagination: false }, undefined, 'error-session');
    const error = new Error('transport failed');
    result.transport.onerror?.(error);

    expect(server.status).toBe(ServerStatus.Error);
    expect(server.lastError).toBe(error);
  });
});
