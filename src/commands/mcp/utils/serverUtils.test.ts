import { InstallationStatus } from '@src/domains/server-management/types.js';

import { describe, expect, it, vi } from 'vitest';

import {
  calculateServerStatus,
  checkServerInUse,
  generateOperationId,
  parseServerNameVersion,
  sanitizeServerNameForPath,
  validateServerName,
  validateVersion,
} from './serverUtils.js';

// Mock ServerManager
vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    current: {
      getClient: vi.fn(),
      getClients: vi.fn(),
    },
  },
}));

// Mock logger
vi.mock('@src/logger/logger.js', () => ({
  default: {
    debug: vi.fn(),
  },
}));

describe('serverUtils', () => {
  describe('parseServerNameVersion', () => {
    it('should parse server name without version', () => {
      expect(parseServerNameVersion('test-server')).toEqual({
        name: 'test-server',
        version: undefined,
      });
    });

    it('should parse server name with version', () => {
      expect(parseServerNameVersion('test-server@1.2.3')).toEqual({
        name: 'test-server',
        version: '1.2.3',
      });
    });

    it('should handle complex server names with org prefixes', () => {
      expect(parseServerNameVersion('io.github/user/server-name@2.0.0')).toEqual({
        name: 'io.github/user/server-name',
        version: '2.0.0',
      });
    });

    it('should handle server names with multiple @ symbols correctly', () => {
      expect(parseServerNameVersion('user/project@domain@1.0.0')).toEqual({
        name: 'user/project@domain',
        version: '1.0.0',
      });
    });

    it('should throw error for empty server name with version', () => {
      expect(() => parseServerNameVersion('@1.2.3')).toThrow('Server name cannot be empty');
    });

    it('should handle empty version (ends with @)', () => {
      expect(parseServerNameVersion('server-name@')).toEqual({
        name: 'server-name',
        version: '',
      });
    });

    it('should handle pre-release versions', () => {
      expect(parseServerNameVersion('test-server@1.0.0-alpha')).toEqual({
        name: 'test-server',
        version: '1.0.0-alpha',
      });
    });

    it('should handle build metadata versions', () => {
      expect(parseServerNameVersion('test-server@1.0.0+build.123')).toEqual({
        name: 'test-server',
        version: '1.0.0+build.123',
      });
    });
  });

  describe('validateServerName', () => {
    it('should accept valid server names', () => {
      expect(() => validateServerName('valid-server')).not.toThrow();
      expect(() => validateServerName('server123')).not.toThrow();
      expect(() => validateServerName('test_server')).not.toThrow();
      expect(() => validateServerName('my-server')).not.toThrow();
      expect(() => validateServerName('a')).not.toThrow(); // Single character
    });

    it('should reject empty server name', () => {
      expect(() => validateServerName('')).toThrow('Server name cannot be empty');
      expect(() => validateServerName(null as any)).toThrow('Server name cannot be empty');
      expect(() => validateServerName(undefined as any)).toThrow('Server name cannot be empty');
    });

    it('should reject server names starting with non-letter', () => {
      expect(() => validateServerName('123server')).toThrow('must start with a letter');
      expect(() => validateServerName('_server')).toThrow('must start with a letter');
      expect(() => validateServerName('-server')).toThrow('must start with a letter');
      expect(() => validateServerName('123')).toThrow('must start with a letter');
    });

    it('should reject server names with invalid characters', () => {
      expect(() => validateServerName('server.name')).toThrow('contain only letters, numbers, underscores, or hyphens');
      expect(() => validateServerName('server$name')).toThrow('contain only letters, numbers, underscores, or hyphens');
      expect(() => validateServerName('server@name')).toThrow('contain only letters, numbers, underscores, or hyphens');
      expect(() => validateServerName('server name')).toThrow('contain only letters, numbers, underscores, or hyphens');
      expect(() => validateServerName('server/name')).toThrow('contain only letters, numbers, underscores, or hyphens');
    });

    it('should reject server names that are too long', () => {
      const longName = 'a'.repeat(51);
      expect(() => validateServerName(longName)).toThrow('Server name must be 50 characters or less');
    });

    it('should accept server names at the length limit', () => {
      const maxLengthName = 'a'.repeat(50);
      expect(() => validateServerName(maxLengthName)).not.toThrow();
    });

    it('should handle edge cases with special characters', () => {
      expect(() => validateServerName('server\nname')).toThrow(
        'contain only letters, numbers, underscores, or hyphens',
      );
      expect(() => validateServerName('server\tname')).toThrow(
        'contain only letters, numbers, underscores, or hyphens',
      );
    });
  });

  describe('validateVersion', () => {
    it('should accept valid semantic versions', () => {
      expect(validateVersion('1.0.0')).toBe(true);
      expect(validateVersion('10.20.30')).toBe(true);
      expect(validateVersion('0.0.1')).toBe(true);
      expect(validateVersion('2.1.3')).toBe(true);
    });

    it('should accept versions with pre-release identifiers', () => {
      expect(validateVersion('1.0.0-alpha')).toBe(true);
      expect(validateVersion('1.0.0-beta')).toBe(true);
      expect(validateVersion('2.0.0-dev')).toBe(true);
    });

    it('should reject invalid version formats', () => {
      expect(validateVersion('1.0')).toBe(false); // Missing patch
      expect(validateVersion('1')).toBe(false); // Missing minor and patch
      expect(validateVersion('1.0.0.0')).toBe(false); // Too many parts
      expect(validateVersion('v1.0.0')).toBe(false); // Leading 'v'
      expect(validateVersion('1.0.0-beta+build')).toBe(false); // Plus sign not supported in current regex
      expect(validateVersion('')).toBe(false); // Empty string
      expect(validateVersion('not.a.version')).toBe(false); // Non-numeric parts
      expect(validateVersion('1..0')).toBe(false); // Empty part
      expect(validateVersion('1.0.')).toBe(false); // Trailing dot
      expect(validateVersion('.1.0')).toBe(false); // Leading dot
    });

    it('should reject versions with non-numeric parts', () => {
      expect(validateVersion('a.b.c')).toBe(false);
      expect(validateVersion('1.x.0')).toBe(false);
      expect(validateVersion('1.0.z')).toBe(false);
    });
  });

  describe('calculateServerStatus', () => {
    it('should return NOT_INSTALLED when no installed version', () => {
      expect(calculateServerStatus('', '1.0.0')).toBe(InstallationStatus.NOT_INSTALLED);
      expect(calculateServerStatus(undefined as any, '1.0.0')).toBe(InstallationStatus.NOT_INSTALLED);
      expect(calculateServerStatus(null as any, '1.0.0')).toBe(InstallationStatus.NOT_INSTALLED);
    });

    it('should return INSTALLED when installed version matches latest', () => {
      expect(calculateServerStatus('1.0.0', '1.0.0')).toBe(InstallationStatus.INSTALLED);
      expect(calculateServerStatus('2.1.3', '2.1.3')).toBe(InstallationStatus.INSTALLED);
    });

    it('should return INSTALLED when no latest version provided', () => {
      expect(calculateServerStatus('1.0.0')).toBe(InstallationStatus.INSTALLED);
      expect(calculateServerStatus('2.1.3', undefined)).toBe(InstallationStatus.INSTALLED);
      expect(calculateServerStatus('1.0.0', '')).toBe(InstallationStatus.INSTALLED);
    });

    it('should return OUTDATED when installed version differs from latest', () => {
      expect(calculateServerStatus('1.0.0', '1.1.0')).toBe(InstallationStatus.OUTDATED);
      expect(calculateServerStatus('1.0.0', '2.0.0')).toBe(InstallationStatus.OUTDATED);
      expect(calculateServerStatus('2.1.3', '2.1.4')).toBe(InstallationStatus.OUTDATED);
      expect(calculateServerStatus('1.0.0', '0.9.0')).toBe(InstallationStatus.OUTDATED); // Even downgrade scenarios
    });

    it('should handle edge cases with version strings', () => {
      expect(calculateServerStatus('1.0.0', '1.0.0-beta')).toBe(InstallationStatus.OUTDATED);
      expect(calculateServerStatus('1.0.0-alpha', '1.0.0')).toBe(InstallationStatus.OUTDATED);
    });
  });

  describe('checkServerInUse', () => {
    // Note: This function depends on ServerManager.current which has complex initialization
    // We'll test the basic behavior without mocking the complex singleton pattern

    it('should return false when ServerManager throws error', () => {
      // This will likely be false when ServerManager is not initialized
      expect(checkServerInUse('non-existent-server')).toBe(false);
    });

    it('should handle various server names gracefully', () => {
      // Test that the function doesn't crash with different input types
      expect(() => checkServerInUse('')).not.toThrow();
      expect(() => checkServerInUse('test-server')).not.toThrow();
      expect(() => checkServerInUse('server-with-special_chars-123')).not.toThrow();
    });
  });

  describe('generateOperationId', () => {
    it('should generate operation ID with correct format', () => {
      const operationId = generateOperationId();
      expect(operationId).toMatch(/^op_\d+_[a-z0-9]{7}$/);
    });

    it('should generate unique operation IDs', () => {
      const operationId1 = generateOperationId();
      const operationId2 = generateOperationId();
      const operationId3 = generateOperationId();

      expect(operationId1).not.toBe(operationId2);
      expect(operationId2).not.toBe(operationId3);
      expect(operationId1).not.toBe(operationId3);
    });

    it('should generate operation IDs with timestamp prefix', () => {
      const beforeTime = Date.now();
      const operationId = generateOperationId();
      const afterTime = Date.now();

      const timestampPart = operationId.split('_')[1];
      const timestamp = parseInt(timestampPart, 10);

      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should generate operation IDs with random suffix', () => {
      const operationId = generateOperationId();
      const parts = operationId.split('_');

      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe('op');
      expect(parts[1]).toMatch(/^\d+$/); // Timestamp
      expect(parts[2]).toMatch(/^[a-z0-9]{7}$/); // Random string
    });

    it('should generate valid operation IDs in quick succession', () => {
      const operationIds = Array.from({ length: 100 }, () => generateOperationId());

      operationIds.forEach((id) => {
        expect(id).toMatch(/^op_\d+_[a-z0-9]{7}$/);
      });

      // Check all are unique
      const uniqueIds = new Set(operationIds);
      expect(uniqueIds.size).toBe(operationIds.length);
    });
  });

  describe('sanitizeServerNameForPath', () => {
    it('should keep valid characters unchanged', () => {
      expect(sanitizeServerNameForPath('valid-server')).toBe('valid-server');
      expect(sanitizeServerNameForPath('test_server')).toBe('test_server');
      expect(sanitizeServerNameForPath('server123')).toBe('server123');
      expect(sanitizeServerNameForPath('my-server-123_test')).toBe('my-server-123_test');
    });

    it('should replace invalid characters with underscores', () => {
      expect(sanitizeServerNameForPath('server.name')).toBe('server_name');
      expect(sanitizeServerNameForPath('server$name')).toBe('server_name');
      expect(sanitizeServerNameForPath('server@name')).toBe('server_name');
      expect(sanitizeServerNameForPath('server name')).toBe('server_name');
      expect(sanitizeServerNameForPath('server/name')).toBe('server_name');
      expect(sanitizeServerNameForPath('server\\name')).toBe('server_name');
    });

    it('should handle multiple consecutive invalid characters', () => {
      expect(sanitizeServerNameForPath('server..name')).toBe('server__name');
      expect(sanitizeServerNameForPath('server$name@name')).toBe('server_name_name');
      expect(sanitizeServerNameForPath('server/\\name')).toBe('server__name');
    });

    it('should handle special characters at boundaries', () => {
      expect(sanitizeServerNameForPath('.server')).toBe('_server');
      expect(sanitizeServerNameForPath('server.')).toBe('server_');
      expect(sanitizeServerNameForPath('/server/')).toBe('_server_');
    });

    it('should handle empty string', () => {
      expect(sanitizeServerNameForPath('')).toBe('');
    });

    it('should handle strings with only invalid characters', () => {
      expect(sanitizeServerNameForPath('...')).toBe('___');
      expect(sanitizeServerNameForPath('$$$')).toBe('___');
      expect(sanitizeServerNameForPath('   ')).toBe('___');
    });

    it('should handle complex real-world server names', () => {
      expect(sanitizeServerNameForPath('io.github/user/server-name')).toBe('io_github_user_server-name');
      expect(sanitizeServerNameForPath('@myorg/server@prod')).toBe('_myorg_server_prod');
      expect(sanitizeServerNameForPath('my-server:8080')).toBe('my-server_8080');
    });

    it('should preserve case for alphanumeric characters', () => {
      expect(sanitizeServerNameForPath('ServerName')).toBe('ServerName');
      expect(sanitizeServerNameForPath('my-Server-123')).toBe('my-Server-123');
    });
  });

  describe('integration tests', () => {
    it('should work together for typical server management workflow', () => {
      // Parse and validate a server input
      const parsed = parseServerNameVersion('my-server@1.2.3');
      validateServerName(parsed.name);

      // Calculate status
      const status = calculateServerStatus('1.0.0', '1.2.3');
      expect(status).toBe(InstallationStatus.OUTDATED);

      // Generate operation ID
      const operationId = generateOperationId();
      expect(operationId).toMatch(/^op_\d+_[a-z0-9]{7}$/);

      // Sanitize for path usage
      const pathName = sanitizeServerNameForPath(parsed.name);
      expect(pathName).toBe('my-server');

      // Validate version
      expect(validateVersion(parsed.version!)).toBe(true);
    });

    it('should handle edge case server names from registry', () => {
      const complexNames = [
        'io.github/author/awesome-server@2.1.0-beta',
        '@npmjs/package@latest@1.0.0',
        'server-with.many@special#chars@3.2.1-alpha.1',
      ];

      complexNames.forEach((input) => {
        expect(() => {
          const parsed = parseServerNameVersion(input);
          sanitizeServerNameForPath(parsed.name);
          if (parsed.version) {
            validateVersion(parsed.version);
          }
        }).not.toThrow();
      });
    });
  });
});
