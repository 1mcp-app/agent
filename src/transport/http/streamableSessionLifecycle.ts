import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { InitializeResponseData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { AsyncLoadingOrchestrator } from '@src/core/capabilities/asyncLoadingOrchestrator.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { InboundConnectionConfig, ServerStatus } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { RestorableStreamableHTTPServerTransport } from '@src/transport/http/restorableStreamableTransport.js';
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import { logError } from '@src/transport/http/utils/unifiedLogger.js';
import type { ContextData } from '@src/types/context.js';
import { withCanonicalSessionId } from '@src/utils/context/sessionIdentity.js';

type StreamableTransport = StreamableHTTPServerTransport | RestorableStreamableHTTPServerTransport;

export enum StreamableSessionStatus {
  Created = 'created',
  InitializeRecovered = 'initialize_recovered',
  Active = 'active',
  Restored = 'restored',
  Missing = 'missing',
}

export enum StreamableSessionMissingReason {
  InvalidSession = 'invalid_session',
  WrongTransport = 'wrong_transport',
  NotFound = 'not_found',
  RestoreFailed = 'restore_failed',
  InitializeRequired = 'initialize_required',
}

export enum StreamableSessionRestoreErrorType {
  NotFound = 'not_found',
  TransportFailed = 'transport_failed',
  ConnectionFailed = 'connection_failed',
  ContextInvalid = 'context_invalid',
}

interface SdkInternals {
  _webStandardTransport?: {
    _initialized?: boolean;
    sessionId?: string;
  };
}

export interface StreamableSessionRestoreResult {
  transport: RestorableStreamableHTTPServerTransport | null;
  error?: string;
  errorType?: StreamableSessionRestoreErrorType;
}

export interface StreamableSessionCreateResult {
  status: StreamableSessionStatus.Created | StreamableSessionStatus.InitializeRecovered;
  sessionId: string;
  transport: StreamableTransport;
  persisted: boolean;
  persistenceError?: string;
}

export type StreamableSessionLookupResult =
  | {
      status: StreamableSessionStatus.Active | StreamableSessionStatus.Restored;
      sessionId: string;
      transport: StreamableTransport;
    }
  | {
      status: StreamableSessionStatus.Missing;
      sessionId: string;
      reason: StreamableSessionMissingReason;
      error?: string;
      restoreErrorType?: StreamableSessionRestoreResult['errorType'];
    };

export type StreamablePostSessionResult = StreamableSessionLookupResult | StreamableSessionCreateResult;

export interface StreamableSessionCreateData {
  config: InboundConnectionConfig;
  context?: Partial<ContextData>;
}

export interface ResolvePostSessionInput {
  sessionId?: string;
  isInitializeRequest: boolean;
  createSessionData: () => StreamableSessionCreateData;
}

interface StreamableSessionLifecycleOptions {
  createTransport?: (sessionId: string) => StreamableTransport;
  createRestorableTransport?: (sessionId: string) => RestorableStreamableHTTPServerTransport;
  isStreamableTransport?: (transport: unknown) => transport is StreamableTransport;
}

function isValidSessionId(sessionId: string): boolean {
  return typeof sessionId === 'string' && sessionId.trim().length > 0;
}

function defaultIsStreamableTransport(transport: unknown): transport is StreamableTransport {
  return (
    transport instanceof StreamableHTTPServerTransport || transport instanceof RestorableStreamableHTTPServerTransport
  );
}

function buildContextData(config: InboundConnectionConfig, sessionId: string): ContextData | undefined {
  const context = config.context as Partial<ContextData> | undefined;
  if (!context) {
    return undefined;
  }

  return {
    project: context.project || { name: 'unknown' },
    user: context.user || {},
    environment: context.environment || {},
    timestamp: context.timestamp || new Date().toISOString(),
    sessionId: context.sessionId || sessionId,
    version: context.version || 'unknown',
    transport: context.transport || { type: 'unknown' },
  };
}

export class StreamableSessionLifecycle {
  private createTransportImpl: (sessionId: string) => StreamableTransport;
  private createRestorableTransportImpl: (sessionId: string) => RestorableStreamableHTTPServerTransport;
  private isStreamableTransportImpl: (transport: unknown) => transport is StreamableTransport;

  constructor(
    private serverManager: ServerManager,
    private sessionRepository: StreamableSessionRepository,
    private asyncOrchestrator?: AsyncLoadingOrchestrator,
    options: StreamableSessionLifecycleOptions = {},
  ) {
    this.createTransportImpl =
      options.createTransport ??
      ((sessionId: string) =>
        new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
        }));
    this.createRestorableTransportImpl =
      options.createRestorableTransport ??
      ((sessionId: string) =>
        new RestorableStreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
        }));
    this.isStreamableTransportImpl = options.isStreamableTransport ?? defaultIsStreamableTransport;
  }

  async resolvePostSession(input: ResolvePostSessionInput): Promise<StreamablePostSessionResult> {
    if (!input.sessionId) {
      const { config, context } = input.createSessionData();
      return this.createSession(config, context);
    }

    const existing = await this.resolveExistingSession(input.sessionId);
    if (existing.status !== StreamableSessionStatus.Missing) {
      return existing;
    }

    if (!input.isInitializeRequest) {
      return {
        status: StreamableSessionStatus.Missing,
        sessionId: input.sessionId,
        reason: StreamableSessionMissingReason.InitializeRequired,
      };
    }

    const { config, context } = input.createSessionData();
    return this.createSession(config, context, input.sessionId, StreamableSessionStatus.InitializeRecovered);
  }

  async resolveExistingSession(sessionId: string): Promise<StreamableSessionLookupResult> {
    if (!isValidSessionId(sessionId)) {
      logger.debug('Invalid sessionId provided to streamable lifecycle lookup');
      return {
        status: StreamableSessionStatus.Missing,
        sessionId,
        reason: StreamableSessionMissingReason.InvalidSession,
      };
    }

    const existingTransport = this.serverManager.getTransport(sessionId);
    if (existingTransport) {
      if (this.isStreamableTransportImpl(existingTransport)) {
        this.sessionRepository.updateAccess(sessionId);
        return { status: StreamableSessionStatus.Active, sessionId, transport: existingTransport };
      }

      return {
        status: StreamableSessionStatus.Missing,
        sessionId,
        reason: StreamableSessionMissingReason.WrongTransport,
      };
    }

    const restoreResult = await this.restoreSession(sessionId);
    if (restoreResult.transport) {
      return { status: StreamableSessionStatus.Restored, sessionId, transport: restoreResult.transport };
    }

    return {
      status: StreamableSessionStatus.Missing,
      sessionId,
      reason:
        restoreResult.errorType === StreamableSessionRestoreErrorType.NotFound
          ? StreamableSessionMissingReason.NotFound
          : StreamableSessionMissingReason.RestoreFailed,
      error: restoreResult.error,
      restoreErrorType: restoreResult.errorType,
    };
  }

  async getSession(sessionId: string): Promise<StreamableTransport | null> {
    const result = await this.resolveExistingSession(sessionId);
    return result.status === StreamableSessionStatus.Missing ? null : result.transport;
  }

  async restoreSession(sessionId: string): Promise<StreamableSessionRestoreResult> {
    try {
      const sessionData = this.sessionRepository.getSessionData(sessionId);
      if (!sessionData) {
        logger.debug(`No persisted session found for: ${sessionId}`);
        return { transport: null, errorType: StreamableSessionRestoreErrorType.NotFound };
      }

      if (!sessionData.initializeResponse) {
        logger.warn(`Session ${sessionId} exists but lacks initialize response data, cannot restore`);
        return {
          transport: null,
          errorType: StreamableSessionRestoreErrorType.TransportFailed,
          error: 'Session data incompatible with current version. Please create a new session.',
        };
      }

      const config = this.sessionRepository.get(sessionId);
      if (!config) {
        logger.error(`Failed to parse session config for ${sessionId}`);
        return {
          transport: null,
          errorType: StreamableSessionRestoreErrorType.TransportFailed,
          error: 'Failed to parse session config',
        };
      }

      logger.info(`Restoring streamable session: ${sessionId}`);
      const transport = this.createRestorableTransportImpl(sessionId);
      const contextData = buildContextData(config, sessionId);

      try {
        await this.serverManager.connectTransport(transport, sessionId, config, contextData);
      } catch (connectError) {
        const errorMessage = connectError instanceof Error ? connectError.message : String(connectError);
        logger.error(`Failed to connect transport ${sessionId}:`, connectError);
        return { transport: null, error: errorMessage, errorType: StreamableSessionRestoreErrorType.ConnectionFailed };
      }

      const initialized = this.setInitializedState(transport, sessionId);
      if (!initialized) {
        logError('Could not set initialized state during session restoration', {
          method: 'restoreSession',
          path: 'streamableSessionLifecycle',
          sessionId,
          phase: 'SDK initialization',
          context: { reason: 'SDK internal structure inaccessible' },
        });
      }

      transport.markAsRestored();
      this.initializeNotifications(sessionId);
      this.setupTransportHandlers(transport, sessionId);
      this.sessionRepository.updateAccess(sessionId);

      logger.info(`Successfully restored streamable session: ${sessionId} (restored: ${transport.isRestored()})`);
      return { transport };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to restore streamable session ${sessionId}:`, error);
      return { transport: null, error: errorMessage, errorType: StreamableSessionRestoreErrorType.TransportFailed };
    }
  }

  async createSession(
    config: InboundConnectionConfig,
    context?: Partial<ContextData>,
    providedSessionId?: string,
    status: StreamableSessionCreateResult['status'] = StreamableSessionStatus.Created,
  ): Promise<StreamableSessionCreateResult> {
    const sessionId = providedSessionId || AUTH_CONFIG.SERVER.STREAMABLE_SESSION.ID_PREFIX + randomUUID();

    let transport: StreamableTransport;
    try {
      transport = this.createTransportImpl(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create transport for session ${sessionId}:`, error);
      throw new Error(`Session creation failed: transport initialization error - ${errorMessage}`);
    }

    const validContext =
      context && context.project && context.user && context.environment
        ? withCanonicalSessionId(context as ContextData, sessionId)
        : undefined;
    const canonicalContext = validContext ?? (context ? { ...context, sessionId } : undefined);

    if (canonicalContext && canonicalContext.project?.name && canonicalContext.sessionId) {
      logger.info(
        `New session with context: ${canonicalContext.project.name} (${canonicalContext.sessionId})${providedSessionId ? ` (ID: ${providedSessionId})` : ''}`,
      );
    }

    const configWithContext: InboundConnectionConfig & { context?: Partial<ContextData> } = {
      ...config,
      context: canonicalContext,
    };

    try {
      await this.serverManager.connectTransport(transport, sessionId, configWithContext, validContext);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to connect transport ${sessionId}:`, error);
      throw new Error(`Session creation failed: connection error - ${errorMessage}`);
    }

    let persisted = false;
    let persistenceError: string | undefined;
    try {
      this.sessionRepository.create(sessionId, configWithContext);
      persisted = true;
    } catch (error) {
      persistenceError = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to persist session ${sessionId} to repository: ${persistenceError}`);
    }

    this.initializeNotifications(sessionId);
    this.setupTransportHandlers(transport, sessionId);

    return { status, sessionId, transport, persisted, persistenceError };
  }

  storeInitializeResponse(sessionId: string, initializeResponse: InitializeResponseData): void {
    this.sessionRepository.storeInitializeResponse(sessionId, initializeResponse);
  }

  async handleAbnormalDisconnect(sessionId: string): Promise<void> {
    await this.serverManager.disconnectTransport(sessionId);
  }

  async completeExplicitDelete(sessionId: string): Promise<void> {
    try {
      this.sessionRepository.delete(sessionId);
    } catch (error) {
      logError('Session deletion failed', {
        method: 'completeExplicitDelete',
        path: 'streamableSessionLifecycle',
        sessionId,
        phase: 'session cleanup',
        error,
        context: { reason: 'Repository delete failed - session will expire via TTL' },
      });
    }

    await this.serverManager.disconnectTransport(sessionId, true);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.completeExplicitDelete(sessionId);
  }

  private initializeNotifications(sessionId: string): void {
    if (!this.asyncOrchestrator) {
      return;
    }

    const inboundConnection = this.serverManager.getServer(sessionId);
    if (inboundConnection) {
      this.asyncOrchestrator.initializeNotifications(inboundConnection);
      logger.debug(`Async loading notifications initialized for Streamable HTTP session ${sessionId}`);
    }
  }

  private setupTransportHandlers(transport: StreamableTransport, sessionId: string): void {
    transport.onclose = () => {
      void this.handleAbnormalDisconnect(sessionId);
    };

    transport.onerror = (error) => {
      logger.error(`Streamable HTTP transport error for session ${sessionId}:`, error);
      const server = this.serverManager.getServer(sessionId);
      if (server) {
        server.status = ServerStatus.Error;
        server.lastError = error instanceof Error ? error : new Error(String(error));
      }
    };
  }

  private setInitializedState(transport: RestorableStreamableHTTPServerTransport, sessionId: string): boolean {
    try {
      const internals = transport as unknown as SdkInternals;
      if (internals._webStandardTransport) {
        if (
          internals._webStandardTransport._initialized !== undefined &&
          typeof internals._webStandardTransport._initialized !== 'boolean'
        ) {
          logError('SDK internal property _initialized is not a boolean', {
            method: 'setInitializedState',
            path: 'streamableSessionLifecycle',
            sessionId,
            phase: 'SDK internal validation',
            context: { property: '_initialized', type: typeof internals._webStandardTransport._initialized },
          });
          return false;
        }
        if (
          internals._webStandardTransport.sessionId !== undefined &&
          typeof internals._webStandardTransport.sessionId !== 'string'
        ) {
          logError('SDK internal property sessionId is not a string', {
            method: 'setInitializedState',
            path: 'streamableSessionLifecycle',
            sessionId,
            phase: 'SDK internal validation',
            context: { property: 'sessionId', type: typeof internals._webStandardTransport.sessionId },
          });
          return false;
        }
        internals._webStandardTransport._initialized = true;
        internals._webStandardTransport.sessionId = sessionId;
        return true;
      }

      logError('SDK internal structure changed - _webStandardTransport not found', {
        method: 'setInitializedState',
        path: 'streamableSessionLifecycle',
        sessionId,
        phase: 'SDK internal access',
        context: { reason: '_webStandardTransport property missing' },
      });
      return false;
    } catch (error) {
      logError('Failed to set initialized state', {
        method: 'setInitializedState',
        path: 'streamableSessionLifecycle',
        sessionId,
        phase: 'SDK internal mutation',
        error,
      });
      return false;
    }
  }
}
