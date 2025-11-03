import { describe, expect, it } from 'vitest';

import {
  cleanVersion,
  compareVersions,
  getUpdateType,
  isNewerVersion,
  isValidVersion,
  parseVersion,
} from './versionResolver.js';

describe('versionResolver', () => {
  describe('parseVersion', () => {
    it('should parse valid semantic versions', () => {
      expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
      expect(parseVersion('0.0.1')).toEqual({ major: 0, minor: 0, patch: 1 });
      expect(parseVersion('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 });
    });

    it('should parse versions with v prefix', () => {
      expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it('should return null for invalid versions', () => {
      expect(parseVersion('invalid')).toBeNull();
      expect(parseVersion('1.2')).toBeNull();
      expect(parseVersion('1')).toBeNull();
      expect(parseVersion('')).toBeNull();
    });

    it('should handle prerelease versions', () => {
      const result = parseVersion('1.2.3-alpha.1');
      expect(result?.major).toBe(1);
      expect(result?.minor).toBe(2);
      expect(result?.patch).toBe(3);
    });
  });

  describe('compareVersions', () => {
    it('should return 1 when v1 > v2', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
      expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
      expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    });

    it('should return -1 when v1 < v2', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
      expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
      expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    });

    it('should return 0 when versions are equal', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    });

    it('should handle v prefix', () => {
      expect(compareVersions('v2.0.0', '1.0.0')).toBe(1);
      expect(compareVersions('2.0.0', 'v1.0.0')).toBe(1);
    });

    it('should return 0 for invalid versions', () => {
      expect(compareVersions('invalid', '1.0.0')).toBe(0);
      expect(compareVersions('1.0.0', 'invalid')).toBe(0);
    });
  });

  describe('getUpdateType', () => {
    it('should identify major updates', () => {
      expect(getUpdateType('1.0.0', '2.0.0')).toBe('major');
      expect(getUpdateType('1.5.3', '2.0.0')).toBe('major');
    });

    it('should identify minor updates', () => {
      expect(getUpdateType('1.0.0', '1.1.0')).toBe('minor');
      expect(getUpdateType('1.0.5', '1.1.0')).toBe('minor');
    });

    it('should identify patch updates', () => {
      expect(getUpdateType('1.0.0', '1.0.1')).toBe('patch');
      expect(getUpdateType('1.0.5', '1.0.6')).toBe('patch');
    });

    it('should return undefined for same version', () => {
      expect(getUpdateType('1.0.0', '1.0.0')).toBeUndefined();
    });

    it('should return undefined when new version is older', () => {
      expect(getUpdateType('2.0.0', '1.0.0')).toBeUndefined();
      expect(getUpdateType('1.1.0', '1.0.0')).toBeUndefined();
    });

    it('should return undefined for invalid versions', () => {
      expect(getUpdateType('invalid', '1.0.0')).toBeUndefined();
      expect(getUpdateType('1.0.0', 'invalid')).toBeUndefined();
    });

    it('should handle prerelease versions', () => {
      expect(getUpdateType('1.0.0', '2.0.0-alpha.1')).toBe('major');
      expect(getUpdateType('1.0.0', '1.1.0-beta.1')).toBe('minor');
    });
  });

  describe('isValidVersion', () => {
    it('should accept valid semantic versions', () => {
      expect(isValidVersion('1.0.0')).toBe(true);
      expect(isValidVersion('1.2.3')).toBe(true);
      expect(isValidVersion('v1.2.3')).toBe(true);
      expect(isValidVersion('1.0.0-alpha')).toBe(true);
    });

    it('should reject invalid versions', () => {
      expect(isValidVersion('invalid')).toBe(false);
      expect(isValidVersion('1.2')).toBe(false);
      expect(isValidVersion('1')).toBe(false);
      expect(isValidVersion('')).toBe(false);
    });
  });

  describe('cleanVersion', () => {
    it('should clean valid versions', () => {
      expect(cleanVersion('v1.2.3')).toBe('1.2.3');
      expect(cleanVersion('1.2.3')).toBe('1.2.3');
    });

    it('should return null for invalid versions', () => {
      expect(cleanVersion('invalid')).toBeNull();
      expect(cleanVersion('')).toBeNull();
    });
  });

  describe('isNewerVersion', () => {
    it('should return true when v1 is newer', () => {
      expect(isNewerVersion('2.0.0', '1.0.0')).toBe(true);
      expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true);
      expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    });

    it('should return false when v1 is older or equal', () => {
      expect(isNewerVersion('1.0.0', '2.0.0')).toBe(false);
      expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    });
  });
});
