import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { InboundConnectionConfig } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionRestoreResult, SessionService } from './sessionService.js';

// Mock logger
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock dependencies
const mockServerManager = {
  getTransport: vi.fn(),
  connectTransport: vi.fn(),
  disconnectTransport: vi.fn(),
  getServer: vi.fn(),
};

const mockSessionRepository = {
  get: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  updateAccess: vi.fn(),
};

const mockAsyncOrchestrator = {
  initializeNotifications: vi.fn(),
} as any;

describe('SessionService', () => {
  let sessionService: SessionService;

  beforeEach(() => {
    vi.resetAllMocks();
    sessionService = new SessionService(mockServerManager as any, mockSessionRepository as any, mockAsyncOrchestrator);
  });

  describe('constructor', () => {
    it('should create session service with dependencies', () => {
      expect(sessionService).toBeDefined();
    });
  });

  describe('getSession', () => {
    it('should return null for invalid sessionId', async () => {
      const result = await sessionService.getSession('');
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only sessionId', async () => {
      const result = await sessionService.getSession('   ');
      expect(result).toBeNull();
    });

    it('should return existing transport of correct type', async () => {
      const mockTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => 'existing-session',
      });
      mockServerManager.getTransport.mockReturnValue(mockTransport);

      const result = await sessionService.getSession('existing-session');

      expect(result).toBe(mockTransport);
      expect(mockSessionRepository.updateAccess).toHaveBeenCalledWith('existing-session');
    });

    it('should return null for existing transport of wrong type', async () => {
      mockServerManager.getTransport.mockReturnValue({ wrong: 'type' });

      const result = await sessionService.getSession('stdio-session');

      expect(result).toBeNull();
    });

    it('should attempt to restore session when transport not found', async () => {
      mockServerManager.getTransport.mockReturnValue(null);
      mockSessionRepository.get.mockReturnValue(null);

      const result = await sessionService.getSession('non-existent-session');

      expect(result).toBeNull();
      expect(mockSessionRepository.get).toHaveBeenCalledWith('non-existent-session');
    });
  });

  describe('restoreSession', () => {
    it('should return not_found result when session does not exist', async () => {
      mockSessionRepository.get.mockReturnValue(null);

      const result = await sessionService.restoreSession('non-existent-session');

      expect(result).toEqual({
        transport: null,
        errorType: 'not_found',
      });
    });

    it('should return connection_failed when connectTransport fails', async () => {
      const mockSessionData = {
        tags: [],
        enablePagination: false,
      };
      mockSessionRepository.get.mockReturnValue(mockSessionData);
      mockServerManager.connectTransport.mockRejectedValue(new Error('Connection failed'));

      const result = await sessionService.restoreSession('test-session');

      expect(result.transport).toBeNull();
      expect(result.errorType).toBe('connection_failed');
      expect(result.error).toBe('Connection failed');
    });

    it('should successfully restore session with valid data', async () => {
      const mockSessionData = {
        tags: ['test-tag'],
        enablePagination: true,
        context: {
          project: { name: 'test-project' },
          user: { username: 'testuser' },
          environment: { variables: {} },
          sessionId: 'test-session',
          timestamp: new Date().toISOString(),
        },
      };
      mockSessionRepository.get.mockReturnValue(mockSessionData);
      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      const result = await sessionService.restoreSession('test-session');

      expect(result.transport).toBeDefined();
      expect(result.transport).not.toBeNull();
      expect(mockServerManager.connectTransport).toHaveBeenCalled();
      expect(mockSessionRepository.updateAccess).toHaveBeenCalledWith('test-session');
    });

    it('should handle missing context gracefully', async () => {
      const mockSessionData = {
        tags: [],
        enablePagination: false,
      };
      mockSessionRepository.get.mockReturnValue(mockSessionData);
      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      const result = await sessionService.restoreSession('test-session');

      expect(result.transport).toBeDefined();
      expect(mockServerManager.connectTransport).toHaveBeenCalled();
    });

    it('should convert partial context to ContextData format', async () => {
      const mockSessionData = {
        tags: [],
        enablePagination: false,
        context: {
          project: { name: 'my-project' },
          user: { username: 'user1' },
          environment: { variables: { NODE_ENV: 'test' } },
        },
      };
      mockSessionRepository.get.mockReturnValue(mockSessionData);
      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      const result = await sessionService.restoreSession('test-session');

      expect(result.transport).toBeDefined();
      expect(mockServerManager.connectTransport).toHaveBeenCalledWith(
        expect.anything(),
        'test-session',
        mockSessionData,
        expect.objectContaining({
          project: { name: 'my-project' },
          user: { username: 'user1' },
          environment: { variables: { NODE_ENV: 'test' } },
          sessionId: 'test-session',
        }),
      );
    });

    it('should initialize notifications for restored session', async () => {
      const mockSessionData = { tags: [], enablePagination: false };
      mockSessionRepository.get.mockReturnValue(mockSessionData);
      mockServerManager.getServer.mockReturnValue({ status: 'ready' });
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      await sessionService.restoreSession('test-session');

      expect(mockAsyncOrchestrator.initializeNotifications).toHaveBeenCalled();
    });

    it('should set up transport handlers for restored session', async () => {
      const mockSessionData = { tags: [], enablePagination: false };
      mockSessionRepository.get.mockReturnValue(mockSessionData);
      mockServerManager.getServer.mockReturnValue({ status: 'ready' });
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      const result = await sessionService.restoreSession('test-session');

      expect(result.transport).toBeDefined();
      expect(result.transport).toHaveProperty('onclose');
      expect(result.transport).toHaveProperty('onerror');
    });
  });

  describe('createSession', () => {
    it('should create session with generated sessionId', async () => {
      const config: InboundConnectionConfig = {
        tags: ['test-tag'],
        enablePagination: false,
      };

      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      const result = await sessionService.createSession(config);

      expect(result).toBeDefined();
      expect(mockSessionRepository.create).toHaveBeenCalled();
    });

    it('should create session with provided sessionId', async () => {
      const config: InboundConnectionConfig = {
        tags: [],
        enablePagination: false,
      };

      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      const result = await sessionService.createSession(config, undefined, 'custom-session-id');

      expect(result).toBeDefined();
      expect(mockSessionRepository.create).toHaveBeenCalledWith('custom-session-id', expect.anything());
    });

    it('should throw error when connectTransport fails', async () => {
      const config: InboundConnectionConfig = {
        tags: [],
        enablePagination: false,
      };

      mockServerManager.connectTransport.mockRejectedValue(new Error('Connection error'));

      await expect(sessionService.createSession(config)).rejects.toThrow(
        'Session creation failed: connection error - Connection error',
      );
    });

    it('should continue when repository create fails', async () => {
      const config: InboundConnectionConfig = {
        tags: [],
        enablePagination: false,
      };

      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);
      mockSessionRepository.create.mockImplementation(() => {
        throw new Error('Storage failed');
      });

      const result = await sessionService.createSession(config);

      // Should still succeed, just log warning
      expect(result).toBeDefined();
    });

    it('should persist session context', async () => {
      const config: InboundConnectionConfig = {
        tags: [],
        enablePagination: false,
      };
      const context = {
        project: { name: 'my-project' },
        user: { username: 'user1' },
        environment: { variables: {} },
        sessionId: 'client-session-id',
        timestamp: new Date().toISOString(),
      };

      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      await sessionService.createSession(config, context);

      expect(mockSessionRepository.create).toHaveBeenCalledWith(
        expect.stringMatching(/^stream-/), // Generated sessionId starts with 'stream-'
        expect.objectContaining({
          context,
        }),
      );
    });

    it('should initialize notifications for new session', async () => {
      const config: InboundConnectionConfig = {
        tags: [],
        enablePagination: false,
      };

      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      await sessionService.createSession(config);

      expect(mockAsyncOrchestrator.initializeNotifications).toHaveBeenCalled();
    });

    it('should set up transport handlers for new session', async () => {
      const config: InboundConnectionConfig = {
        tags: [],
        enablePagination: false,
      };

      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      const result = await sessionService.createSession(config);

      expect(result).toHaveProperty('onclose');
      expect(result).toHaveProperty('onerror');
    });
  });

  describe('deleteSession', () => {
    it('should delete session from repository', async () => {
      await sessionService.deleteSession('test-session');

      expect(mockSessionRepository.delete).toHaveBeenCalledWith('test-session');
    });

    it('should log error when repository delete fails', async () => {
      mockSessionRepository.delete.mockImplementation(() => {
        throw new Error('Delete failed');
      });

      await expect(sessionService.deleteSession('test-session')).resolves.not.toThrow();
    });
  });

  describe('SessionRestoreResult type', () => {
    it('should return not_found error type for missing sessions', async () => {
      mockSessionRepository.get.mockReturnValue(null);

      const result: SessionRestoreResult = await sessionService.restoreSession('missing-session');

      expect(result).toHaveProperty('transport', null);
      expect(result).toHaveProperty('errorType', 'not_found');
    });

    it('should return transport_failed error type for transport errors', async () => {
      mockSessionRepository.get.mockReturnValue({});
      mockServerManager.connectTransport.mockRejectedValue(new Error('Transport error'));

      const result: SessionRestoreResult = await sessionService.restoreSession('test-session');

      expect(result).toHaveProperty('transport', null);
      expect(result).toHaveProperty('errorType', 'connection_failed');
      expect(result).toHaveProperty('error');
    });

    it('should return transport on success', async () => {
      mockSessionRepository.get.mockReturnValue({ tags: [], enablePagination: false });
      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      const result: SessionRestoreResult = await sessionService.restoreSession('test-session');

      expect(result).toHaveProperty('transport');
      expect(result.transport).not.toBeNull();
      expect(result).not.toHaveProperty('error');
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in sessionId', async () => {
      const specialSessionId = 'session-with-special-chars-!@#$%';
      mockServerManager.getTransport.mockReturnValue(null);
      mockSessionRepository.get.mockReturnValue(null);

      const result = await sessionService.getSession(specialSessionId);

      expect(result).toBeNull();
    });

    it('should handle very long sessionIds', async () => {
      const longSessionId = 'a'.repeat(1000);
      mockServerManager.getTransport.mockReturnValue(null);
      mockSessionRepository.get.mockReturnValue(null);

      const result = await sessionService.getSession(longSessionId);

      expect(result).toBeNull();
    });

    it('should handle concurrent session requests', async () => {
      const mockSessionData = { tags: [], enablePagination: false };
      mockSessionRepository.get.mockReturnValue(mockSessionData);
      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      const promises = [
        sessionService.getSession('session-1'),
        sessionService.getSession('session-2'),
        sessionService.getSession('session-3'),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
    });
  });

  describe('integration scenarios', () => {
    it('should handle full session lifecycle', async () => {
      // Create session
      const config: InboundConnectionConfig = {
        tags: ['lifecycle-test'],
        enablePagination: false,
      };
      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      const createdTransport = await sessionService.createSession(config);

      expect(createdTransport).toBeDefined();
      expect(mockSessionRepository.create).toHaveBeenCalled();

      // Get session (simulates reconnect)
      mockServerManager.getTransport.mockReturnValue(createdTransport);

      const retrievedTransport = await sessionService.getSession('test-session');

      expect(retrievedTransport).toBe(createdTransport);

      // Delete session
      await sessionService.deleteSession('test-session');

      expect(mockSessionRepository.delete).toHaveBeenCalledWith('test-session');
    });

    it('should handle session restoration failure fallback', async () => {
      // Simulate restoration failure
      mockServerManager.getTransport.mockReturnValue(null);
      mockSessionRepository.get.mockReturnValue(null);

      const result = await sessionService.getSession('non-existent-session');

      expect(result).toBeNull();

      // Verify that caller would need to create new session
      const config: InboundConnectionConfig = {
        tags: [],
        enablePagination: false,
      };
      mockServerManager.getServer.mockReturnValue({});
      mockServerManager.connectTransport.mockResolvedValue(undefined);

      const newTransport = await sessionService.createSession(config, undefined, 'non-existent-session');

      expect(newTransport).toBeDefined();
    });
  });
});
