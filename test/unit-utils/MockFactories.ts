import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  ClientStatus,
  InboundConnection,
  OutboundConnection,
  OutboundConnections,
  ServerStatus,
} from '@src/../src/core/types/index.js';
import { ClientSessionData } from '@src/auth/sessionTypes.js';
import type { ClientSurfaceAttachmentContext } from '@src/commands/shared/clientSurfaceAttachment.js';
import type { InspectServerSummary } from '@src/commands/shared/inspectApiSchemas.js';
import type { CliSessionCache } from '@src/commands/shared/serveClient.js';
import type { ResolvableServeTargetOptions } from '@src/commands/shared/serveTargetResolver.js';
import type { BackendLogEntry, BackendLogSource } from '@src/domains/backend-logs/backendLogTypes.js';
import type { LegacyConnectionId, LegacySdkAdapter } from '@src/sdk/contracts/index.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { LegacySdkServerAdapter } from '@src/sdk/legacy/server/runtime/legacySdkServerAdapter.js';

import { vi } from 'vitest';

/**
 * Factory for creating mock logger instances
 */
export const createMockLogger = () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

/**
 * Factory for creating mock MCP transport instances
 */
export const createMockTransport = (overrides?: Partial<Transport>): Transport =>
  ({
    name: 'test-transport',
    start: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as Transport;

/**
 * Factory for creating mock MCP client instances
 */
export const createMockClient = (overrides?: Partial<Client>): Partial<Client> => ({
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  request: vi.fn().mockResolvedValue({}),
  notification: vi.fn().mockResolvedValue(undefined),
  setRequestHandler: vi.fn(),
  setNotificationHandler: vi.fn(),
  ...overrides,
});

/**
 * Factory for creating mock MCP server instances
 */
export const createMockServer = (overrides?: Partial<Server>): Partial<Server> => ({
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  request: vi.fn().mockResolvedValue({}),
  notification: vi.fn().mockResolvedValue(undefined),
  setRequestHandler: vi.fn(),
  setNotificationHandler: vi.fn(),
  ...overrides,
});

/**
 * Factory for creating mock client status objects
 */
export const createMockClientStatus = (
  overrides?: Partial<{ status: string; lastSeen: Date; errorCount: number }>,
): { status: string; lastSeen: Date; errorCount: number } => ({
  status: 'connected',
  lastSeen: new Date(),
  errorCount: 0,
  ...overrides,
});

/**
 * Factory for creating mock outbound connections
 */
export const createMockOutboundConnections = (
  connections?: Record<string, OutboundConnection>,
): OutboundConnections => {
  const map = new Map<string, OutboundConnection>();
  if (connections) {
    Object.entries(connections).forEach(([key, value]) => {
      map.set(key, value);
    });
  }
  return map;
};

export type MockOutboundConnectionOverrides = Omit<Partial<OutboundConnection>, 'adapter'> & {
  adapter?: Partial<LegacySdkAdapter>;
};

/**
 * Factory for the SDK-free adapter contract used by shared-code tests.
 */
export const createMockLegacySdkAdapter = (overrides: Partial<LegacySdkAdapter> = {}): LegacySdkAdapter => ({
  connectionId: 'mock-legacy-connection' as LegacyConnectionId,
  state: 'running',
  start: vi.fn().mockResolvedValue(undefined),
  nextEvent: vi.fn().mockResolvedValue({ type: 'closed' }),
  respond: vi.fn().mockResolvedValue(undefined),
  request: vi.fn().mockResolvedValue({}),
  cancel: vi.fn().mockResolvedValue(undefined),
  notify: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

/**
 * Factory for creating a mock outbound connection
 */
export const createMockOutboundConnection = (overrides: MockOutboundConnectionOverrides = {}): OutboundConnection => {
  const { adapter, ...snapshotOverrides } = overrides;
  return {
    name: 'test-server',
    adapter: createMockLegacySdkAdapter(adapter),
    tags: [],
    requiresOAuth: false,
    status: ClientStatus.Connected,
    lastConnected: new Date(0).toISOString(),
    ...snapshotOverrides,
  };
};

/**
 * Factory for creating mock inbound connections
 */
export type MockInboundConnectionOverrides = Omit<Partial<InboundConnection>, 'adapter'> & {
  adapter?: Partial<InboundConnection['adapter']>;
};

export const createMockInboundConnection = (overrides: MockInboundConnectionOverrides = {}): InboundConnection => {
  const { adapter, ...snapshotOverrides } = overrides;
  return {
    connectionId: 'mock-inbound' as InboundConnection['connectionId'],
    adapter: createMockLegacySdkAdapter({
      connectionId: 'mock-inbound' as InboundConnection['connectionId'],
      ...adapter,
    }),
    status: ServerStatus.Connected,
    tags: ['test'],
    enablePagination: false,
    ...snapshotOverrides,
  };
};

/** Build a connection backed by hidden v1 client and transport handles for legacy-island tests. */
export const createMockLegacyOutboundConnection = (
  overrides: Omit<Partial<OutboundConnection>, 'adapter' | 'supervision'> & {
    client?: Client;
    transport?: AuthProviderTransport;
  } = {},
): OutboundConnection => {
  const {
    client = createMockClient() as Client,
    transport = createMockTransport() as AuthProviderTransport,
    name = 'test-server',
    status = ClientStatus.Connected,
    lastError,
    lastConnected,
    capabilities,
    instructions,
    authorizationUrl,
    oauthStartTime,
  } = overrides;
  const mutableClient = client as unknown as Record<string, unknown>;
  if (typeof mutableClient.setNotificationHandler !== 'function') {
    mutableClient.setNotificationHandler = vi.fn();
  }
  if (typeof mutableClient.close !== 'function') {
    mutableClient.close = vi.fn().mockResolvedValue(undefined);
  }
  return createLegacyOutboundConnection({
    name,
    client,
    transport,
    status,
    ...(lastError ? { lastError } : {}),
    ...(lastConnected ? { lastConnected: new Date(lastConnected) } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(instructions === undefined ? {} : { instructions }),
    ...(authorizationUrl === undefined ? {} : { authorizationUrl }),
    ...(oauthStartTime ? { oauthStartTime: new Date(oauthStartTime) } : {}),
  });
};

/** Build an inbound snapshot backed by hidden v1 server and transport handles. */
export const createMockLegacyInboundConnection = (
  overrides: Omit<Partial<InboundConnection>, 'adapter'> & {
    server?: Server;
    transport?: Transport;
  } = {},
): InboundConnection => {
  const { server: serverOverride, transport: transportOverride, ...snapshotOverrides } = overrides;
  const connectionId = snapshotOverrides.connectionId ?? ('mock-legacy-inbound' as LegacyConnectionId);
  const server = serverOverride ?? (createMockServer() as Server);
  const transport = transportOverride ?? createMockTransport();
  return {
    connectionId,
    adapter: new LegacySdkServerAdapter(connectionId, server, transport),
    status: ServerStatus.Connected,
    tags: ['test'],
    enablePagination: false,
    ...snapshotOverrides,
  };
};

/**
 * Factory for creating mock client session data
 */
export const createMockClientSessionData = (overrides?: Partial<ClientSessionData>): ClientSessionData => ({
  serverName: 'test-server',
  clientInfo: JSON.stringify({
    client_id: 'test-client-123',
    client_secret: 'secret-value',
    redirect_uris: ['https://app.com/callback'],
  }),
  tokens: JSON.stringify({
    access_token: 'access-token-123',
    refresh_token: 'refresh-token-456',
    token_type: 'Bearer',
    expires_in: 3600,
  }),
  createdAt: Date.now(),
  expires: Date.now() + 3600000,
  ...overrides,
});

export function createMockCliSessionCache(overrides?: Partial<CliSessionCache>): CliSessionCache {
  return {
    sessionId: 'cached-session',
    serverUrl: 'http://127.0.0.1:3050/mcp',
    contextHash: 'hash-from-port',
    savedAt: 1000,
    hasRestEndpoint: true,
    ...overrides,
  };
}

export function createMockClientSurfaceAttachmentContext<TOptions extends ResolvableServeTargetOptions>(
  overrides: Partial<ClientSurfaceAttachmentContext<TOptions>> = {},
): ClientSurfaceAttachmentContext<TOptions> {
  const options = (overrides.options ?? {}) as TOptions;
  return {
    target: {
      cwd: '/tmp/project',
      projectRoot: '/tmp/project',
      projectConfig: null,
      mergedOptions: options,
      discoveredUrl: 'http://127.0.0.1:3050/mcp',
      serverUrl: new URL('http://127.0.0.1:3050/mcp'),
      source: 'user',
    },
    options,
    baseUrl: 'http://127.0.0.1:3050',
    serverUrl: new URL('http://127.0.0.1:3050/mcp'),
    context: {
      project: { path: '/tmp/project', cwd: '/tmp/project', name: 'project' },
      user: {},
      environment: {},
    },
    contextHash: 'attachment-test',
    cachePath: '/tmp/attachment-test',
    cachedSession: null,
    requestSessionId: 'attachment-session',
    sessionId: 'attachment-session',
    ...overrides,
  };
}

export function createMockInspectServerSummary(overrides?: Partial<InspectServerSummary>): InspectServerSummary {
  return {
    server: 'test-server',
    type: 'external',
    status: 'connected',
    available: true,
    loadTracked: true,
    ...overrides,
  };
}

export function createMockBackendLogSource(overrides: Partial<BackendLogSource> = {}): BackendLogSource {
  return {
    id: 'static:filesystem',
    canonicalName: 'filesystem',
    displayName: 'filesystem',
    kind: 'static',
    capture: 'managed',
    lifecycle: 'active',
    ...overrides,
  };
}

export function createMockBackendLogEntry(overrides: Partial<BackendLogEntry> = {}): BackendLogEntry {
  return {
    sequence: 1,
    timestamp: '2026-08-02T00:00:00.000Z',
    sourceId: 'static:filesystem',
    canonicalName: 'filesystem',
    displayName: 'filesystem',
    sourceKind: 'static',
    kind: 'line',
    content: 'backend log entry',
    truncated: false,
    ...overrides,
  };
}

/**
 * Factory for creating mock Express request objects
 */
export const createMockExpressRequest = (overrides?: any) => ({
  params: {},
  query: {},
  body: {},
  headers: {},
  method: 'GET',
  url: '/',
  ...overrides,
});

/**
 * Factory for creating mock Express response objects
 */
export const createMockExpressResponse = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  };
  return res;
};

/** Factory for the runtime-scope ownership module used by serve command tests. */
export function createRuntimeScopeOwnershipMock() {
  return {
    claimRuntimeScope: vi.fn(() => ({
      record: { claimId: 'test-claim' },
      release: vi.fn(),
    })),
    verifyRuntimeScopeOwnership: vi.fn(),
    RuntimeScopeOwnedError: class RuntimeScopeOwnedError extends Error {},
  };
}

/**
 * Factory for creating mock configuration objects
 */
export const createMockConfig = (overrides?: any) => ({
  servers: [
    {
      name: 'test-server',
      command: 'node',
      args: ['test-server.js'],
      cwd: '/tmp',
      env: {},
    },
  ],
  transports: {
    stdio: { enabled: true },
    http: { enabled: false },
    sse: { enabled: false },
  },
  auth: {
    enabled: false,
    providers: {},
  },
  ...overrides,
});
