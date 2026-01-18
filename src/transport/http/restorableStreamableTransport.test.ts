import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RestorableStreamableHTTPServerTransport } from './restorableStreamableTransport.js';

// Mock the MCP SDK transport
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation((options) => {
    const sessionIdValue = options?.sessionIdGenerator?.() || 'mock-session-id';
    // Create _webStandardTransport first
    const webStandardTransport = {
      sessionId: sessionIdValue,
    };

    const transport = {
      onclose: null,
      onerror: null,
      handleRequest: vi.fn().mockResolvedValue(undefined),
      _initialized: false, // Mock the private field - will be set to true by markAsInitialized
      // Mock _webStandardTransport for testing setSessionId()
      _webStandardTransport: webStandardTransport,
    };

    // Make sessionId a getter that delegates to _webStandardTransport.sessionId
    // This simulates the real SDK's behavior
    Object.defineProperty(transport, 'sessionId', {
      get() {
        return this._webStandardTransport?.sessionId;
      },
      set(value: string) {
        if (this._webStandardTransport) {
          this._webStandardTransport.sessionId = value;
        }
      },
      enumerable: true,
      configurable: true,
    });

    // Make _initialized property writable so it can be updated by markAsInitialized
    Object.defineProperty(transport, '_initialized', {
      value: false,
      writable: true,
      enumerable: true,
      configurable: true,
    });

    // Make _webStandardTransport.sessionId writable
    Object.defineProperty(webStandardTransport, 'sessionId', {
      value: sessionIdValue,
      writable: true,
      enumerable: true,
      configurable: true,
    });

    return transport;
  }),
}));

// Mock logger
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('RestorableStreamableHTTPServerTransport', () => {
  let mockOptions: any;
  let transport: RestorableStreamableHTTPServerTransport;

  beforeEach(() => {
    vi.resetAllMocks();
    mockOptions = {
      sessionIdGenerator: () => 'test-session-id',
    };
  });

  describe('constructor', () => {
    it('should create transport with valid options', () => {
      transport = new RestorableStreamableHTTPServerTransport(mockOptions);

      expect(StreamableHTTPServerTransport).toHaveBeenCalledWith(mockOptions);
      expect(transport).toBeDefined();
    });

    it('should initialize with restored flag as false', () => {
      transport = new RestorableStreamableHTTPServerTransport(mockOptions);

      expect(transport.isRestored()).toBe(false);
    });
  });

  describe('markAsInitialized', () => {
    beforeEach(() => {
      transport = new RestorableStreamableHTTPServerTransport(mockOptions);
    });

    it('should mark transport as initialized and restored', () => {
      const result = transport.markAsInitialized();

      expect(result.success).toBe(true);
      expect(transport.isRestored()).toBe(true);
      expect(transport.getRestorationInfo().isRestored).toBe(true);
    });

    it('should preserve sessionId from construction', () => {
      const sessionId = transport.sessionId;
      const result = transport.markAsInitialized();

      expect(result.success).toBe(true);
      expect(transport.sessionId).toBe(sessionId);
      expect(transport.isRestored()).toBe(true);
    });
  });

  describe('isRestored', () => {
    beforeEach(() => {
      transport = new RestorableStreamableHTTPServerTransport(mockOptions);
    });

    it('should return false initially', () => {
      expect(transport.isRestored()).toBe(false);
    });

    it('should return true after markAsInitialized', () => {
      transport.markAsInitialized();
      expect(transport.isRestored()).toBe(true);
    });
  });

  describe('getRestorationInfo', () => {
    beforeEach(() => {
      transport = new RestorableStreamableHTTPServerTransport(mockOptions);
    });

    it('should return restoration info for non-restored transport', () => {
      const info = transport.getRestorationInfo();

      expect(info).toEqual({
        isRestored: false,
        sessionId: transport.sessionId,
      });
    });

    it('should return restoration info for restored transport', () => {
      transport.markAsInitialized();
      const info = transport.getRestorationInfo();

      expect(info).toEqual({
        isRestored: true,
        sessionId: transport.sessionId,
      });
    });

    it('should return sessionId when available', () => {
      const info = transport.getRestorationInfo();

      expect(info).toEqual({
        isRestored: false,
        sessionId: transport.sessionId,
      });
    });
  });

  describe('inheritance', () => {
    beforeEach(() => {
      transport = new RestorableStreamableHTTPServerTransport(mockOptions);
    });

    it('should be instance of StreamableHTTPServerTransport', () => {
      expect(transport).toBeInstanceOf(StreamableHTTPServerTransport);
    });

    it('should be instance of RestorableStreamableHTTPServerTransport', () => {
      expect(transport).toBeInstanceOf(RestorableStreamableHTTPServerTransport);
    });
  });

  describe('session restoration workflow', () => {
    it('should complete full restoration workflow', () => {
      transport = new RestorableStreamableHTTPServerTransport({
        sessionIdGenerator: () => 'restored-session-123',
      });

      // Verify initial state
      expect(transport.isRestored()).toBe(false);

      // Perform restoration flow
      transport.markAsInitialized();

      // Verify restored state using public interface
      expect(transport.isRestored()).toBe(true);

      const info = transport.getRestorationInfo();
      expect(info.isRestored).toBe(true);
    });
  });

  describe('OperationResult type', () => {
    beforeEach(() => {
      transport = new RestorableStreamableHTTPServerTransport(mockOptions);
    });

    it('should return OperationResult with success true on successful markAsInitialized', () => {
      const result = transport.markAsInitialized();

      expect(result).toHaveProperty('success', true);
      expect(result).not.toHaveProperty('error');
    });
  });
});
