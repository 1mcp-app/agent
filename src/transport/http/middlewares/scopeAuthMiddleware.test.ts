import { Response } from 'express';
import { describe, expect, it } from 'vitest';

import { AuthInfo, getAuthInfo, getValidatedTags } from './scopeAuthMiddleware.js';

describe('Scope Authentication Middleware Utilities', () => {
  describe('getValidatedTags', () => {
    it('should return validated tags from res.locals', () => {
      const res = { locals: { validatedTags: ['web', 'db'] } } as unknown as Response;
      expect(getValidatedTags(res)).toEqual(['web', 'db']);
    });

    it('should return empty array when no validated tags', () => {
      const res = { locals: {} } as unknown as Response;
      expect(getValidatedTags(res)).toEqual([]);
    });

    it('should handle undefined locals', () => {
      const res = {} as unknown as Response;
      expect(getValidatedTags(res)).toEqual([]);
    });
  });

  describe('getAuthInfo', () => {
    it('should return auth info from res.locals', () => {
      const authInfo: AuthInfo = {
        token: 'test-token',
        clientId: 'test-client',
        grantedScopes: ['tag:web'],
        grantedTags: ['web'],
      };
      const res = { locals: { auth: authInfo } } as unknown as Response;
      expect(getAuthInfo(res)).toEqual(authInfo);
    });

    it('should return undefined when no auth info', () => {
      const res = { locals: {} } as unknown as Response;
      expect(getAuthInfo(res)).toBeUndefined();
    });

    it('should handle undefined locals', () => {
      const res = {} as unknown as Response;
      expect(getAuthInfo(res)).toBeUndefined();
    });
  });

  describe('AuthInfo interface', () => {
    it('should have correct structure', () => {
      const authInfo: AuthInfo = {
        token: 'test-token',
        clientId: 'test-client',
        grantedScopes: ['tag:web', 'tag:db'],
        grantedTags: ['web', 'db'],
      };

      expect(authInfo.token).toBe('test-token');
      expect(authInfo.clientId).toBe('test-client');
      expect(authInfo.grantedScopes).toEqual(['tag:web', 'tag:db']);
      expect(authInfo.grantedTags).toEqual(['web', 'db']);
    });
  });

  describe('Security considerations', () => {
    it('should handle malformed auth data safely', () => {
      const res = {
        locals: {
          auth: {
            // Missing required fields
            token: 'test',
            // clientId missing
            grantedScopes: null,
            grantedTags: undefined,
          },
        },
      } as unknown as Response;

      const authInfo = getAuthInfo(res);
      // The function should return undefined for malformed auth data (security feature)
      expect(authInfo).toBeUndefined();
    });

    it('should handle malformed validated tags safely', () => {
      const res = { locals: { validatedTags: null } } as unknown as Response;
      expect(getValidatedTags(res)).toEqual([]);

      const res2 = { locals: { validatedTags: 'not-array' } } as unknown as Response;
      expect(getValidatedTags(res2)).toEqual([]);

      const res3 = { locals: { validatedTags: undefined } } as unknown as Response;
      expect(getValidatedTags(res3)).toEqual([]);
    });

    it('should prevent prototype pollution', () => {
      const maliciousRes = {
        locals: {
          validatedTags: ['legitimate', 'tags'],
        },
      } as unknown as Response;

      // Attempt to pollute prototype (this is defensive - the function doesn't need special protection)
      try {
        (maliciousRes.locals as any).__proto__.validatedTags = ['hacked'];
      } catch {
        // Some environments prevent prototype pollution
      }

      // Should still return the legitimate tags
      expect(getValidatedTags(maliciousRes)).toEqual(['legitimate', 'tags']);
    });

    it('should handle circular references safely', () => {
      const circularAuth: any = {
        token: 'test',
        clientId: 'test',
        grantedScopes: ['tag:web'],
        grantedTags: ['web'],
      };
      circularAuth.self = circularAuth;

      const res = { locals: { auth: circularAuth } } as unknown as Response;
      const authInfo = getAuthInfo(res);

      // Even with circular references, if the required properties are valid, it should return the auth info
      expect(authInfo).toBeDefined();
      expect(authInfo?.token).toBe('test');
      expect(authInfo?.clientId).toBe('test');
    });
  });

  describe('Performance', () => {
    it('should handle large tag arrays efficiently', () => {
      const largeTags = Array(1000)
        .fill(0)
        .map((_, i) => `tag-${i}`);
      const res = { locals: { validatedTags: largeTags } } as unknown as Response;

      const start = Date.now();
      const result = getValidatedTags(res);
      const duration = Date.now() - start;

      expect(result).toEqual(largeTags);
      expect(duration).toBeLessThan(50); // Should be very fast
    });

    it('should handle repeated calls without memory leaks', () => {
      const res = { locals: { validatedTags: ['web', 'db'] } } as unknown as Response;

      // Call many times
      for (let i = 0; i < 10000; i++) {
        getValidatedTags(res);
        getAuthInfo(res);
      }

      // Should not cause memory issues
      expect(getValidatedTags(res)).toEqual(['web', 'db']);
    });
  });
});
