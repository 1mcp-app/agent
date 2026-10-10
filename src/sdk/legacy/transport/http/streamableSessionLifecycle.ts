import { randomUUID } from 'node:crypto';

import { InitializeResponseData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { AsyncLoadingOrchestrator } from '@src/core/capabilities/asyncLoadingOrchestrator.js';
import type { TemplateContextProof } from '@src/core/context/templateContextTrust.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { InboundConnectionConfig } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { StreamableHTTPServerTransport } from '@src/sdk/legacy/server/streamableHttp.js';
import { RestorableStreamableHTTPServerTransport } from '@src/transport/http/restorableStreamableTransport.js';
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import {
  authorizeRequestTemplateContext,
  getRequestProjectPreparationAuthority,
} from '@src/transport/http/utils/templateContextAuthority.js';
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
  contextProof?: TemplateContextProof;
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

function isPersistableSessionId(sessionId: string): boolean {
  const streamPrefix = AUTH_CONFIG.SERVER.STREAMABLE_SESSION.ID_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const streamSessionPattern = new RegExp(
    `^${streamPrefix}[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    'i',
  );
  return streamSessionPattern.test(sessionId) || /^rest-[0-9a-f]{16}$/.test(sessionId);
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
    ...(context.projectSet ? { projectSet: context.projectSet } : {}),
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
      if (!input.isInitializeRequest) {
        return {
          status: StreamableSessionStatus.Missing,
          sessionId: '',
          reason: StreamableSessionMissingReason.InitializeRequired,
        };
      }
      const { config, context, contextProof } = input.createSessionData();
      return this.createSession(config, context, undefined, StreamableSessionStatus.Created, contextProof);
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

    if (!isPersistableSessionId(input.sessionId)) {
      return {
        status: StreamableSessionStatus.Missing,
        sessionId: input.sessionId,
        reason: StreamableSessionMissingReason.InvalidSession,
      };
    }

    const { config, context, contextProof } = input.createSessionData();
    return this.createSession(
      config,
      context,
      input.sessionId,
      StreamableSessionStatus.InitializeRecovered,
      contextProof,
    );
  }

  async resolveExistingSession(sessionId: string): Promise<StreamableSessionLookupResult> {
    if (!isValidSessionId(sessionId)) {
      logger.debug('streamableSessionLifecycle.invalid.sessionid.provided.to.streamable.lifecycle.lookup.946c0da3');
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
        logger.debug('streamableSessionLifecycle.no.persisted.session.found.for.1fd9955e');
        return { transport: null, errorType: StreamableSessionRestoreErrorType.NotFound };
      }

      if (!sessionData.initializeResponse) {
        logger.warn(
          'streamableSessionLifecycle.session.exists.but.lacks.initialize.response.data.cannot.restore.01883ab6',
        );
        return {
          transport: null,
          errorType: StreamableSessionRestoreErrorType.TransportFailed,
          error: 'Session data incompatible with current version. Please create a new session.',
        };
      }

      const config = this.sessionRepository.get(sessionId);
      if (!config) {
        logger.error('streamableSessionLifecycle.failed.to.parse.session.config.for.db7489eb');
        return {
          transport: null,
          errorType: StreamableSessionRestoreErrorType.TransportFailed,
          error: 'Failed to parse session config',
        };
      }

      logger.info('streamableSessionLifecycle.restoring.streamable.session.35290bd2');
      const transport = this.createRestorableTransportImpl(sessionId);
      const contextData = buildContextData(config, sessionId);
      const authorization = contextData
        ? authorizeRequestTemplateContext({
            context: contextData,
            proof: config.contextProof,
            transportSessionId: sessionId,
            source: 'persisted',
          })
        : undefined;
      if (authorization && authorization.status !== 'trusted') {
        return {
          transport: null,
          errorType: StreamableSessionRestoreErrorType.ContextInvalid,
          error: 'Persisted template context is not trusted. Please initialize a new session.',
        };
      }

      try {
        const authority = getRequestProjectPreparationAuthority(authorization);
        await this.serverManager.connectTransport(
          transport,
          sessionId,
          config,
          authorization?.status === 'trusted' ? authorization.context : undefined,
          ...(authority ? [authority] : []),
        );
      } catch (connectError) {
        const errorMessage = connectError instanceof Error ? connectError.message : String(connectError);
        logger.error('streamableSessionLifecycle.failed.to.connect.transport.90a65f89', { error: connectError });
        return { transport: null, error: errorMessage, errorType: StreamableSessionRestoreErrorType.ConnectionFailed };
      }

      const initialized = this.setInitializedState(transport, sessionId);
      if (!initialized) {
        logError('streamableSessionLifecycle.could.not.set.initialized.state.during.session.restoration.69095992', {
          method: 'restoreSession',
          sessionId: sessionId,
        });
        await this.serverManager.disconnectTransport(sessionId, true);
        return {
          transport: null,
          errorType: StreamableSessionRestoreErrorType.TransportFailed,
          error: 'Could not restore SDK initialized state. Please create a new session.',
        };
      }

      transport.markAsRestored();
      this.initializeNotifications(sessionId);
      this.setupTransportHandlers(transport, sessionId);
      this.sessionRepository.updateAccess(sessionId);

      logger.info('streamableSessionLifecycle.successfully.restored.streamable.session.restored.9648c603');
      return { transport };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('streamableSessionLifecycle.failed.to.restore.streamable.session.bf5b6a04', { error: error });
      return { transport: null, error: errorMessage, errorType: StreamableSessionRestoreErrorType.TransportFailed };
    }
  }

  async createSession(
    config: InboundConnectionConfig,
    context?: Partial<ContextData>,
    providedSessionId?: string,
    status: StreamableSessionCreateResult['status'] = StreamableSessionStatus.Created,
    contextProof?: TemplateContextProof,
  ): Promise<StreamableSessionCreateResult> {
    const sessionId = providedSessionId || AUTH_CONFIG.SERVER.STREAMABLE_SESSION.ID_PREFIX + randomUUID();

    let transport: StreamableTransport;
    try {
      transport = this.createTransportImpl(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('streamableSessionLifecycle.failed.to.create.transport.for.session.9aa73ada', { error: error });
      throw new Error(`Session creation failed: transport initialization error - ${errorMessage}`);
    }

    const validContext =
      context && context.project && context.user && context.environment
        ? withCanonicalSessionId(context as ContextData, sessionId)
        : undefined;
    const canonicalContext = validContext ?? (context ? { ...context, sessionId } : undefined);
    const authorization =
      validContext && contextProof
        ? authorizeRequestTemplateContext({
            context: context as ContextData,
            proof: contextProof,
            transportSessionId: sessionId,
            source: 'meta',
          })
        : undefined;
    const authority = getRequestProjectPreparationAuthority(authorization);

    if (canonicalContext && canonicalContext.project?.name && canonicalContext.sessionId) {
      logger.info('streamableSessionLifecycle.new.session.with.context.90e138c1');
    }

    const configWithContext: InboundConnectionConfig & { context?: Partial<ContextData> } = {
      ...config,
      context: canonicalContext,
      contextProof,
    };

    try {
      await this.serverManager.connectTransport(
        transport,
        sessionId,
        configWithContext,
        validContext,
        ...(authority ? [authority] : []),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('streamableSessionLifecycle.failed.to.connect.transport.43c1f33b', { error: error });
      throw new Error(`Session creation failed: connection error - ${errorMessage}`);
    }

    let persisted = false;
    let persistenceError: string | undefined;
    try {
      this.sessionRepository.create(sessionId, configWithContext);
      persisted = true;
    } catch (error) {
      persistenceError = error instanceof Error ? error.message : String(error);
      logger.warn('streamableSessionLifecycle.failed.to.persist.session.to.repository.b76407ee', { error: error });
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
      logError('streamableSessionLifecycle.session.deletion.failed.b8bfdce6', {
        method: 'completeExplicitDelete',
        sessionId: sessionId,
        error: error,
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
      logger.debug(
        'streamableSessionLifecycle.async.loading.notifications.initialized.for.streamable.http.session.a7a97183',
      );
    }
  }

  private setupTransportHandlers(transport: StreamableTransport, sessionId: string): void {
    transport.onclose = () => {
      void this.handleAbnormalDisconnect(sessionId);
    };

    transport.onerror = (error) => {
      logger.error('streamableSessionLifecycle.streamable.http.transport.error.for.session.e5ad1f60', { error: error });
      this.serverManager.recordInboundConnectionError(sessionId, error);
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
          logError('streamableSessionLifecycle.sdk.internal.property.initialized.is.not.a.boolean.94489996', {
            method: 'setInitializedState',
            sessionId: sessionId,
          });
          return false;
        }
        if (
          internals._webStandardTransport.sessionId !== undefined &&
          typeof internals._webStandardTransport.sessionId !== 'string'
        ) {
          logError('streamableSessionLifecycle.sdk.internal.property.sessionid.is.not.a.string.bfe837aa', {
            method: 'setInitializedState',
            sessionId: sessionId,
          });
          return false;
        }
        internals._webStandardTransport._initialized = true;
        internals._webStandardTransport.sessionId = sessionId;
        return true;
      }

      logError('streamableSessionLifecycle.sdk.internal.structure.changed.webstandardtransport.not.found.19217e0c', {
        method: 'setInitializedState',
        sessionId: sessionId,
      });
      return false;
    } catch (error) {
      logError('streamableSessionLifecycle.failed.to.set.initialized.state.0d182a79', {
        method: 'setInitializedState',
        sessionId: sessionId,
        error: error,
      });
      return false;
    }
  }
}
