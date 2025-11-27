import { describe, expect, it } from 'vitest';

// Import the module to access private functions through module exports
// We'll need to export these functions for testing
import { compareVersions, getUpdateType, parseVersion } from './services/versionResolver.js';

describe('Version Comparison Utilities', () => {
  describe('parseVersion', () => {
    it('should parse valid semantic version', () => {
      const result = parseVersion('1.2.3');
      expect(result).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it('should parse version with v prefix', () => {
      const result = parseVersion('v2.4.6');
      expect(result).toEqual({ major: 2, minor: 4, patch: 6 });
    });

    it('should handle version with build metadata', () => {
      const result = parseVersion('1.2.3-alpha.1+build.123');
      expect(result).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it('should return null for invalid version', () => {
      expect(parseVersion('invalid')).toBeNull();
      expect(parseVersion('1.2')).toBeNull();
      expect(parseVersion('a.b.c')).toBeNull();
    });

    it('should handle zero versions', () => {
      const result = parseVersion('0.0.0');
      expect(result).toEqual({ major: 0, minor: 0, patch: 0 });
    });
  });

  describe('compareVersions', () => {
    it('should return 0 for equal versions', () => {
      expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
      expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    });

    it('should return 1 when v1 > v2', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
      expect(compareVersions('1.3.0', '1.2.0')).toBe(1);
      expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
    });

    it('should return -1 when v1 < v2', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
      expect(compareVersions('1.2.0', '1.3.0')).toBe(-1);
      expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
    });

    it('should prioritize major version differences', () => {
      expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
      expect(compareVersions('1.9.9', '2.0.0')).toBe(-1);
    });

    it('should prioritize minor version over patch', () => {
      expect(compareVersions('1.3.0', '1.2.9')).toBe(1);
      expect(compareVersions('1.2.9', '1.3.0')).toBe(-1);
    });

    it('should return 0 for invalid versions', () => {
      expect(compareVersions('invalid', '1.2.3')).toBe(0);
      expect(compareVersions('1.2.3', 'invalid')).toBe(0);
      expect(compareVersions('invalid', 'also-invalid')).toBe(0);
    });
  });

  describe('getUpdateType', () => {
    it('should detect major update', () => {
      expect(getUpdateType('1.2.3', '2.0.0')).toBe('major');
      expect(getUpdateType('1.9.9', '2.0.0')).toBe('major');
    });

    it('should detect minor update', () => {
      expect(getUpdateType('1.2.3', '1.3.0')).toBe('minor');
      expect(getUpdateType('1.2.9', '1.3.0')).toBe('minor');
    });

    it('should detect patch update', () => {
      expect(getUpdateType('1.2.3', '1.2.4')).toBe('patch');
      expect(getUpdateType('1.2.3', '1.2.9')).toBe('patch');
    });

    it('should return undefined for same version', () => {
      expect(getUpdateType('1.2.3', '1.2.3')).toBeUndefined();
    });

    it('should return undefined for downgrade', () => {
      expect(getUpdateType('2.0.0', '1.9.9')).toBeUndefined();
      expect(getUpdateType('1.3.0', '1.2.9')).toBeUndefined();
    });

    it('should return undefined for invalid versions', () => {
      expect(getUpdateType('invalid', '1.2.3')).toBeUndefined();
      expect(getUpdateType('1.2.3', 'invalid')).toBeUndefined();
    });

    it('should handle v prefix', () => {
      expect(getUpdateType('v1.2.3', 'v1.3.0')).toBe('minor');
      expect(getUpdateType('1.2.3', 'v1.3.0')).toBe('minor');
    });
  });
});
