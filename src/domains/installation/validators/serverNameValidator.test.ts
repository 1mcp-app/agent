import { describe, expect, it } from 'vitest';

import { deriveLocalName, isValidServerName, sanitizeServerName } from './serverNameValidator.js';

describe('serverNameValidator', () => {
  describe('deriveLocalName', () => {
    it('should extract last part from registry ID with slash', () => {
      expect(deriveLocalName('io.github.owner/repo-name')).toBe('repo-name');
      expect(deriveLocalName('com.example/my-server')).toBe('my-server');
    });

    it('should use full ID if no slash', () => {
      expect(deriveLocalName('filesystem')).toBe('filesystem');
      expect(deriveLocalName('simple-name')).toBe('simple-name');
    });

    it('should preserve valid names as-is', () => {
      expect(deriveLocalName('io.github.owner/validName123')).toBe('validName123');
      expect(deriveLocalName('test_server')).toBe('test_server');
      expect(deriveLocalName('my-server')).toBe('my-server');
    });

    it('should sanitize names with invalid characters', () => {
      expect(deriveLocalName('io.github.owner/my server')).toBe('my_server');
      expect(deriveLocalName('test@server')).toBe('test_server');
      expect(deriveLocalName('server#name!')).toBe('server_name_');
    });

    it('should ensure name starts with letter', () => {
      expect(deriveLocalName('123-server')).toBe('server_123-server');
      expect(deriveLocalName('_underscore')).toBe('server__underscore');
      expect(deriveLocalName('-dash')).toBe('server_-dash');
    });

    it('should truncate long names to 50 characters', () => {
      const longName = 'a'.repeat(60);
      const result = deriveLocalName(longName);
      expect(result).toHaveLength(50);
      expect(result).toBe('a'.repeat(50));
    });

    it('should handle empty or invalid names', () => {
      expect(deriveLocalName('###')).toBe('server____');
      expect(deriveLocalName('')).toBe('server_'); // Empty string becomes '_' then 'server_'
    });
  });

  describe('isValidServerName', () => {
    it('should accept valid names', () => {
      expect(isValidServerName('validName')).toBe(true);
      expect(isValidServerName('myServer123')).toBe(true);
      expect(isValidServerName('test_server')).toBe(true);
      expect(isValidServerName('my-server')).toBe(true);
      expect(isValidServerName('a')).toBe(true);
    });

    it('should reject names not starting with letter', () => {
      expect(isValidServerName('123server')).toBe(false);
      expect(isValidServerName('_server')).toBe(false);
      expect(isValidServerName('-server')).toBe(false);
    });

    it('should reject names with invalid characters', () => {
      expect(isValidServerName('my server')).toBe(false);
      expect(isValidServerName('test@server')).toBe(false);
      expect(isValidServerName('server#name')).toBe(false);
      expect(isValidServerName('test.server')).toBe(false);
    });

    it('should reject empty names', () => {
      expect(isValidServerName('')).toBe(false);
    });

    it('should reject names longer than 50 characters', () => {
      expect(isValidServerName('a'.repeat(51))).toBe(false);
      expect(isValidServerName('a'.repeat(50))).toBe(true);
    });
  });

  describe('sanitizeServerName', () => {
    it('should replace invalid characters with underscores', () => {
      expect(sanitizeServerName('my server')).toBe('my_server');
      expect(sanitizeServerName('test@server#name')).toBe('test_server_name');
    });

    it('should add prefix if not starting with letter', () => {
      expect(sanitizeServerName('123server')).toBe('server_123server');
      expect(sanitizeServerName('_test')).toBe('server__test');
    });

    it('should truncate to 50 characters', () => {
      const result = sanitizeServerName('a'.repeat(60));
      expect(result).toHaveLength(50);
    });

    it('should handle empty input', () => {
      expect(sanitizeServerName('')).toBe('server_'); // Empty string becomes '_' then 'server_'
    });

    it('should preserve already valid names', () => {
      expect(sanitizeServerName('validName123')).toBe('validName123');
      expect(sanitizeServerName('test_server')).toBe('test_server');
      expect(sanitizeServerName('my-server')).toBe('my-server');
    });
  });
});
