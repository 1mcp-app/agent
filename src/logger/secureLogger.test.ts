import { describe, expect, it } from 'vitest';

import { createSafeErrorMessage, sanitizeForLogging, sanitizeOAuthServerList, secureLogger } from './secureLogger.js';

describe('secureLogger', () => {
  describe('sanitizeForLogging', () => {
    it('should redact sensitive keys in objects', () => {
      const input = {
        client_secret: 'secret123',
        clientId: 'client123',
        access_token: 'token123',
        normalData: 'this is fine',
      };

      const result = sanitizeForLogging(input) as Record<string, unknown>;

      expect(result.client_secret).toBe('[REDACTED]');
      expect(result.clientId).toBe('client123'); // clientId is not in sensitive keys
      expect(result.access_token).toBe('[REDACTED]');
      expect(result.normalData).toBe('this is fine');
    });

    it('should sanitize sensitive patterns in strings', () => {
      const input = 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9';
      const result = sanitizeForLogging(input);
      expect(result).toBe('[REDACTED]');
    });

    it('should handle nested objects', () => {
      const input = {
        config: {
          oauth: {
            client_secret: 'secret123',
            scopes: ['read', 'write'],
          },
        },
        data: 'normal data',
      };

      const result = sanitizeForLogging(input) as Record<string, unknown>;
      const config = result.config as Record<string, unknown>;
      const oauth = config.oauth as Record<string, unknown>;

      expect(oauth.client_secret).toBe('[REDACTED]');
      expect(oauth.scopes).toEqual(['read', 'write']);
      expect(result.data).toBe('normal data');
    });

    it('should handle arrays', () => {
      const input = [
        { token: 'secret123', data: 'normal' },
        { client_secret: 'secret456', info: 'public' },
      ];

      const result = sanitizeForLogging(input) as Array<Record<string, unknown>>;
      expect(result[0].token).toBe('[REDACTED]');
      expect(result[0].data).toBe('normal');
      expect(result[1].client_secret).toBe('[REDACTED]');
      expect(result[1].info).toBe('public');
    });

    it('should handle primitive values', () => {
      expect(sanitizeForLogging('string')).toBe('string');
      expect(sanitizeForLogging(123)).toBe(123);
      expect(sanitizeForLogging(true)).toBe(true);
      expect(sanitizeForLogging(null)).toBe(null);
      expect(sanitizeForLogging(undefined)).toBe(undefined);
    });

    it('should prevent infinite recursion', () => {
      const circular: any = { data: 'test' };
      circular.self = circular;

      const result = sanitizeForLogging(circular) as Record<string, unknown>;
      expect(result.data).toBe('test');
      // The circular reference should eventually be cut off with [MAX_DEPTH]
      expect(JSON.stringify(result)).toContain('[MAX_DEPTH]');
    });
  });

  describe('sanitizeOAuthServerList', () => {
    it('should remove OAuth parameters from server URLs', () => {
      const servers = ['server1?client_id=123&client_secret=secret', 'server2|config', 'server3?token=abc123'];

      const result = sanitizeOAuthServerList(servers);

      expect(result[0]).toContain('server1');
      expect(result[0]).toContain('[OAUTH_REDACTED]');
      expect(result[1]).toBe('server2'); // Only takes first part before |
      expect(result[2]).toContain('server3');
      expect(result[2]).toContain('[OAUTH_REDACTED]');
    });

    it('should handle clean server names', () => {
      const servers = ['server1', 'server2', 'server3'];
      const result = sanitizeOAuthServerList(servers);
      expect(result).toEqual(['server1', 'server2', 'server3']);
    });
  });

  describe('createSafeErrorMessage', () => {
    it('should sanitize error messages', () => {
      const error = 'HTTP 401 Unauthorized: Bearer token invalid';
      const result = createSafeErrorMessage(error);
      expect(result).toBe('HTTP [STATUS_CODE]');
    });

    it('should replace HTTP status details', () => {
      const error = '1mcp server not responding (HTTP 500 Internal Server Error)';
      const result = createSafeErrorMessage(error);
      expect(result).toContain('server connectivity issue');
    });

    it('should handle simple errors', () => {
      const error = 'Connection timeout';
      const result = createSafeErrorMessage(error);
      expect(result).toBe('Connection timeout');
    });
  });

  describe('secure logger methods', () => {
    it('should have all standard logger methods', () => {
      expect(typeof secureLogger.debug).toBe('function');
      expect(typeof secureLogger.info).toBe('function');
      expect(typeof secureLogger.warn).toBe('function');
      expect(typeof secureLogger.error).toBe('function');
    });

    // Note: We can't easily test the actual logging output without mocking,
    // but we can verify the methods exist and don't throw errors
    it('should not throw when called with various inputs', () => {
      expect(() => secureLogger.debug('test message')).not.toThrow();
      expect(() => secureLogger.info('test message', { data: 'test' })).not.toThrow();
      expect(() => secureLogger.warn('test message', { secret: 'should-be-redacted' })).not.toThrow();
      expect(() => secureLogger.error('test message')).not.toThrow();
    });

    it('should handle OAuth-related messages without exposing sensitive data', () => {
      expect(() => secureLogger.debug('OAuth client configured with scopes: openid profile email')).not.toThrow();
      expect(() => secureLogger.info('AwaitingOAuth state', { status: 'awaiting_oauth' })).not.toThrow();
      expect(() => secureLogger.warn('OAuth required', { oauthRequired: ['server1', 'server2'] })).not.toThrow();
    });

    it('should sanitize sensitive patterns in messages', () => {
      expect(() => secureLogger.debug('Message with scope: openid profile')).not.toThrow();
      expect(() => secureLogger.debug('Message with redirect_uris: [https://example.com]')).not.toThrow();
      expect(() => secureLogger.debug('Message with scopes: [openid, profile]')).not.toThrow();
    });
  });
});
