import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  InboundConnection,
  OutboundConnection,
  OutboundConnections,
  ServerStatus,
} from '@src/../src/core/types/index.js';
import { ClientSessionData } from '@src/auth/sessionTypes.js';

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

/**
 * Factory for creating mock inbound connections
 */
export const createMockInboundConnection = (overrides?: Partial<InboundConnection>): InboundConnection => ({
  server: createMockServer() as Server,
  status: ServerStatus.Connected,
  tags: ['test'],
  enablePagination: false,
  ...overrides,
});

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
