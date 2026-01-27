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

/**
 * Interface for accessing SDK internal properties needed for session restoration.
 * This is fragile but simple - if SDK changes, we fall back to re-initialization.
 */
interface SdkInternals {
  _webStandardTransport?: {
    _initialized?: boolean;
    sessionId?: string;
  };
}

/**
 * Result type for session restoration operations.
 */
export interface SessionRestoreResult {
  transport: RestorableStreamableHTTPServerTransport | null;
  error?: string;
  errorType?: 'not_found' | 'transport_failed' | 'connection_failed' | 'context_invalid';
}

/**
 * Result type for session creation operations.
 * Indicates whether the session was successfully persisted to storage.
 */
export interface SessionCreateResult {
  transport: StreamableHTTPServerTransport | RestorableStreamableHTTPServerTransport;
  persisted: boolean;
  persistenceError?: string;
}

/**
 * Validates a session ID format.
 *
 * @param sessionId - The session ID to validate
 * @returns true if the session ID is valid, false otherwise
 */
function isValidSessionId(sessionId: string): boolean {
  return typeof sessionId === 'string' && sessionId.trim().length > 0;
}

/**
 * Service to handle session management logic for Streamable HTTP transport.
 * Encapsulates creation, restoration, and cleanup of sessions.
 */
export class SessionService {
  constructor(
    private serverManager: ServerManager,
    private sessionRepository: StreamableSessionRepository,
    private asyncOrchestrator?: AsyncLoadingOrchestrator,
  ) {}

  /**
   * Retrieves an existing session transport or tries to restore it.
   *
   * @param sessionId - The session ID to retrieve
   * @returns The transport if found or restored successfully, null otherwise
   */
  async getSession(
    sessionId: string,
  ): Promise<StreamableHTTPServerTransport | RestorableStreamableHTTPServerTransport | null> {
    // Validate sessionId
    if (!isValidSessionId(sessionId)) {
      logger.debug('Invalid sessionId provided to getSession');
      return null;
    }

    const existingTransport = this.serverManager.getTransport(sessionId);

    if (existingTransport) {
      // Verify the transport is the correct type for this endpoint
      if (
        existingTransport instanceof StreamableHTTPServerTransport ||
        existingTransport instanceof RestorableStreamableHTTPServerTransport
      ) {
        // Update last accessed time for active sessions
        this.sessionRepository.updateAccess(sessionId);
        return existingTransport;
      }
      // Transport exists but is wrong type (e.g., STDIO), so it's not usable here
      return null;
    }

    // Try to restore from persistent storage
    const result = await this.restoreSession(sessionId);
    return result.transport;
  }

  /**
   * Stores initialize response data for a session to enable proper restoration.
   *
   * This data is used to replay the initialize handshake through the SDK's
   * public API during session restoration, avoiding fragile private property access.
   *
   * @param sessionId - The session ID to update
   * @param initializeResponse - The initialize response data to store
   */
  storeInitializeResponse(sessionId: string, initializeResponse: InitializeResponseData): void {
    this.sessionRepository.storeInitializeResponse(sessionId, initializeResponse);
  }

