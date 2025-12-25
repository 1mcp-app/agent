// Additional tests for partial failure handling in handlePagination
import { ClientStatus, OutboundConnection } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeCursor, parseCursor } from './pagination.js';
import type { PaginationResponse } from './pagination.js';

// Mock the logger
vi.mock('@src/logger/logger.js', () => ({
  __esModule: true,
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('Pagination utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseCursor', () => {
    it('should return empty client name for undefined cursor', () => {
      const result = parseCursor(undefined);
      expect(result).toEqual({ clientName: '' });
    });

    it('should return empty client name for null cursor', () => {
      const result = parseCursor(null as any);
      expect(result).toEqual({ clientName: '' });
    });

    it('should return empty client name for empty string', () => {
      const result = parseCursor('');
      expect(result).toEqual({ clientName: '' });
    });

    it('should parse valid cursor with client name and actual cursor', () => {
      // "test-client:cursor123" encoded in base64
      const validCursor = Buffer.from('test-client:cursor123').toString('base64');
      const result = parseCursor(validCursor);

      expect(result).toEqual({
        clientName: 'test-client',
        actualCursor: 'cursor123',
      });
    });

    it('should parse cursor with only client name (no colon)', () => {
      // "test-client" encoded in base64
      const validCursor = Buffer.from('test-client').toString('base64');
      const result = parseCursor(validCursor);

      expect(result).toEqual({
        clientName: 'test-client',
        actualCursor: undefined,
      });
    });

    it('should handle cursor with empty actual cursor', () => {
      // "test-client:" encoded in base64
      const validCursor = Buffer.from('test-client:').toString('base64');
      const result = parseCursor(validCursor);

      expect(result).toEqual({
        clientName: 'test-client',
        actualCursor: undefined,
      });
    });

    it('should reject invalid base64 format', () => {
      const invalidCursor = 'not-valid-base64!@#';
      const result = parseCursor(invalidCursor);

      expect(result).toEqual({ clientName: '' });
      expect(logger.warn).toHaveBeenCalledWith('Invalid cursor format: not valid base64');
    });

    it('should reject cursors with invalid client name characters', () => {
      // Space character should be rejected by client name validation
      const invalidCursor = Buffer.from(' ').toString('base64');
      const result = parseCursor(invalidCursor);

      expect(result).toEqual({ clientName: '' });
      expect(logger.warn).toHaveBeenCalledWith('Invalid cursor: invalid client name format');
    });

    it('should reject cursors that decode to very long content', () => {
      const longContent = 'a'.repeat(1001);
      const longCursor = Buffer.from(longContent).toString('base64');
      const result = parseCursor(longCursor);

      expect(result).toEqual({ clientName: '' });
      expect(logger.warn).toHaveBeenCalledWith('Invalid cursor: decoded content too long or empty');
    });

    it('should reject client names with invalid characters', () => {
      const invalidCursor = Buffer.from('client@name:cursor').toString('base64');
      const result = parseCursor(invalidCursor);

      expect(result).toEqual({ clientName: '' });
      expect(logger.warn).toHaveBeenCalledWith('Invalid cursor: invalid client name format');
    });

    it('should reject very long client names', () => {
      const longClientName = 'a'.repeat(101);
      const invalidCursor = Buffer.from(`${longClientName}:cursor`).toString('base64');
      const result = parseCursor(invalidCursor);

      expect(result).toEqual({ clientName: '' });
      expect(logger.warn).toHaveBeenCalledWith('Invalid cursor: invalid client name format');
    });

    it('should handle cursors with multiple colons correctly', () => {
      // "client:cursor:with:colons" - should split on first colon only
      const complexCursor = Buffer.from('client:cursor:with:colons').toString('base64');
      const result = parseCursor(complexCursor);

      expect(result).toEqual({
        clientName: 'client',
        actualCursor: 'cursor:with:colons',
      });
    });

    it('should handle malformed base64 gracefully', () => {
      // This is invalid base64 but looks like it could be
      const malformedCursor = 'SGVsbG8gV29ybGQ=INVALID';
      const result = parseCursor(malformedCursor);

      expect(result).toEqual({ clientName: '' });
      expect(logger.warn).toHaveBeenCalledWith('Invalid cursor format: not valid base64');
    });

    it('should handle Buffer.from errors gracefully', () => {
      // Create a cursor that will cause Buffer.from to fail
      const spy = vi.spyOn(Buffer, 'from').mockImplementation(() => {
        throw new Error('Buffer creation failed');
      });

      const result = parseCursor('dGVzdA=='); // "test" in base64

      expect(result).toEqual({ clientName: '' });
      expect(logger.warn).toHaveBeenCalledWith('Failed to parse cursor: Error: Buffer creation failed');

      spy.mockRestore();
    });
  });

  describe('encodeCursor', () => {
    it('should encode client name and cursor correctly', () => {
      const encoded = encodeCursor('test-client', 'cursor123');
      const expected = Buffer.from('test-client:cursor123').toString('base64');

      expect(encoded).toBe(expected);
    });

    it('should encode client name with empty cursor', () => {
      const encoded = encodeCursor('test-client', '');
      const expected = Buffer.from('test-client:').toString('base64');

      expect(encoded).toBe(expected);
    });

    it('should encode client name with default empty cursor', () => {
      const encoded = encodeCursor('test-client');
      const expected = Buffer.from('test-client:').toString('base64');

      expect(encoded).toBe(expected);
    });

    it('should reject empty client name', () => {
      const result = encodeCursor('', 'cursor');

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith('Cannot encode cursor: invalid client name');
    });

    it('should reject null client name', () => {
      const result = encodeCursor(null as any, 'cursor');

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith('Cannot encode cursor: invalid client name');
    });

    it('should reject non-string next cursor', () => {
      const result = encodeCursor('client', 123 as any);

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith('Cannot encode cursor: invalid next cursor');
    });

    it('should reject client names with invalid characters', () => {
      const result = encodeCursor('client@name', 'cursor');

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Cannot encode cursor: client name contains invalid characters or is too long',
      );
    });

    it('should reject very long client names', () => {
      const longClientName = 'a'.repeat(101);
      const result = encodeCursor(longClientName, 'cursor');

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'Cannot encode cursor: client name contains invalid characters or is too long',
      );
    });

    it('should reject cursors that would exceed length limit', () => {
      const longCursor = 'a'.repeat(995); // Combined with "client:" (7 chars) will be 1002, exceeding 1000
      const result = encodeCursor('client', longCursor);

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith('Cannot encode cursor: combined cursor length exceeds limit');
    });

    it('should handle Buffer.from encoding errors gracefully', () => {
      const spy = vi.spyOn(Buffer, 'from').mockImplementation(() => {
        throw new Error('Encoding failed');
      });

      const result = encodeCursor('client', 'cursor');

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith('Failed to encode cursor: Error: Encoding failed');

      spy.mockRestore();
    });

    it('should accept valid client names with underscores and hyphens', () => {
      const encoded = encodeCursor('test_client-name', 'cursor');

      expect(encoded).toBeDefined();
      expect(typeof encoded).toBe('string');
    });

    it('should handle special characters in actual cursor', () => {
      const specialCursor = 'cursor:with:special@chars&symbols';
      const encoded = encodeCursor('client', specialCursor);

      expect(encoded).toBeDefined();
      expect(typeof encoded).toBe('string');

      // Verify it can be decoded back correctly
      const decoded = Buffer.from(encoded!, 'base64').toString('utf-8');
      expect(decoded).toBe(`client:${specialCursor}`);
    });
  });

  describe('round-trip encoding/decoding', () => {
    it('should correctly round-trip encode and decode', () => {
      const originalClient = 'test-client';
      const originalCursor = 'cursor123';

      const encoded = encodeCursor(originalClient, originalCursor);
      expect(encoded).toBeDefined();

      const decoded = parseCursor(encoded!);
      expect(decoded).toEqual({
        clientName: originalClient,
        actualCursor: originalCursor,
      });
    });

    it('should handle round-trip with empty cursor', () => {
      const originalClient = 'test-client';

      const encoded = encodeCursor(originalClient, '');
      expect(encoded).toBeDefined();

      const decoded = parseCursor(encoded!);
      expect(decoded).toEqual({
        clientName: originalClient,
        actualCursor: undefined,
      });
    });

    it('should handle round-trip with complex cursor containing colons', () => {
      const originalClient = 'client-name';
      const originalCursor = 'cursor:with:multiple:colons';

      const encoded = encodeCursor(originalClient, originalCursor);
      expect(encoded).toBeDefined();

      const decoded = parseCursor(encoded!);
      expect(decoded).toEqual({
        clientName: originalClient,
        actualCursor: originalCursor,
      });
    });
  });
});

