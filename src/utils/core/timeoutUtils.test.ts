import { EnhancedTransport } from '@src/core/types/transport.js';

import { describe, expect, it } from 'vitest';

import { getConnectionTimeout, getRequestTimeout } from './timeoutUtils.js';

describe('timeoutUtils', () => {
  describe('getRequestTimeout', () => {
    it('should return requestTimeout when set', () => {
      const transport: EnhancedTransport = {
        requestTimeout: 5000,
        timeout: 3000,
      } as EnhancedTransport;

      expect(getRequestTimeout(transport)).toBe(5000);
    });

    it('should return timeout when requestTimeout is not set', () => {
      const transport: EnhancedTransport = {
        timeout: 3000,
      } as EnhancedTransport;

      expect(getRequestTimeout(transport)).toBe(3000);
    });

    it('should return undefined when neither is set', () => {
      const transport: EnhancedTransport = {} as EnhancedTransport;

      expect(getRequestTimeout(transport)).toBeUndefined();
    });

    it('should prioritize requestTimeout over timeout', () => {
      const transport: EnhancedTransport = {
        requestTimeout: 1000,
        timeout: 5000,
      } as EnhancedTransport;

      expect(getRequestTimeout(transport)).toBe(1000);
    });
  });

  describe('getConnectionTimeout', () => {
    it('should return connectionTimeout when set', () => {
      const transport: EnhancedTransport = {
        connectionTimeout: 10000,
        timeout: 5000,
      } as EnhancedTransport;

      expect(getConnectionTimeout(transport)).toBe(10000);
    });

    it('should return timeout when connectionTimeout is not set', () => {
      const transport: EnhancedTransport = {
        timeout: 5000,
      } as EnhancedTransport;

      expect(getConnectionTimeout(transport)).toBe(5000);
    });

    it('should return undefined when neither is set', () => {
      const transport: EnhancedTransport = {} as EnhancedTransport;

      expect(getConnectionTimeout(transport)).toBeUndefined();
    });

    it('should prioritize connectionTimeout over timeout', () => {
      const transport: EnhancedTransport = {
        connectionTimeout: 2000,
        timeout: 8000,
      } as EnhancedTransport;

      expect(getConnectionTimeout(transport)).toBe(2000);
    });
  });
});
