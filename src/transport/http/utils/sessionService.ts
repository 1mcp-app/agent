import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { InitializeResponseData } from '@src/auth/sessionTypes.js';
import { AsyncLoadingOrchestrator } from '@src/core/capabilities/asyncLoadingOrchestrator.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { InboundConnectionConfig } from '@src/core/types/index.js';
import { RestorableStreamableHTTPServerTransport } from '@src/transport/http/restorableStreamableTransport.js';
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import {
  StreamableSessionCreateResult,
  StreamableSessionLifecycle,
  StreamableSessionRestoreResult,
} from '@src/transport/http/streamableSessionLifecycle.js';
import type { ContextData } from '@src/types/context.js';

/**
 * @deprecated Use StreamableSessionLifecycle. This wrapper remains for callers
 * that have not migrated off the old SessionService name yet.
 */
export type SessionRestoreResult = StreamableSessionRestoreResult;

/**
 * @deprecated Use StreamableSessionLifecycle. This wrapper remains for callers
 * that have not migrated off the old SessionService name yet.
 */
export type SessionCreateResult = Omit<StreamableSessionCreateResult, 'status' | 'sessionId'>;

/**
 * @deprecated Streamable Transport Session Lifecycle now owns transport
 * continuity. New code should depend on StreamableSessionLifecycle directly.
 */
export class SessionService {
  private lifecycle: StreamableSessionLifecycle;

  constructor(
    serverManager: ServerManager,
    sessionRepository: StreamableSessionRepository,
    asyncOrchestrator?: AsyncLoadingOrchestrator,
  ) {
    this.lifecycle = new StreamableSessionLifecycle(serverManager, sessionRepository, asyncOrchestrator);
  }

  async getSession(
    sessionId: string,
  ): Promise<StreamableHTTPServerTransport | RestorableStreamableHTTPServerTransport | null> {
    return this.lifecycle.getSession(sessionId);
  }

  storeInitializeResponse(sessionId: string, initializeResponse: InitializeResponseData): void {
    this.lifecycle.storeInitializeResponse(sessionId, initializeResponse);
  }

  async restoreSession(sessionId: string): Promise<SessionRestoreResult> {
    return this.lifecycle.restoreSession(sessionId);
  }

  async createSession(
    config: InboundConnectionConfig,
    context?: Partial<ContextData>,
    providedSessionId?: string,
  ): Promise<SessionCreateResult> {
    const result = await this.lifecycle.createSession(config, context, providedSessionId);
    return {
      transport: result.transport,
      persisted: result.persisted,
      persistenceError: result.persistenceError,
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.lifecycle.completeExplicitDelete(sessionId);
  }
}
