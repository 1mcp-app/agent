import { describe, expect, it } from 'vitest';

import { sanitizeForLogging } from './secureLogger.js';

describe('secureLogger OAuth Security Tests', () => {
  describe('OAuth scope redaction', () => {
    it('should redact OAuth scope patterns', () => {
      const input1 = 'OAuth configured with scopes: [openid, profile, email]';
      const input2 = 'Client has redirect_uris: [https://localhost:3000/callback]';
      const input3 = 'Server config with scope: openid profile email';

      const result1 = sanitizeForLogging(input1);
      const result2 = sanitizeForLogging(input2);
      const result3 = sanitizeForLogging(input3);

      expect(result1).toContain('[REDACTED]');
      expect(result2).toContain('[REDACTED]');
      expect(result3).toContain('[REDACTED]');

      expect(result1).not.toContain('openid');
      expect(result2).not.toContain('https://localhost:3000/callback');
      expect(result3).not.toContain('profile email');
    });
  });

  describe('OAuth status handling', () => {
    it('should safely handle OAuth status enums', () => {
      const input = {
        status: 'awaiting_oauth',
        serverName: 'test-server',
        authorizationUrl: 'https://oauth.example.com/authorize',
      };

      const result = sanitizeForLogging(input) as Record<string, unknown>;

      // Should redact the authorization URL but preserve safe status info
      expect(result.status).toBe('awaiting_oauth'); // Status is safe
      expect(result.serverName).toBe('test-server'); // Server name is safe
      expect(typeof result.authorizationUrl).toBe('string'); // URL should be sanitized
    });

    it('should handle OAuth server lists safely', () => {
      const input = {
        oauthRequired: ['server1', 'server2'],
        count: 2,
      };

      const result = sanitizeForLogging(input) as Record<string, unknown>;

      // Server names and counts are safe
      expect(result.count).toBe(2);
      expect(Array.isArray(result.oauthRequired)).toBe(true);
    });
  });

  describe('URL redaction with OAuth parameters', () => {
    it('should redact OAuth URLs with sensitive parameters', () => {
      const input1 = 'Auth URL: https://oauth.example.com/auth?token=secret123&code=authcode456';
      const input2 = 'Callback URL: https://app.com/callback?Code=abc123';

      const result1 = sanitizeForLogging(input1);
      const result2 = sanitizeForLogging(input2);

      expect(result1).toContain('[REDACTED]');
      expect(result2).toContain('[REDACTED]');

      expect(result1).not.toContain('secret123');
      expect(result1).not.toContain('authcode456');
      expect(result2).not.toContain('abc123');
    });
  });

  describe('Bearer token redaction', () => {
    it('should redact Bearer tokens in various formats', () => {
      const inputs = [
        'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'Token: bearer abc123def456',
        'Auth header with BEARER token_value_here',
      ];

      inputs.forEach((input) => {
        const result = sanitizeForLogging(input);
        expect(result).toContain('[REDACTED]');
        expect(result).not.toMatch(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/);
        expect(result).not.toMatch(/abc123def456/);
        expect(result).not.toMatch(/token_value_here/);
      });
    });
  });
});
