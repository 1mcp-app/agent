import { Writable } from 'node:stream';

import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

import { CONNECTION_RETRY } from '@src/constants.js';
import { ClientStatus } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { NonRetryableClientConnectionError } from '@src/utils/core/errorTypes.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import winston from 'winston';

import { ClientManager } from './clientManager.js';
import { ConnectionHandler } from './connectionHandler.js';
import type { AuthProviderTransport } from './legacyTransport.js';
import { OAuthFlowHandler } from './oauthFlowHandler.js';
import { OAuthRequiredError } from './types.js';

const factoryState = vi.hoisted(() => ({ client: undefined as unknown as Client }));
vi.mock('./clientFactory.js', () => ({
  ClientFactory: class {
    createClient() {
      return factoryState.client;
    }
  },
}));
vi.mock('@src/core/capabilities/capabilityPagination.js', () => ({
  registerCapabilityPaginationNotifications: vi.fn(),
}));

function makeClient(): Client {
  const client = new Client({ name: 'diagnostic-test', version: '1' });
  vi.spyOn(client, 'connect').mockResolvedValue(undefined);
  vi.spyOn(client, 'close').mockResolvedValue(undefined);
  vi.spyOn(client, 'getServerVersion').mockReturnValue({ name: 'search-backend', version: '2.4' });
  vi.spyOn(client, 'getServerCapabilities').mockReturnValue({ tools: {} });
  vi.spyOn(client, 'getInstructions').mockReturnValue(undefined);
  return client;
}

function makeTransport(): AuthProviderTransport & StreamableHTTPClientTransport {
  const transport = new StreamableHTTPClientTransport(new URL('https://example.invalid/mcp'));
  vi.spyOn(transport, 'close').mockResolvedValue(undefined);
  return Object.assign(transport, { connectionTimeout: 4321, requestTimeout: 8765 });
}

