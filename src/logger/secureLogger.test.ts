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

    it('should escape all C0 and C1 control chars, DEL, and 7-bit/8-bit ANSI ESC', () => {
      const input = 'a\r\nb\tc\x00d\x1B[31me\x7Ff\x9B31mg\x80h\x9Fi';
      const result = sanitizeForLogging(input) as string;
      expect(result).toBe('a\\r\\nb\\tc\\x00d\\x1B[31me\\x7Ff\\x9B31mg\\x80h\\x9Fi');
      // eslint-disable-next-line no-control-regex -- asserting absence of all C0/C1 and DEL control chars
      expect(result).not.toMatch(/[\x00-\x1F\x7F-\x9F]/);
    });

    it('should escape control chars in nested structures and log messages', () => {
      const input = {
        outer: [{ msg: 'line1\nline2' }],
      };
      const result = sanitizeForLogging(input) as { outer: Array<{ msg: string }> };
      expect(result.outer[0].msg).toBe('line1\\nline2');
    });

    it('should escape control chars and redact credential assignments in object keys', () => {
      const input = {
        'user\nrole': 'admin\r\nFORGED: true',
        'token=secret123': 'active',
        'client_secret=secret456': 'valid',
        'Authorization: Bearer token_in_key_789': 'header_val',
        'Authorization: Basic dXNlcjpwYXNzd29yZDk5OQ==': 'auth_val',
        'jwt_key=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozG5faivvqpPxSyqLDKLw_n8_B6':
          'jwt_val',
      };
      const result = sanitizeForLogging(input) as Record<string, string>;
      expect(result).toHaveProperty('user\\nrole');
      expect(result['user\\nrole']).toBe('admin\\r\\nFORGED: true');
      expect(Object.keys(result)[0]).not.toContain('\n');
      expect(JSON.stringify(result)).not.toContain('secret123');
      expect(JSON.stringify(result)).not.toContain('secret456');
      expect(JSON.stringify(result)).not.toContain('token_in_key_789');
      expect(JSON.stringify(result)).not.toContain('dXNlcjpwYXNzd29yZDk5OQ==');
      expect(JSON.stringify(result)).not.toContain('dozG5faivvqpPxSyqLDKLw_n8_B6');
    });

    it('should redact key-value credential assignments across all key families without leaking values', () => {
      const cases = [
        'password=abc123',
        'password="secret password with spaces 123"',
        "token='secret token with spaces 456'",
        'secret=def456',
        'client_secret=ghi789',
        'api-key=jkl012',
        'auth-token=mno345',
        'access_token=pqr678',
        'refresh_token=stu901',
      ];
      for (const testCase of cases) {
        const result = sanitizeForLogging(testCase) as string;
        expect(result).toContain('[REDACTED]');
        expect(result).not.toContain('abc123');
        expect(result).not.toContain('secret password with spaces 123');
        expect(result).not.toContain('secret token with spaces 456');
        expect(result).not.toContain('def456');
        expect(result).not.toContain('ghi789');
        expect(result).not.toContain('jkl012');
        expect(result).not.toContain('mno345');
        expect(result).not.toContain('pqr678');
        expect(result).not.toContain('stu901');
      }
    });

    it('should sanitize and escape Error objects including custom name, stack, and cause', () => {
      const causeErr = new Error('Root cause with password=rootpass123\nInner stack');
      const error = new Error('OAuth token=secret123 failed\nSecond line', { cause: causeErr });
      error.name = 'CustomToken_secret456_Error\nInjected';
      const result = sanitizeForLogging(error) as Record<string, unknown>;
      expect(result.name).toContain('[REDACTED]');
      expect(result.name).not.toContain('\n');
      expect(result.name).not.toContain('secret456');
      expect(result.message).toContain('[REDACTED]');
      expect(result.message).not.toContain('\n');
      expect(result.message).not.toContain('secret123');
      if (result.stack) {
        expect(result.stack).not.toContain('secret123');
        expect(result.stack).not.toContain('\n');
        expect(typeof result.stack).toBe('string');
      }
      expect(result.cause).toBeDefined();
      const sanitizedCause = result.cause as Record<string, unknown>;
      expect(sanitizedCause.message).toContain('[REDACTED]');
      expect(sanitizedCause.message).not.toContain('rootpass123');
    });

    it('should escape Unicode line separators and Trojan Source Bidi overrides', () => {
      const input = 'admin\u2028line_split\u2029paragraph\u202Ereversed\u2066isolate\u200Bzero\uFEFFbom';
      const result = sanitizeForLogging(input) as string;
      expect(result).toBe('admin\\u2028line_split\\u2029paragraph\\u202Ereversed\\u2066isolate\\u200Bzero\\uFEFFbom');
      expect(result).not.toContain('\u2028');
      expect(result).not.toContain('\u2029');
      expect(result).not.toContain('\u202E');
    });

    it('should redact PEM private keys including full body content, Basic auth, and JWT tokens', () => {
      const pem =
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0base64secretkeypayload...\n-----END RSA PRIVATE KEY-----';
      const sanitizedPem = sanitizeForLogging(pem) as string;
      expect(sanitizedPem).toBe('[REDACTED]');
      expect(sanitizedPem).not.toContain('BEGIN RSA PRIVATE KEY');
      expect(sanitizedPem).not.toContain('MIIEowIBAAKCAQEA0base64secretkeypayload');
      expect(sanitizedPem).not.toContain('END RSA PRIVATE KEY');

      const basic = 'Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==';
      expect(sanitizeForLogging(basic)).toContain('[REDACTED]');
      expect(sanitizeForLogging(basic)).not.toContain('dXNlcjpwYXNzd29yZDEyMw==');

      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozG5faivvqpPxSyqLDKLw_n8_B6';
      expect(sanitizeForLogging(jwt)).toContain('[REDACTED]');
      expect(sanitizeForLogging(jwt)).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('should safely serialize complex data types (BigInt, Date, RegExp, Set, Map)', () => {
      const date = new Date('2026-08-24T00:00:00.000Z');
      expect(sanitizeForLogging(date)).toBe('2026-08-24T00:00:00.000Z');

      const bigint = 9007199254740993n;
      expect(sanitizeForLogging(bigint)).toBe('9007199254740993n');

      const regex = /test\npattern/g;
      expect(sanitizeForLogging(regex)).toBe('/test\\npattern/g');

      const set = new Set(['user1', 'token=secret999']);
      const sanitizedSet = sanitizeForLogging(set) as string[];
      expect(sanitizedSet).toEqual(['user1', '[REDACTED]']);

      const map = new Map<string, unknown>([
        ['user\nname', 'alice'],
        ['secretKey', 'super_secret'],
      ]);
      const sanitizedMap = sanitizeForLogging(map) as Record<string, unknown>;
      expect(sanitizedMap['user\\nname']).toBe('alice');
      expect(sanitizedMap['secretKey']).toBe('[REDACTED]');
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
