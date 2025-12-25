import { beforeEach, describe, expect, it } from 'vitest';

import { ClientInfoExtractor } from './clientInfoExtractor.js';

describe('ClientInfoExtractor', () => {
  beforeEach(() => {
    ClientInfoExtractor.reset();
  });

  describe('extractFromInitializeRequest', () => {
    it('should extract client info from valid initialize request', () => {
      const message = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'initialize' as const,
        params: {
          protocolVersion: '2025-06-18',
          capabilities: { roots: { listChanged: true } },
          clientInfo: {
            name: 'claude-code',
            version: '1.0.0',
            title: 'Claude Code',
          },
        },
      };

      const result = ClientInfoExtractor.extractFromInitializeRequest(message);

      expect(result).toEqual({
        name: 'claude-code',
        version: '1.0.0',
        title: 'Claude Code',
      });

      expect(ClientInfoExtractor.hasReceivedInitialize()).toBe(true);
      expect(ClientInfoExtractor.getExtractedClientInfo()).toEqual(result);
    });

    it('should extract client info without optional title', () => {
      const message = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'initialize' as const,
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'cursor',
            version: '0.28.3',
          },
        },
      };

      const result = ClientInfoExtractor.extractFromInitializeRequest(message);

      expect(result).toEqual({
        name: 'cursor',
        version: '0.28.3',
        title: undefined,
      });

      expect(ClientInfoExtractor.hasReceivedInitialize()).toBe(true);
    });

    it('should return null for non-initialize request', () => {
      const message = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'tools/list' as const,
        params: {},
      };

      const result = ClientInfoExtractor.extractFromInitializeRequest(message);

      expect(result).toBeNull();
      expect(ClientInfoExtractor.hasReceivedInitialize()).toBe(false);
    });

    it('should return null for initialize request without clientInfo', () => {
      const message = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'initialize' as const,
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
        },
      };

      const result = ClientInfoExtractor.extractFromInitializeRequest(message);

      expect(result).toBeNull();
      expect(ClientInfoExtractor.hasReceivedInitialize()).toBe(false);
    });

    it('should return null for invalid clientInfo structure', () => {
      const message = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'initialize' as const,
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            // Missing required fields
            title: 'Invalid Client',
          },
        },
      };

      const result = ClientInfoExtractor.extractFromInitializeRequest(message);

      expect(result).toBeNull();
      expect(ClientInfoExtractor.hasReceivedInitialize()).toBe(false);
    });

    it('should return null for message without method', () => {
      const message = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'tools/list' as const, // Non-initialize method
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'test',
            version: '1.0.0',
          },
        },
      };

      const result = ClientInfoExtractor.extractFromInitializeRequest(message);

      expect(result).toBeNull();
    });

    it('should return null for null message', () => {
      const result = ClientInfoExtractor.extractFromInitializeRequest(null as any);
      expect(result).toBeNull();
    });
  });

  describe('state management', () => {
    it('should reset state correctly', () => {
      const message = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'initialize' as const,
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      };

      // First extraction
      const result1 = ClientInfoExtractor.extractFromInitializeRequest(message);
      expect(result1).not.toBeNull();
      expect(ClientInfoExtractor.hasReceivedInitialize()).toBe(true);

      // Reset state
      ClientInfoExtractor.reset();

      // State should be reset
      expect(ClientInfoExtractor.hasReceivedInitialize()).toBe(false);
      expect(ClientInfoExtractor.getExtractedClientInfo()).toBeNull();

      // Should be able to extract again
      const result2 = ClientInfoExtractor.extractFromInitializeRequest(message);
      expect(result2).not.toBeNull();
    });

    it('should only extract once per initialize request', () => {
      const message = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'initialize' as const,
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      };

      // First extraction
      const result1 = ClientInfoExtractor.extractFromInitializeRequest(message);
      expect(result1).toEqual({
        name: 'test-client',
        version: '1.0.0',
      });

      // Second extraction should return null (already processed)
      const result2 = ClientInfoExtractor.extractFromInitializeRequest(message);
      expect(result2).toBeNull();
    });
  });

  describe('getExtractedClientInfo', () => {
    it('should return null initially', () => {
      expect(ClientInfoExtractor.getExtractedClientInfo()).toBeNull();
    });

    it('should return extracted client info after successful extraction', () => {
      const message = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'initialize' as const,
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'vscode',
            version: '1.85.0',
            title: 'Visual Studio Code',
          },
        },
      };

      ClientInfoExtractor.extractFromInitializeRequest(message);
      const result = ClientInfoExtractor.getExtractedClientInfo();

      expect(result).toEqual({
        name: 'vscode',
        version: '1.85.0',
        title: 'Visual Studio Code',
      });
    });
  });
});