describe('backend and OAuth local diagnostics', () => {
  let entries: Array<Record<string, unknown>>;
  function details(event: string): Record<string, unknown> {
    const entry = entries.find((item) => item.source === 'local-diagnostic' && item.message === event);
    expect(entry, event).toBeDefined();
    return JSON.parse(entry!.details as string);
  }

  beforeEach(() => {
    ClientManager.resetInstance();
    factoryState.client = makeClient();
    entries = [];
    logger.clear();
    logger.level = 'debug';
    logger.add(
      new winston.transports.Stream({
        stream: new Writable({
          objectMode: true,
          write(entry: Record<string, unknown>, _encoding, callback) {
            entries.push(entry);
            callback();
          },
        }),
      }),
    );
  });

  afterEach(async () => {
    await ClientManager.shutdownCurrent();
    logger.clear();
    logger.level = 'info';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('identifies successful connection attempts, transport, negotiated server and configured timeout', async () => {
    const transport = makeTransport();
    const result = await new ConnectionHandler().connectWithRetry(factoryState.client, transport, 'search');
    expect(result).toEqual({ client: factoryState.client, transport });
    expect(details('backend.connection.connected')).toMatchObject({
      serverName: 'search',
      transportType: 'StreamableHTTPClientTransport',
      attempt: 1,
      serverImplementation: 'search-backend',
      serverVersion: '2.4',
      connectionTimeoutMs: 4321,
    });
    expect(factoryState.client.connect).toHaveBeenCalledWith(transport, { timeout: 4321 });
  });

  it('retains a sanitized actual failure and cause while reporting retry attempt and delay', async () => {
    vi.useFakeTimers();
    const error = Object.assign(new Error('GET https://user:password@example.invalid/mcp?token=secret#fragment'), {
      code: 'ECONNRESET',
      cause: new Error('upstream unavailable'),
    });
    vi.mocked(factoryState.client.connect).mockRejectedValueOnce(error);
    const transport = makeTransport();
    const operation = new ConnectionHandler().connectWithRetry(
      factoryState.client,
      transport,
      'search',
      undefined,
      () => transport,
      () => factoryState.client,
    );
    await vi.advanceTimersByTimeAsync(CONNECTION_RETRY.INITIAL_DELAY_MS);
    await operation;
    expect(details('backend.connection.failed')).toMatchObject({
      serverName: 'search',
      attempt: 1,
      error: {
        name: 'Error',
        errorCode: 'ECONNRESET',
        message: 'GET https://example.invalid/mcp',
        cause: { message: 'upstream unavailable' },
      },
    });
    expect(details('backend.connection.retry.scheduled')).toMatchObject({
      serverName: 'search',
      attempt: 2,
      retryDelayMs: CONNECTION_RETRY.INITIAL_DELAY_MS,
    });
    expect(details('backend.connection.connected').attempt).toBe(2);
    const diagnostics = JSON.stringify(entries.filter((entry) => entry.source === 'local-diagnostic'));
    expect(diagnostics).not.toContain('password');
    expect(diagnostics).not.toContain('secret');
    expect(diagnostics).not.toContain('fragment');
    expect((details('backend.connection.failed').error as Record<string, unknown>).stack).toBeUndefined();
  });

  it('reports terminal errors without scheduling a retry or changing the thrown connection error', async () => {
    vi.mocked(factoryState.client.connect).mockRejectedValue(new InvalidClientMetadataError('invalid metadata'));
    await expect(
      new ConnectionHandler().connectWithRetry(factoryState.client, makeTransport(), 'search'),
    ).rejects.toBeInstanceOf(NonRetryableClientConnectionError);
    expect(details('backend.connection.terminal')).toMatchObject({
      serverName: 'search',
      reason: 'non-retryable',
      error: { message: 'invalid metadata' },
    });
    expect(factoryState.client.connect).toHaveBeenCalledTimes(1);
    expect(entries.some((entry) => entry.message === 'backend.connection.retry.scheduled')).toBe(false);
  });

  it('reports OAuth-required metadata without logging the authorization URL or provider', async () => {
    const transport = makeTransport();
    const authorizationUrl = 'https://example.invalid/oauth?state=private-state&code=private-code';
    transport.oauthProvider = {
      getAuthorizationUrl: () => authorizationUrl,
    } as AuthProviderTransport['oauthProvider'];
    vi.mocked(factoryState.client.connect).mockRejectedValue(new UnauthorizedError());
    await expect(
      new ConnectionHandler().connectWithRetry(factoryState.client, transport, 'search'),
    ).rejects.toBeInstanceOf(OAuthRequiredError);
    const connection = new OAuthFlowHandler().handleOAuthRequired(
      'search',
      transport,
      factoryState.client,
      new OAuthRequiredError('search', factoryState.client, transport),
    );
    expect(connection.authorizationUrl).toBe(authorizationUrl);
    expect(details('oauth.authorization.required')).toMatchObject({
      serverName: 'search',
      transportType: 'StreamableHTTPClientTransport',
    });
    expect(JSON.stringify(entries)).not.toContain('private-state');
    expect(JSON.stringify(entries)).not.toContain('private-code');
    expect(JSON.stringify(entries)).not.toContain(authorizationUrl);
  });

  it('reports OAuth completion failures without changing the error or exposing callback credentials', async () => {
    const oldTransport = makeTransport();
    const newTransport = makeTransport();
    const error = new Error('Token exchange failed');
    vi.spyOn(oldTransport, 'finishAuth').mockRejectedValue(error);
    oldTransport.oauthProvider = {
      getAuthorizationUrl: () => 'https://example.invalid/oauth?state=private-state',
      withAuthorizationCallback: async (_callback: URLSearchParams, finish: () => Promise<unknown>) => finish(),
    } as AuthProviderTransport['oauthProvider'];
    const flow = new OAuthFlowHandler();
    const pending = flow.handleOAuthRequired(
      'search',
      oldTransport,
      factoryState.client,
      new OAuthRequiredError('search', factoryState.client, oldTransport),
    );
    await expect(
      flow.completeOAuthAndReconnect('search', oldTransport, newTransport, 'private-code', pending),
    ).rejects.toBe(error);
    expect(details('oauth.reconnection.started')).toMatchObject({
      serverName: 'search',
      connectionTimeoutMs: 4321,
    });
    expect(details('oauth.reconnection.failed')).toMatchObject({
      serverName: 'search',
      error: { name: 'Error', message: 'Token exchange failed' },
    });
    expect(JSON.stringify(entries)).not.toContain('private-code');
    expect(JSON.stringify(entries)).not.toContain('private-state');
  });

  it('projects composite template supervision keys to the configured name in the actual sink', async () => {
    const manager = ClientManager.getOrCreateInstance();
    const outboundKey = 'search:private-session-id';
    await manager.createSingleClient(outboundKey, makeTransport());
    manager.setBackendAvailabilityHandler(() => {
      throw new Error('Availability handler failed');
    });
    manager.publishBackendSupervisionState(outboundKey, {
      backendId: `template:${outboundKey}`,
      state: 'crash-loop',
      attempt: 3,
      limit: 3,
      nextRetryAt: null,
      lastExit: null,
      lastError: new Error('Backend restart failed'),
      currentPid: null,
    });
    expect(details('backend.supervision.state.changed')).toMatchObject({
      serverName: 'search',
      supervisionStatus: 'crash-loop',
    });
    expect(details('backend.supervision.recovery.error').serverName).toBe('search');
    expect(details('backend.availability.publish.failed').serverName).toBe('search');
    expect(details('backend.connection.connected').serverName).toBe('search');
    await manager.removeClient(outboundKey);
    expect(details('backend.client.removing').serverName).toBe('search');
    expect(details('backend.client.removed').serverName).toBe('search');
    const diagnostics = JSON.stringify(entries.filter((entry) => entry.source === 'local-diagnostic'));
    expect(diagnostics).not.toContain(outboundKey);
    expect(diagnostics).not.toContain('private-session-id');
  });

  it.each([
    { status: ClientStatus.Error, event: 'backend.session.recovery.failed' },
    { status: ClientStatus.AwaitingOAuth, event: 'oauth.session.recovery.pending' },
  ])('reports resolved recovery status $status without claiming connection success', async ({ status, event }) => {
    const manager = ClientManager.getOrCreateInstance();
    const transport = makeTransport();
    const freshTransport = makeTransport();
    transport.recreate = () => freshTransport;
    await manager.createSingleClient('search', transport);
    const error = new Error('Recovery could not connect');
    vi.spyOn(manager, 'createSingleClient').mockImplementation(async () => {
      const connection = manager.getClient('search');
      connection.status = status;
      connection.lastError = error;
    });
    factoryState.client.onerror?.(new Error('Session not found'));
    await vi.waitFor(() => {
      expect(entries.some((entry) => entry.message === event)).toBe(true);
    });
    expect(details(event)).toMatchObject({ serverName: 'search', status });
    if (status === ClientStatus.Error) {
      expect(details(event)).toMatchObject({
        phase: 'published-status',
        error: { message: 'Recovery could not connect' },
      });
    }
    expect(entries.some((entry) => entry.message === 'backend.session.recovery.connected')).toBe(false);
  });

  it('reports disconnects and session recovery failures with backend identity and actual errors', async () => {
    const manager = ClientManager.getOrCreateInstance();
    const transport = makeTransport();
    await manager.createSingleClient('search', transport);
    factoryState.client.onclose?.();
    expect(details('backend.connection.disconnected')).toMatchObject({
      serverName: 'search',
      transportType: 'StreamableHTTPClientTransport',
      supervised: false,
    });
    const error = new Error('Could not rebuild transport');
    transport.recreate = () => {
      throw error;
    };
    factoryState.client.onerror?.(new Error('Session not found'));
    expect(details('backend.session.recovery.started').serverName).toBe('search');
    expect(details('backend.session.recovery.failed')).toMatchObject({
      serverName: 'search',
      phase: 'transport-recreation',
      error: { name: 'Error', message: 'Could not rebuild transport' },
    });
  });
});
