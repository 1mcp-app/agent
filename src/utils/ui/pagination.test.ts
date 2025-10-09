import { vi, describe, it, expect, beforeEach } from 'vitest';
import { parseCursor, encodeCursor } from './pagination.js';
import logger from '@src/logger/logger.js';

// Mock the logger
vi.mock('@src/logger/logger.js', () => ({
  __esModule: true,
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
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