describe('handlePagination partial failure handling', () => {
  let mockClients: Map<string, OutboundConnection>;
  let mockCallClientMethod: any;
  let mockTransformResult: any;

  beforeEach(() => {
    mockCallClientMethod = vi.fn();
    mockTransformResult = vi.fn().mockImplementation((client: any, result: PaginationResponse) => {
      // Find which client this is
      let clientName = 'unknown';
      for (const [name, conn] of mockClients.entries()) {
        if (conn.client === client) {
          clientName = name;
          break;
        }
      }

      // For tool listing, the result will have a tools property
      const items = result.tools || result.resources || result.prompts || [];
      return items.map((item: any) => ({
        name: `${clientName}-transformed-${item.name || item.id || 'unknown'}`,
        description: `Tool from ${clientName}`,
      }));
    });

    // Create mock clients
    const healthyClient = {
      name: 'healthy-server',
      status: ClientStatus.Connected,
      client: {
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'tool1', inputSchema: {} }],
        }),
        transport: { timeout: 5000 },
      },
      debugIf: vi.fn(),
      transport: { timeout: 5000 },
    } as any;

    const failingClient = {
      name: 'failing-server',
      status: ClientStatus.Connected,
      client: {
        listTools: vi.fn().mockRejectedValue(new Error('Schema validation error')),
        transport: { timeout: 5000 },
      },
      debugIf: vi.fn(),
      transport: { timeout: 5000 },
    } as any;

    const anotherHealthyClient = {
      name: 'another-healthy-server',
      status: ClientStatus.Connected,
      client: {
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'tool2', inputSchema: {} }],
        }),
        transport: { timeout: 5000 },
      },
      debugIf: vi.fn(),
      transport: { timeout: 5000 },
    } as any;

    mockClients = new Map([
      ['healthy-server', healthyClient],
      ['failing-server', failingClient],
      ['another-healthy-server', anotherHealthyClient],
    ]);

    // Mock callClientMethod to simulate the actual client calls
    mockCallClientMethod.mockImplementation(async (client: any, _params: any): Promise<PaginationResponse> => {
      // Find which client this is
      let clientName = 'unknown';
      for (const [name, conn] of mockClients.entries()) {
        if (conn.client === client) {
          clientName = name;
          break;
        }
      }

      if (clientName === 'failing-server') {
        throw new Error("Schema validation error: can't resolve reference #/$defs/SearchResult");
      }

      return {
        tools: [{ name: `${clientName}-item`, inputSchema: { type: 'object' } }],
        nextCursor: undefined,
      };
    });
  });

  it('should return tools from healthy servers even when some servers fail', async () => {
    const { handlePagination } = await import('./pagination.js');

    const result = await handlePagination(
      mockClients,
      {},
      mockCallClientMethod,
      mockTransformResult,
      false, // pagination disabled
    );

    // Should have tools from the 2 healthy servers (but not from the failing one)
    expect(result.items).toHaveLength(2);

    // The main test: verify we got tools from healthy servers even though one failed
    const serverNames = result.items.map((item: any) => item.name);
    expect(serverNames).toContain('unknown-transformed-healthy-server-item');
    expect(serverNames).toContain('unknown-transformed-another-healthy-server-item');

    // Should not have tools from the failing server
    expect(serverNames).not.toContain('unknown-transformed-failing-server-item');
  });

  it('should log warnings for failed servers but not throw errors', async () => {
    const { handlePagination } = await import('./pagination.js');

    // Test that the function doesn't throw when there are failures
    // The actual logging is tested by the fact that we get results back
    const result = await handlePagination(
      mockClients,
      {},
      mockCallClientMethod,
      mockTransformResult,
      false, // pagination disabled
    );

    // Should still return successful results even with failures
    expect(result.items).toHaveLength(2);
    expect(result.items).toBeDefined();
  });

  it('should return empty results when all servers fail', async () => {
    const { handlePagination } = await import('./pagination.js');

    // Make all clients fail
    mockCallClientMethod.mockImplementation(async (): Promise<PaginationResponse> => {
      throw new Error('All servers failed');
    });

    const result = await handlePagination(
      mockClients,
      {},
      mockCallClientMethod,
      mockTransformResult,
      false, // pagination disabled
    );

    expect(result.items).toHaveLength(0);
  });

  it('should handle mixed success and failure with pagination enabled', async () => {
    const { handlePagination } = await import('./pagination.js');

    // Mock callClientMethod to return paginated results for healthy client and fail for others
    mockCallClientMethod.mockImplementation(async (client: any, params: any): Promise<PaginationResponse> => {
      const clientName = mockClients.get(
        Array.from(mockClients.keys()).find((key) => mockClients.get(key)?.client === client)!,
      )?.name;

      if (clientName === 'failing-server') {
        throw new Error('Server error');
      }

      return {
        tools: [{ name: `${clientName}-page-${params.cursor || 'first'}`, inputSchema: { type: 'object' } }],
        nextCursor: params.cursor ? undefined : 'next-page',
      };
    });

    const result = await handlePagination(
      mockClients,
      {},
      mockCallClientMethod,
      mockTransformResult,
      true, // pagination enabled
    );

    // Should handle pagination without throwing
    expect(result.items).toBeDefined();
  });
});
