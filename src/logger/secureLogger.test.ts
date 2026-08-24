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

    it('should escape CRLF to prevent log forging (CWE-117)', () => {
      // Attacker-controlled input attempting to forge a second log line
      const input = 'login failed for user admin\nINFO: User logged in: admin';
      const result = sanitizeForLogging(input) as string;
      expect(result).not.toContain('\n');
      expect(result).toBe('login failed for user admin\\nINFO: User logged in: admin');
    });

    it('should escape all C0 control chars, DEL, and ANSI ESC', () => {
      const input = 'a\r\nb\tc\x00d\x1B[31me\x7Ff';
      const result = sanitizeForLogging(input) as string;
      expect(result).toBe('a\\r\\nb\\tc\\x00d\\x1B[31me\\x7Ff');
      // eslint-disable-next-line no-control-regex -- asserting absence of the control chars we just escaped
      expect(result).not.toMatch(/[\x00-\x1F\x7F]/);
    });

    it('should escape control chars in nested structures and log messages', () => {
      const input = {
        outer: [{ msg: 'line1\nline2' }],
      };
      const result = sanitizeForLogging(input) as { outer: Array<{ msg: string }> };
      expect(result.outer[0].msg).toBe('line1\\nline2');
    });

    it('should escape control chars in object keys', () => {
      const input = {
        'user\nrole': 'admin\r\nFORGED: true',
      };
      const result = sanitizeForLogging(input) as Record<string, string>;
      expect(result).toHaveProperty('user\\nrole');
      expect(result['user\\nrole']).toBe('admin\\r\\nFORGED: true');
      expect(Object.keys(result)[0]).not.toContain('\n');
    });

    it('should sanitize and escape Error objects', () => {
      const error = new Error('OAuth token=secret123 failed\nSecond line');
      const result = sanitizeForLogging(error) as Record<string, unknown>;
      expect(result.name).toBe('Error');
      expect(result.message).toContain('[REDACTED]');
      expect(result.message).not.toContain('\n');
      expect(result.message).toBe('OAuth token=[REDACTED]123 failed\\nSecond line');
      if (result.stack) {
        expect(result.stack).not.toContain('secret123');
        expect(result.stack).not.toContain('\n');
        expect(typeof result.stack).toBe('string');
      }
    });

    it('should still apply pattern redaction before control-char escaping', () => {
      const input = 'Bearer eyJhbGci\nsecond line';
      const result = sanitizeForLogging(input) as string;
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('\n');
    });

    it('should return [SANITIZATION_ERROR] if sanitization throws', () => {
      // Create an object where property access throws
      const throwingObj = {};
      Object.defineProperty(throwingObj, 'badProp', {
        get() {
          throw new Error('Explosion');
        },
        enumerable: true,
      });
      const result = sanitizeForLogging(throwingObj);
      expect(result).toBe('[SANITIZATION_ERROR]');
    });

    it('should handle large input without ReDoS issues', () => {
      const longInput = 'A'.repeat(50000) + '\r\n' + 'B'.repeat(50000);
      const start = Date.now();
      const result = sanitizeForLogging(longInput) as string;
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
      expect(result).toContain('\\r\\n');
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

    it('should escape control characters in OAuth server names', () => {
      const servers = ['server1\nmalicious', 'server2\x1B[31m'];
      const result = sanitizeOAuthServerList(servers);
      expect(result[0]).toBe('server1\\nmalicious');
      expect(result[1]).toBe('server2\\x1B[31m');
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
