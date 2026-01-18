import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { AUTH_CONFIG } from '@src/constants.js';
import { AsyncLoadingOrchestrator } from '@src/core/capabilities/asyncLoadingOrchestrator.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { InboundConnectionConfig, ServerStatus } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { RestorableStreamableHTTPServerTransport } from '@src/transport/http/restorableStreamableTransport.js';
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import type { ContextData } from '@src/types/context.js';

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
   * Restores a session from persistent storage.
   *
   * @param sessionId - The session ID to restore
   * @returns SessionRestoreResult with transport or error details
   */
  async restoreSession(sessionId: string): Promise<SessionRestoreResult> {
    try {
      const sessionData = this.sessionRepository.get(sessionId);
      if (!sessionData) {
        logger.debug(`No persisted session found for: ${sessionId}`);
        return { transport: null, errorType: 'not_found' };
      }

      const config = sessionData;
      logger.info(`Restoring streamable session: ${sessionId}`);

      // Create new transport with the original session ID using wrapper class
      const transport = new RestorableStreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });

      // Mark the transport as initialized for restored session
      const initResult = transport.markAsInitialized();
      if (!initResult.success) {
        logger.warn(`Failed to mark transport ${sessionId} as initialized: ${initResult.error}`);
        return { transport: null, error: initResult.error, errorType: 'transport_failed' };
      }

      // Set the sessionId for the restored session
      const setSessionResult = transport.setSessionId(sessionId);
      if (!setSessionResult.success) {
        logger.warn(`Failed to set sessionId ${sessionId}: ${setSessionResult.error}`);
        return { transport: null, error: setSessionResult.error, errorType: 'transport_failed' };
      }

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
   * @param sessionId - The session ID to delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      this.sessionRepository.delete(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to delete session ${sessionId} from repository: ${errorMessage}`);
      // Consider: should this throw? Or is best-effort deletion acceptable?
      // At minimum, the error is logged for monitoring
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
      this.serverManager.disconnectTransport(sessionId);
      this.sessionRepository.delete(sessionId);
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
