import { randomUUID } from 'node:crypto';

import { InitializeResponseData, StreamableSessionAuthorizationBinding } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { AsyncLoadingOrchestrator } from '@src/core/capabilities/asyncLoadingOrchestrator.js';
import type { TemplateContextProof } from '@src/core/context/templateContextTrust.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { SessionAdmissionCapacityError } from '@src/core/server/sessionAdmission.js';
import { InboundConnectionConfig } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { StreamableHTTPServerTransport } from '@src/sdk/legacy/server/streamableHttp.js';
import { RestorableStreamableHTTPServerTransport } from '@src/transport/http/restorableStreamableTransport.js';
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import { canonicalSessionBinding, sessionBindingsMatch } from '@src/transport/http/streamableSessionAuthorization.js';
import { isContextData } from '@src/transport/http/utils/contextExtractor.js';
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
  authorizationBinding?: StreamableSessionAuthorizationBinding | null;
  deferActivity?: boolean;
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
  private stopped = false;
  private readonly restoringSessions = new Map<string, Promise<StreamableSessionRestoreResult>>();
  private readonly disconnectingSessions = new Map<string, Promise<void>>();
  private readonly retiringSessions = new Map<string, Promise<void>>();
  private readonly pendingSessionIds = new Set<string>();
  private readonly activeBindings = new WeakMap<StreamableTransport, StreamableSessionAuthorizationBinding>();
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
    this.sessionRepository.setExpirationHandler?.((sessionIds) => this.expireIdleSessions(sessionIds));
    this.serverManager.registerCleanup?.(async () => {
      this.stopped = true;
      this.sessionRepository.stopPeriodicFlush();
      await Promise.allSettled([...this.retiringSessions.values(), ...this.disconnectingSessions.values()]);
    });
  }

  async resolvePostSession(input: ResolvePostSessionInput): Promise<StreamablePostSessionResult> {
    const binding = input.authorizationBinding ?? this.defaultAuthorizationBinding();
    if (binding === null) {
      return {
        status: StreamableSessionStatus.Missing,
        sessionId: input.sessionId ?? '',
        reason: StreamableSessionMissingReason.NotFound,
      };
    }
    if (!input.sessionId) {
      if (!input.isInitializeRequest) {
        return {
          status: StreamableSessionStatus.Missing,
          sessionId: '',
          reason: StreamableSessionMissingReason.InitializeRequired,
        };
      }
      const { config, context, contextProof } = input.createSessionData();
      return this.createSession(config, context, undefined, StreamableSessionStatus.Created, contextProof, binding);
    }

    const existing = await this.resolveExistingSession(input.sessionId, binding, !input.deferActivity);
    if (existing.status !== StreamableSessionStatus.Missing) {
      return existing;
    }
    if (this.stopped || this.retiringSessions.has(input.sessionId) || this.disconnectingSessions.has(input.sessionId)) {
      return existing;
    }

    if (binding !== undefined) {
      if (!input.isInitializeRequest) return existing;
      const { config, context, contextProof } = input.createSessionData();
      if (!this.canInitializeSignedSession(input.sessionId, binding, context, contextProof)) return existing;
      this.pendingSessionIds.add(input.sessionId);
      try {
        return await this.createSession(
          config,
          context,
          input.sessionId,
          StreamableSessionStatus.Created,
          contextProof,
          binding,
        );
      } finally {
        this.pendingSessionIds.delete(input.sessionId);
      }
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

  async resolveExistingSession(
    sessionId: string,
    authorizationBinding: StreamableSessionAuthorizationBinding | null | undefined = this.defaultAuthorizationBinding(),
    recordActivity = true,
  ): Promise<StreamableSessionLookupResult> {
    if (!isValidSessionId(sessionId)) {
      logger.debug('streamableSessionLifecycle.invalid.sessionid.provided.to.streamable.lifecycle.lookup.946c0da3');
      return {
        status: StreamableSessionStatus.Missing,
        sessionId,
        reason: StreamableSessionMissingReason.InvalidSession,
      };
    }

    if (this.stopped || this.retiringSessions.has(sessionId) || this.disconnectingSessions.has(sessionId)) {
      return { status: StreamableSessionStatus.Missing, sessionId, reason: StreamableSessionMissingReason.NotFound };
    }
    if (this.sessionRepository.isExpired?.(sessionId)) {
      await this.completeExplicitDelete(sessionId);
      return { status: StreamableSessionStatus.Missing, sessionId, reason: StreamableSessionMissingReason.NotFound };
    }
    if (!this.isSessionAuthorized(sessionId, authorizationBinding)) {
      return { status: StreamableSessionStatus.Missing, sessionId, reason: StreamableSessionMissingReason.NotFound };
    }
    const existingTransport = this.serverManager.getTransport(sessionId);
    if (existingTransport) {
      if (this.isStreamableTransportImpl(existingTransport)) {
        if (recordActivity) this.sessionRepository.updateAccess(sessionId);
        return { status: StreamableSessionStatus.Active, sessionId, transport: existingTransport };
      }

      return {
        status: StreamableSessionStatus.Missing,
        sessionId,
        reason: StreamableSessionMissingReason.WrongTransport,
      };
    }

    const restoreResult = await this.restoreSession(sessionId, authorizationBinding, recordActivity);
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

  /** A verified local proof can admit a fresh signed identity, never replace a retained session. */
  canInitializeSignedSession(
    sessionId: string,
    binding: StreamableSessionAuthorizationBinding | null | undefined,
    context?: Partial<ContextData>,
    proof?: TemplateContextProof,
  ): boolean {
    if (!canonicalSessionBinding(binding)) return false;
    if (!proof) return false;
    if (!isContextData(context)) return false;
    if (!isPersistableSessionId(sessionId)) return false;
    const authorization = authorizeRequestTemplateContext({
      context,
      proof,
      transportSessionId: sessionId,
      source: 'meta',
    });
    if (authorization.status !== 'trusted') return false;
    if (authorization.provenance !== 'verified-local') return false;
    if (this.pendingSessionIds.has(sessionId)) return false;
    if (this.stopped || this.retiringSessions.has(sessionId) || this.disconnectingSessions.has(sessionId)) return false;
    if (this.serverManager.getTransport(sessionId)) return false;
    return !this.sessionRepository.getSessionData(sessionId);
  }

  /** Check ownership before project admission, without renewing or restoring a session. */
  isSessionAuthorized(
    sessionId: string,
    authorizationBinding: StreamableSessionAuthorizationBinding | null | undefined = this.defaultAuthorizationBinding(),
  ): boolean {
    if (this.stopped || this.retiringSessions.has(sessionId) || this.disconnectingSessions.has(sessionId)) return false;
    if (authorizationBinding === undefined) return true;
    if (authorizationBinding === null) return false;
    const transport = this.serverManager.getTransport(sessionId);
    let stored: StreamableSessionAuthorizationBinding | undefined;
    if (transport && this.isStreamableTransportImpl(transport)) {
      stored = this.activeBindings.get(transport);
    }
    stored ??= this.sessionRepository.getSessionData(sessionId)?.authorizationBinding;
    return sessionBindingsMatch(stored, authorizationBinding);
  }

  async getSession(
    sessionId: string,
    authorizationBinding?: StreamableSessionAuthorizationBinding | null,
  ): Promise<StreamableTransport | null> {
    const result = await this.resolveExistingSession(sessionId, authorizationBinding);
    return result.status === StreamableSessionStatus.Missing ? null : result.transport;
  }

  restoreSession(
    sessionId: string,
    authorizationBinding: StreamableSessionAuthorizationBinding | null | undefined = this.defaultAuthorizationBinding(),
    recordActivity = true,
  ): Promise<StreamableSessionRestoreResult> {
    const pending = this.restoringSessions.get(sessionId);
    if (pending)
      return pending.then((result) => {
        if (!this.isSessionAuthorized(sessionId, authorizationBinding))
          return { transport: null, errorType: StreamableSessionRestoreErrorType.NotFound };
        return result;
      });
    const restoration = this.performRestoreSession(sessionId, authorizationBinding, recordActivity);
    this.restoringSessions.set(sessionId, restoration);
    void restoration
      .finally(() => {
        if (this.restoringSessions.get(sessionId) === restoration) this.restoringSessions.delete(sessionId);
      })
      .catch(() => undefined);
    return restoration;
  }

  private async performRestoreSession(
    sessionId: string,
    authorizationBinding: StreamableSessionAuthorizationBinding | null | undefined = this.defaultAuthorizationBinding(),
    recordActivity = true,
  ): Promise<StreamableSessionRestoreResult> {
    let releaseProtection: ((accepted?: boolean) => void) | undefined;
    try {
      const sessionData = this.sessionRepository.getSessionData(sessionId);
      if (!sessionData) {
        logger.debug('streamableSessionLifecycle.no.persisted.session.found.for.1fd9955e');
        return { transport: null, errorType: StreamableSessionRestoreErrorType.NotFound };
      }

      if (authorizationBinding !== undefined) {
        if (!sessionBindingsMatch(sessionData.authorizationBinding, authorizationBinding)) {
          return { transport: null, errorType: StreamableSessionRestoreErrorType.NotFound };
        }
      }

      releaseProtection = this.sessionRepository.protectSession?.(sessionId);

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
      const binding = canonicalSessionBinding(sessionData.authorizationBinding);
      if (binding) this.activeBindings.set(transport, binding);
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
        if (connectError instanceof SessionAdmissionCapacityError) throw connectError;
        const errorMessage = connectError instanceof Error ? connectError.message : String(connectError);
        logger.error('streamableSessionLifecycle.failed.to.connect.transport.90a65f89', { error: connectError });
        return { transport: null, error: errorMessage, errorType: StreamableSessionRestoreErrorType.ConnectionFailed };
      }

      if (this.stopped) {
        await this.serverManager.disconnectTransport(sessionId, true);
        return { transport: null, errorType: StreamableSessionRestoreErrorType.ConnectionFailed };
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
      if (recordActivity) this.sessionRepository.updateAccess(sessionId);

      logger.info('streamableSessionLifecycle.successfully.restored.streamable.session.restored.9648c603');
      return { transport };
    } catch (error) {
      if (error instanceof SessionAdmissionCapacityError) throw error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('streamableSessionLifecycle.failed.to.restore.streamable.session.bf5b6a04', { error: error });
      return { transport: null, error: errorMessage, errorType: StreamableSessionRestoreErrorType.TransportFailed };
    } finally {
      releaseProtection?.(recordActivity);
    }
  }

  async createSession(
    config: InboundConnectionConfig,
    context?: Partial<ContextData>,
    providedSessionId?: string,
    status: StreamableSessionCreateResult['status'] = StreamableSessionStatus.Created,
    contextProof?: TemplateContextProof,
    authorizationBinding: StreamableSessionAuthorizationBinding | null | undefined = this.defaultAuthorizationBinding(),
  ): Promise<StreamableSessionCreateResult> {
    if (this.stopped) throw new Error('Session admission is closed');
    const binding = canonicalSessionBinding(authorizationBinding);
    if (authorizationBinding !== undefined && !binding) throw new Error('Session authorization required');
    const sessionId = providedSessionId || AUTH_CONFIG.SERVER.STREAMABLE_SESSION.ID_PREFIX + randomUUID();

    let transport: StreamableTransport;
    try {
      transport = this.createTransportImpl(sessionId);
      if (binding) this.activeBindings.set(transport, binding);
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
      if (this.serverManager.getTransport(sessionId)) await this.serverManager.disconnectTransport(sessionId, true);
      if (error instanceof SessionAdmissionCapacityError) throw error;
      throw new Error(`Session creation failed: connection error - ${errorMessage}`);
    }

    if (this.stopped) {
      await this.serverManager.disconnectTransport(sessionId, true);
      throw new Error('Session admission is closed');
    }
    let persisted = false;
    let persistenceError: string | undefined;
    try {
      this.sessionRepository.create(sessionId, configWithContext, ...(binding ? [binding] : []));
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

  handleAbnormalDisconnect(sessionId: string): Promise<void> {
    if (this.stopped || this.retiringSessions.has(sessionId)) return Promise.resolve();
    const existing = this.disconnectingSessions.get(sessionId);
    if (existing) return existing;
    const disconnection = Promise.resolve().then(() => this.serverManager.disconnectTransport(sessionId));
    this.disconnectingSessions.set(sessionId, disconnection);
    void disconnection.then(
      () => {
        if (this.disconnectingSessions.get(sessionId) === disconnection) this.disconnectingSessions.delete(sessionId);
      },
      () => {
        // Failed cleanup still owns resources and cannot be restored over.
      },
    );
    return disconnection;
  }

  protectSession(sessionId: string): (accepted?: boolean) => void {
    if (this.stopped || this.retiringSessions.has(sessionId) || this.disconnectingSessions.has(sessionId))
      throw new Error('Session is no longer active');
    return this.sessionRepository.protectSession(sessionId);
  }

  async expireIdleSessions(sessionIds = this.sessionRepository.getExpiredSessionIds()): Promise<void> {
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        if (!this.sessionRepository.isExpired(sessionId)) return;
        try {
          await this.completeExplicitDelete(sessionId);
        } catch (error) {
          logError('streamableSessionLifecycle.session.deletion.failed.b8bfdce6', {
            method: 'expireIdleSessions',
            sessionId,
            error,
          });
        }
      }),
    );
  }

  completeExplicitDelete(sessionId: string): Promise<void> {
    const existing = this.retiringSessions.get(sessionId);
    if (existing) return existing;
    const disconnection = this.disconnectingSessions.get(sessionId);
    // Revoke lookup before any asynchronous cleanup or transport onclose callback.
    const retirement = Promise.resolve().then(async () => {
      try {
        this.sessionRepository.delete(sessionId);
      } catch (error) {
        logError('streamableSessionLifecycle.session.deletion.failed.b8bfdce6', {
          method: 'completeExplicitDelete',
          sessionId,
          error,
        });
      }
      if (disconnection) {
        await disconnection;
        return;
      }
      await this.serverManager.disconnectTransport(sessionId, true);
    });
    this.retiringSessions.set(sessionId, retirement);
    void retirement.then(
      () => {
        if (this.retiringSessions.get(sessionId) === retirement) this.retiringSessions.delete(sessionId);
      },
      () => {
        // Keep failed cleanup retired: ownership may still hold upstream resources.
      },
    );
    return retirement;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.completeExplicitDelete(sessionId);
  }

  private defaultAuthorizationBinding(): null | undefined {
    return AgentConfigManager.getInstance().get('features').auth ? null : undefined;
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
    this.serverManager.getServer(sessionId)?.adapter?.setRequestActivityTracker?.(() => this.protectSession(sessionId));
    transport.onclose = () => {
      if (this.serverManager.getTransport(sessionId) !== transport) return;
      void this.handleAbnormalDisconnect(sessionId).catch((error) => {
        logError('streamableSessionLifecycle.session.deletion.failed.b8bfdce6', {
          method: 'handleAbnormalDisconnect',
          sessionId,
          error,
        });
      });
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
