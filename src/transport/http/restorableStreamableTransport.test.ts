import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RestorableStreamableHTTPServerTransport } from './restorableStreamableTransport.js';

// Mock the MCP SDK transport
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class extends class {} {
    onclose: null;
    onerror: null;
    handleRequest: any;
    _requestContext: WeakMap<object, unknown>;
    _sessionId: string;
    _requestListener: any;

    constructor(options: { sessionIdGenerator?: () => string } = {}) {
      super();
      const sessionIdValue = options.sessionIdGenerator?.() || 'mock-session-id';

      // Set properties on this instance
      this.onclose = null;
      this.onerror = null;
      this.handleRequest = vi.fn().mockResolvedValue(undefined);
      this._requestContext = new WeakMap();
      this._sessionId = sessionIdValue;
      this._requestListener = vi.fn();

      // Make sessionId a getter that returns _sessionId
      Object.defineProperty(this, 'sessionId', {
        get() {
          return this._sessionId;
        },
        enumerable: true,
        configurable: true,
      });
    }
  },
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

      expect(transport).toBeDefined();
    });

    it('should initialize with restored flag as false', () => {
      transport = new RestorableStreamableHTTPServerTransport(mockOptions);

      expect(transport.isRestored()).toBe(false);
    });
  });

  describe('markAsRestored', () => {
    beforeEach(() => {
      transport = new RestorableStreamableHTTPServerTransport(mockOptions);
    });

    it('should mark transport as restored', () => {
      expect(transport.isRestored()).toBe(false);

      transport.markAsRestored();

      expect(transport.isRestored()).toBe(true);
    });

    it('should be idempotent', () => {
      transport.markAsRestored();
      transport.markAsRestored();

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

    it('should return true after markAsRestored is called', () => {
      transport.markAsRestored();

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
        sessionId: 'test-session-id',
      });
    });

    it('should return restoration info for restored transport', () => {
      transport.markAsRestored();

      const info = transport.getRestorationInfo();

      expect(info).toEqual({
        isRestored: true,
        sessionId: 'test-session-id',
      });
    });

    it('should return sessionId from parent class', () => {
      const info = transport.getRestorationInfo();

      expect(info.sessionId).toBe('test-session-id');
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

  describe('sessionId from sessionIdGenerator', () => {
    it('should use sessionIdGenerator to set sessionId', () => {
      transport = new RestorableStreamableHTTPServerTransport({
        sessionIdGenerator: () => 'custom-session-id',
      });

      expect(transport.sessionId).toBe('custom-session-id');
    });

    it('should return sessionId provided by generator', () => {
      const storedSessionId = 'restored-session-abc123';
      transport = new RestorableStreamableHTTPServerTransport({
        sessionIdGenerator: () => storedSessionId,
      });

      expect(transport.sessionId).toBe(storedSessionId);
    });
  });
});