  /**
   * Sets the SDK's internal initialized state directly.
   *
   * This is a simple approach that accesses SDK internals. If the SDK structure
   * changes, this will fail gracefully and the session won't be marked as restored,
   * allowing the client to re-initialize.
   *
   * @param transport - The transport to mark as initialized
   * @param sessionId - The session ID to set
   * @returns true if successful, false if SDK internals are inaccessible
   */
  private setInitializedState(transport: RestorableStreamableHTTPServerTransport, sessionId: string): boolean {
    try {
      const internals = transport as unknown as SdkInternals;
      if (internals._webStandardTransport) {
        // Validate that required properties exist before assignment
        if (
          internals._webStandardTransport._initialized !== undefined &&
          typeof internals._webStandardTransport._initialized !== 'boolean'
        ) {
          logError('SDK internal property _initialized is not a boolean', {
            method: 'setInitializedState',
            path: 'sessionService',
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
            path: 'sessionService',
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
        path: 'sessionService',
        sessionId,
        phase: 'SDK internal access',
        context: { reason: '_webStandardTransport property missing' },
      });
      return false;
    } catch (error) {
      logError('Failed to set initialized state', {
        method: 'setInitializedState',
        path: 'sessionService',
        sessionId,
        phase: 'SDK internal mutation',
        error,
      });
      return false;
    }
  }

  /**
   * Restores a session from persistent storage.
   *
   * The client won't send initialize again when reconnecting - they think the session
   * is already initialized. We need to restore the SDK's initialized state internally
   * using the stored initialize response data.
   *
   * @param sessionId - The session ID to restore
   * @returns SessionRestoreResult with transport or error details
   */
  async restoreSession(sessionId: string): Promise<SessionRestoreResult> {
    try {
      // Get full session data including initializeResponse
      const sessionData = this.sessionRepository.getSessionData(sessionId);
      if (!sessionData) {
        logger.debug(`No persisted session found for: ${sessionId}`);
        return { transport: null, errorType: 'not_found' };
      }

      // Check if session has initialize response data
      if (!sessionData.initializeResponse) {
        logger.warn(`Session ${sessionId} exists but lacks initialize response data, cannot restore`);
        return {
          transport: null,
          errorType: 'transport_failed',
          error: 'Session data incompatible with current version. Please create a new session.',
        };
      }

      // Parse session data to config
      const config = this.sessionRepository.get(sessionId);
      if (!config) {
        logger.error(`Failed to parse session config for ${sessionId}`);
        return { transport: null, errorType: 'transport_failed', error: 'Failed to parse session config' };
      }

      logger.info(`Restoring streamable session: ${sessionId}`);

      // Create new transport with the original session ID
      // The sessionIdGenerator callback is the SDK's public API for controlling session IDs
      const transport = new RestorableStreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });

      // Convert config context to ContextData format if available
      const context = config.context as Partial<ContextData> | undefined;
      const contextData: ContextData | undefined = context
        ? {
            project: context.project || { name: 'unknown' },
            user: context.user || {},
            environment: context.environment || {},
            timestamp: context.timestamp || new Date().toISOString(),
            sessionId: context.sessionId || sessionId,
            version: context.version || 'unknown',
            transport: context.transport || { type: 'unknown' },
          }
        : undefined;

      // Reconnect with the original configuration and context
      try {
        await this.serverManager.connectTransport(transport, sessionId, config, contextData);
      } catch (connectError) {
        const errorMessage = connectError instanceof Error ? connectError.message : String(connectError);
        logger.error(`Failed to connect transport ${sessionId}:`, connectError);
        return { transport: null, error: errorMessage, errorType: 'connection_failed' };
      }

      // Set SDK's internal initialized state directly
      // This is simple but fragile - if SDK changes, client can re-initialize
      const initialized = this.setInitializedState(transport, sessionId);
      if (!initialized) {
        logError('Could not set initialized state during session restoration', {
          method: 'restoreSession',
          path: 'sessionService',
          sessionId,
          phase: 'SDK initialization',
          context: { reason: 'SDK internal structure inaccessible' },
        });
        // Continue anyway - client can re-initialize if needed
      }

      // Mark as restored
      transport.markAsRestored();

      // Initialize notifications
      this.initializeNotifications(sessionId);

      // Set up handlers
      this.setupTransportHandlers(transport, sessionId);

      // Update last accessed time
      this.sessionRepository.updateAccess(sessionId);

      logger.info(`Successfully restored streamable session: ${sessionId} (restored: ${transport.isRestored()})`);
      return { transport };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to restore streamable session ${sessionId}:`, error);
      return { transport: null, error: errorMessage, errorType: 'transport_failed' };
    }
  }

  /**
   * Creates a new session with the given configuration.
   *
   * @param config - The inbound connection configuration
   * @param context - Optional context data for the session
   * @param providedSessionId - Optional session ID to use instead of generating one
   * @returns SessionCreateResult with transport and persistence status
   * @throws Error if session creation fails (but not if persistence fails)
   */
  async createSession(
    config: InboundConnectionConfig,
    context?: Partial<ContextData>,
    providedSessionId?: string,
  ): Promise<SessionCreateResult> {
    const sessionId = providedSessionId || AUTH_CONFIG.SERVER.STREAMABLE_SESSION.ID_PREFIX + randomUUID();

    let transport: StreamableHTTPServerTransport;
    try {
      // Always use the standard transport - no special handling for providedSessionId
      // The client's initialize request will be processed normally through handleRequest
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create transport for session ${sessionId}:`, error);
      throw new Error(`Session creation failed: transport initialization error - ${errorMessage}`);
    }

