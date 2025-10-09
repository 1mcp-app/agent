import { describe, it, expect } from 'vitest';
import {
  isValidTagName,
  isValidTagScope,
  extractTagFromScope,
  parseScope,
  validateScopes,
  validateScopesAgainstAvailableTags,
  hasRequiredScopes,
  tagsToScopes,
  scopesToTags,
  auditScopeOperation,
  SCOPE_VALIDATION_CONFIG,
} from './scopeValidation.js';

describe('Scope Validation', () => {
  describe('isValidTagName', () => {
    it('should accept valid tag names', () => {
      expect(isValidTagName('web')).toBe(true);
      expect(isValidTagName('db')).toBe(true);
      expect(isValidTagName('api-gateway')).toBe(true);
      expect(isValidTagName('user_service')).toBe(true);
      expect(isValidTagName('a123')).toBe(true);
      expect(isValidTagName('A_B_C')).toBe(true);
    });

    it('should reject invalid tag names', () => {
      expect(isValidTagName('')).toBe(false);
      expect(isValidTagName('web.service')).toBe(false);
      expect(isValidTagName('web/service')).toBe(false);
      expect(isValidTagName('web service')).toBe(false);
      expect(isValidTagName('web@service')).toBe(false);
      expect(isValidTagName('web#service')).toBe(false);
      expect(isValidTagName('web:service')).toBe(false);
      expect(isValidTagName('*')).toBe(false);
      expect(isValidTagName('..')).toBe(false);
      expect(isValidTagName('../admin')).toBe(false);
    });

    it('should enforce length constraints', () => {
      expect(isValidTagName('a'.repeat(SCOPE_VALIDATION_CONFIG.MAX_TAG_LENGTH))).toBe(true);
      expect(isValidTagName('a'.repeat(SCOPE_VALIDATION_CONFIG.MAX_TAG_LENGTH + 1))).toBe(false);
      expect(isValidTagName('')).toBe(false); // Below minimum length
    });

    it('should handle non-string inputs', () => {
      expect(isValidTagName(null as any)).toBe(false);
      expect(isValidTagName(undefined as any)).toBe(false);
      expect(isValidTagName(123 as any)).toBe(false);
      expect(isValidTagName({} as any)).toBe(false);
    });
  });

  describe('isValidTagScope', () => {
    it('should accept valid tag scopes', () => {
      expect(isValidTagScope('tag:web')).toBe(true);
      expect(isValidTagScope('tag:db')).toBe(true);
      expect(isValidTagScope('tag:api-gateway')).toBe(true);
      expect(isValidTagScope('tag:user_service')).toBe(true);
    });

    it('should reject invalid scope formats', () => {
      expect(isValidTagScope('web')).toBe(false);
      expect(isValidTagScope('scope:web')).toBe(false);
      expect(isValidTagScope('tag:')).toBe(false);
      expect(isValidTagScope(':web')).toBe(false);
      expect(isValidTagScope('tag:web:extra')).toBe(false);
      expect(isValidTagScope('tag:web.service')).toBe(false);
      expect(isValidTagScope('tag:web service')).toBe(false);
    });

    it('should enforce length constraints', () => {
      const longTag = 'a'.repeat(SCOPE_VALIDATION_CONFIG.MAX_TAG_LENGTH);
      expect(isValidTagScope(`tag:${longTag}`)).toBe(true);

      const tooLongScope = 'a'.repeat(SCOPE_VALIDATION_CONFIG.MAX_SCOPE_LENGTH + 1);
      expect(isValidTagScope(tooLongScope)).toBe(false);
    });

    it('should handle non-string inputs', () => {
      expect(isValidTagScope(null as any)).toBe(false);
      expect(isValidTagScope(undefined as any)).toBe(false);
      expect(isValidTagScope(123 as any)).toBe(false);
    });
  });

  describe('extractTagFromScope', () => {
    it('should extract valid tags from scopes', () => {
      expect(extractTagFromScope('tag:web')).toBe('web');
      expect(extractTagFromScope('tag:db')).toBe('db');
      expect(extractTagFromScope('tag:api-gateway')).toBe('api-gateway');
    });

    it('should return null for invalid scopes', () => {
      expect(extractTagFromScope('web')).toBe(null);
      expect(extractTagFromScope('scope:web')).toBe(null);
      expect(extractTagFromScope('tag:')).toBe(null);
      expect(extractTagFromScope('tag:web.service')).toBe(null);
    });
  });

  describe('parseScope', () => {
    it('should parse valid tag scopes', () => {
      expect(parseScope('tag:web')).toEqual({ type: 'tag', value: 'web' });
      expect(parseScope('tag:db')).toEqual({ type: 'tag', value: 'db' });
    });

    it('should return null for invalid scopes', () => {
      expect(parseScope('web')).toBe(null);
      expect(parseScope('scope:web')).toBe(null);
      expect(parseScope('tag:')).toBe(null);
      expect(parseScope('')).toBe(null);
      expect(parseScope(null as any)).toBe(null);
    });
  });

  describe('validateScopes', () => {
    it('should validate valid scope arrays', () => {
      const result = validateScopes(['tag:web', 'tag:db']);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.validScopes).toEqual(['tag:web', 'tag:db']);
      expect(result.invalidScopes).toEqual([]);
    });

    it('should detect invalid scopes', () => {
      const result = validateScopes(['tag:web', 'invalid', 'tag:db.bad']);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid scope format: invalid');
      expect(result.errors).toContain('Invalid scope format: tag:db.bad');
      expect(result.validScopes).toEqual(['tag:web']);
      expect(result.invalidScopes).toEqual(['invalid', 'tag:db.bad']);
    });

    it('should detect duplicate scopes', () => {
      const result = validateScopes(['tag:web', 'tag:web', 'tag:db']);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Duplicate scope: tag:web');
      expect(result.validScopes).toEqual(['tag:web', 'tag:db']);
      expect(result.invalidScopes).toEqual(['tag:web']);
    });

    it('should enforce count limits', () => {
      const tooManyScopes = Array(SCOPE_VALIDATION_CONFIG.MAX_SCOPES_COUNT + 1)
        .fill(0)
        .map((_, i) => `tag:scope${i}`);

      const result = validateScopes(tooManyScopes);
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Too many scopes');
    });

    it('should handle invalid input types', () => {
      expect(validateScopes(null as any).isValid).toBe(false);
      expect(validateScopes(undefined as any).isValid).toBe(false);
      expect(validateScopes('not-array' as any).isValid).toBe(false);
    });
  });

  describe('validateScopesAgainstAvailableTags', () => {
    const availableTags = ['web', 'db', 'api-gateway'];

    it('should validate scopes against available tags', () => {
      const result = validateScopesAgainstAvailableTags(['tag:web', 'tag:db'], availableTags);
      expect(result.isValid).toBe(true);
      expect(result.validScopes).toEqual(['tag:web', 'tag:db']);
    });

    it('should reject scopes for unavailable tags', () => {
      const result = validateScopesAgainstAvailableTags(['tag:web', 'tag:unavailable'], availableTags);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Scope not available: tag:unavailable (tag: unavailable)');
      expect(result.validScopes).toEqual(['tag:web']);
      expect(result.invalidScopes).toEqual(['tag:unavailable']);
    });

    it('should combine format and availability validation', () => {
      const result = validateScopesAgainstAvailableTags(['tag:web', 'invalid', 'tag:unavailable'], availableTags);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid scope format: invalid');
      // Note: invalid scopes are caught by format validation first
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('hasRequiredScopes', () => {
    it('should allow access when all required tags are granted', () => {
      const grantedScopes = ['tag:web', 'tag:db', 'tag:cache'];
      const requestedTags = ['web', 'db'];
      expect(hasRequiredScopes(grantedScopes, requestedTags)).toBe(true);
    });

    it('should deny access when some required tags are missing', () => {
      const grantedScopes = ['tag:web'];
      const requestedTags = ['web', 'db'];
      expect(hasRequiredScopes(grantedScopes, requestedTags)).toBe(false);
    });

    it('should allow access when no tags are requested', () => {
      const grantedScopes = ['tag:web'];
      const requestedTags: string[] = [];
      expect(hasRequiredScopes(grantedScopes, requestedTags)).toBe(true);
    });

    it('should deny access when no scopes are granted but tags are requested', () => {
      const grantedScopes: string[] = [];
      const requestedTags = ['web'];
      expect(hasRequiredScopes(grantedScopes, requestedTags)).toBe(false);
    });

    it('should handle invalid inputs securely (fail-secure)', () => {
      expect(hasRequiredScopes(null as any, ['web'])).toBe(false);
      expect(hasRequiredScopes(['tag:web'], null as any)).toBe(false);
      expect(hasRequiredScopes('not-array' as any, ['web'])).toBe(false);
      expect(hasRequiredScopes(['tag:web'], 'not-array' as any)).toBe(false);
    });

    it('should ignore non-tag scopes', () => {
      const grantedScopes = ['tag:web', 'other:something', 'invalid'];
      const requestedTags = ['web'];
      expect(hasRequiredScopes(grantedScopes, requestedTags)).toBe(true);
    });
  });

  describe('tagsToScopes', () => {
    it('should convert valid tags to scopes', () => {
      expect(tagsToScopes(['web', 'db'])).toEqual(['tag:web', 'tag:db']);
    });

    it('should filter out invalid tag names', () => {
      expect(tagsToScopes(['web', 'invalid.tag', 'db'])).toEqual(['tag:web', 'tag:db']);
    });

    it('should handle empty arrays and invalid inputs', () => {
      expect(tagsToScopes([])).toEqual([]);
      expect(tagsToScopes(null as any)).toEqual([]);
      expect(tagsToScopes(undefined as any)).toEqual([]);
    });
  });

  describe('scopesToTags', () => {
    it('should extract tags from valid scopes', () => {
      expect(scopesToTags(['tag:web', 'tag:db'])).toEqual(['web', 'db']);
    });

    it('should filter out invalid scopes', () => {
      expect(scopesToTags(['tag:web', 'invalid', 'tag:db'])).toEqual(['web', 'db']);
    });

    it('should handle empty arrays and invalid inputs', () => {
      expect(scopesToTags([])).toEqual([]);
      expect(scopesToTags(null as any)).toEqual([]);
      expect(scopesToTags(undefined as any)).toEqual([]);
    });
  });

  describe('auditScopeOperation', () => {
    it('should call auditScopeOperation without throwing', () => {
      const context = {
        clientId: 'test-client',
        requestedScopes: ['tag:web'],
        grantedScopes: ['tag:web', 'tag:db'],
        success: true,
      };

      expect(() => auditScopeOperation('test_operation', context)).not.toThrow();
    });

    it('should handle partial context information', () => {
      expect(() => auditScopeOperation('minimal_operation', { success: false })).not.toThrow();
    });
  });

  describe('Security Edge Cases', () => {
    it('should prevent scope injection attacks', () => {
      const maliciousScopes = [
        'tag:../admin',
        'tag:..\\admin',
        'tag:admin*',
        'tag:admin?',
        'tag:admin[0-9]',
        'tag:admin$(whoami)',
        'tag:admin`ls`',
        'tag:admin;rm -rf /',
        'tag:admin||echo hack',
        'tag:admin<script>alert(1)</script>',
      ];

      maliciousScopes.forEach((scope) => {
        expect(isValidTagScope(scope)).toBe(false);
        expect(extractTagFromScope(scope)).toBe(null);
      });
    });

    it('should prevent buffer overflow attempts', () => {
      const longScope = 'tag:' + 'a'.repeat(10000);
      expect(isValidTagScope(longScope)).toBe(false);
    });

    it('should prevent null byte injection', () => {
      expect(isValidTagScope('tag:admin\0')).toBe(false);
      expect(isValidTagScope('tag:admin\x00')).toBe(false);
    });

    it('should handle unicode and special characters securely', () => {
      const unicodeScopes = ['tag:admin\u0000', 'tag:admin\uFEFF', 'tag:admin\u200B', 'tag:admin™', 'tag:admin🚀'];

      unicodeScopes.forEach((scope) => {
        expect(isValidTagScope(scope)).toBe(false);
      });
    });

    it('should prevent privilege escalation via scope manipulation', () => {
      const grantedScopes = ['tag:user'];

      // Attacker tries to escalate to admin by manipulating input
      const adminRequests = [
        ['user', 'admin'],
        ['user', '../admin'],
        ['user', '*'],
        ['user', 'admin*'],
      ];

      adminRequests.forEach((requestedTags) => {
        expect(hasRequiredScopes(grantedScopes, requestedTags)).toBe(false);
      });
    });
  });

  describe('Performance and Resource Usage', () => {
    it('should handle large numbers of scopes efficiently', () => {
      const largeValidScopeList = Array(50)
        .fill(0)
        .map((_, i) => `tag:service${i}`);
      const availableTags = Array(50)
        .fill(0)
        .map((_, i) => `service${i}`);

      const start = Date.now();
      const result = validateScopesAgainstAvailableTags(largeValidScopeList, availableTags);
      const duration = Date.now() - start;

      expect(result.isValid).toBe(true);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle scope validation under memory pressure', () => {
      // Test with many duplicate and invalid scopes (respects count limit)
      const massiveInvalidList = Array(SCOPE_VALIDATION_CONFIG.MAX_SCOPES_COUNT - 1).fill('invalid-scope');

      const result = validateScopes(massiveInvalidList);
      expect(result.isValid).toBe(false);
      expect(result.invalidScopes.length).toBeGreaterThan(0);
    });
  });
});