    if (context && context.project?.name && context.sessionId) {
      logger.info(
        `New session with context: ${context.project.name} (${context.sessionId})${providedSessionId ? ` (ID: ${providedSessionId})` : ''}`,
      );
    }

    // Include full context in config for session persistence
    const configWithContext: InboundConnectionConfig & { context?: Partial<ContextData> } = {
      ...config,
      context: context || undefined,
    };

    // Pass context to ServerManager
    const validContext =
      context && context.project && context.user && context.environment ? (context as ContextData) : undefined;

    try {
      await this.serverManager.connectTransport(transport, sessionId, configWithContext, validContext);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to connect transport ${sessionId}:`, error);
      throw new Error(`Session creation failed: connection error - ${errorMessage}`);
    }

    // Try to persist session to storage
    let persisted = false;
    let persistenceError: string | undefined;
    try {
      this.sessionRepository.create(sessionId, configWithContext);
      persisted = true;
    } catch (error) {
      persistenceError = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to persist session ${sessionId} to repository: ${persistenceError}`);
      // Continue anyway - transport is connected, just not persisted
    }

    // Initialize notifications
    this.initializeNotifications(sessionId);

    // Set up handlers
    this.setupTransportHandlers(transport, sessionId);

    return { transport, persisted, persistenceError } satisfies SessionCreateResult;
  }

  /**
   * Deletes a session and cleans up resources.
   *
   * Best-effort deletion: client is disconnecting anyway, so we log but don't throw.
   * The session will expire naturally via TTL if repository deletion fails.
   *
   * @param sessionId - The session ID to delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      this.sessionRepository.delete(sessionId);
    } catch (error) {
      // Best-effort deletion: client is disconnecting, so we log but don't throw
      // The session will expire naturally via TTL
      logError('Session deletion failed', {
        method: 'deleteSession',
        path: 'sessionService',
        sessionId,
        phase: 'session cleanup',
        error,
        context: { reason: 'Repository delete failed - session will expire via TTL' },
      });
    }
  }

  /**
   * Initializes async loading notifications for a session.
   *
   * This method should be called after connecting a transport to enable
   * the async orchestrator to send capability updates to the client.
   * Only applicable when async loading is enabled.
   *
   * @param sessionId - The session ID to initialize notifications for
   */
  private initializeNotifications(sessionId: string): void {
    if (this.asyncOrchestrator) {
      const inboundConnection = this.serverManager.getServer(sessionId);
      if (inboundConnection) {
        this.asyncOrchestrator.initializeNotifications(inboundConnection);
        logger.debug(`Async loading notifications initialized for Streamable HTTP session ${sessionId}`);
      }
    }
  }

  private setupTransportHandlers(
    transport: StreamableHTTPServerTransport | RestorableStreamableHTTPServerTransport,
    sessionId: string,
  ): void {
    transport.onclose = () => {
      // Only disconnect the transport, don't delete the session
      // Sessions persist across server restarts and are only deleted via explicit DELETE requests
      this.serverManager.disconnectTransport(sessionId);
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
}
