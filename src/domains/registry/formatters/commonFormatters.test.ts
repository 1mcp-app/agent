import { ServerPackage } from '@src/domains/registry/types.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatDate,
  formatRegistryTypesPlain,
  formatRelativeDate,
  formatStatus,
  formatTimestamp,
  formatTransport,
  formatTransportTypesPlain,
  truncateString,
} from './commonFormatters.js';

// Mock chalk to capture color formatting
vi.mock('chalk', () => ({
  default: {
    green: vi.fn((text) => `GREEN:${text}`),
    yellow: vi.fn((text) => `YELLOW:${text}`),
    red: vi.fn((text) => `RED:${text}`),
    gray: vi.fn((text) => `GRAY:${text}`),
  },
}));

describe('commonFormatters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('truncateString', () => {
    it('should return original string if within max length', () => {
      const result = truncateString('Hello', 10);
      expect(result).toBe('Hello');
    });

    it('should return original string if exactly max length', () => {
      const result = truncateString('Hello', 5);
      expect(result).toBe('Hello');
    });

    it('should truncate string and add ellipsis if longer than max length', () => {
      const result = truncateString('Hello World', 8);
      expect(result).toBe('Hello...');
    });

    it('should handle very short max length', () => {
      const result = truncateString('Hello', 3);
      expect(result).toBe('...');
    });

    it('should handle empty string', () => {
      const result = truncateString('', 5);
      expect(result).toBe('');
    });

    it('should handle max length of 0', () => {
      const result = truncateString('Hello', 0);
      expect(result).toBe('...');
    });
  });

  describe('formatTransport', () => {
    it('should return empty string for undefined transport', () => {
      const result = formatTransport(undefined);
      expect(result).toBe('');
    });

    it('should return string transport as-is', () => {
      const result = formatTransport('stdio');
      expect(result).toBe('stdio');
    });

    it('should extract type from transport object', () => {
      const result = formatTransport({ type: 'custom-transport' });
      expect(result).toBe('custom-transport');
    });

    it('should convert transport object to string if no type property', () => {
      const result = formatTransport({ protocol: 'http' } as any);
      expect(result).toBe('[object Object]');
    });

    it('should handle null transport', () => {
      const result = formatTransport(null as any);
      expect(result).toBe('');
    });

    it('should handle number transport', () => {
      const result = formatTransport(3000 as any);
      expect(result).toBe('3000');
    });
  });

  describe('formatStatus', () => {
    it('should format active status with green color', () => {
      const result = formatStatus('active');
      expect(result).toBe('GREEN:● ACTIVE');
    });

    it('should format deprecated status with yellow color', () => {
      const result = formatStatus('deprecated');
      expect(result).toBe('YELLOW:● DEPRECATED');
    });

    it('should format archived status with red color', () => {
      const result = formatStatus('archived');
      expect(result).toBe('RED:● ARCHIVED');
    });

    it('should format unknown status with gray color', () => {
      const result = formatStatus('unknown');
      expect(result).toBe('GRAY:● UNKNOWN');
    });

    it('should format custom status with gray color', () => {
      const result = formatStatus('custom-status');
      expect(result).toBe('GRAY:● CUSTOM-STATUS');
    });

    it('should handle empty status', () => {
      const result = formatStatus('');
      expect(result).toBe('GRAY:● ');
    });
  });

  describe('formatRegistryTypesPlain', () => {
    it('should format single registry type', () => {
      const packages: ServerPackage[] = [{ registryType: 'npm', identifier: 'test', transport: { type: 'stdio' } }];
      const result = formatRegistryTypesPlain(packages);
      expect(result).toBe('npm');
    });

    it('should format multiple unique registry types', () => {
      const packages: ServerPackage[] = [
        { registryType: 'npm', identifier: 'test1', transport: { type: 'stdio' } },
        { registryType: 'pypi', identifier: 'test2', transport: { type: 'stdio' } },
        { registryType: 'docker', identifier: 'test3', transport: { type: 'stdio' } },
      ];
      const result = formatRegistryTypesPlain(packages);
      expect(result).toBe('npm, pypi, docker');
    });

    it('should deduplicate registry types', () => {
      const packages: ServerPackage[] = [
        { registryType: 'npm', identifier: 'test1', transport: { type: 'stdio' } },
        { registryType: 'npm', identifier: 'test2', transport: { type: 'stdio' } },
        { registryType: 'pypi', identifier: 'test3', transport: { type: 'stdio' } },
      ];
      const result = formatRegistryTypesPlain(packages);
      expect(result).toBe('npm, pypi');
    });

    it('should filter out undefined registry types', () => {
      const packages: ServerPackage[] = [
        { registryType: 'npm', identifier: 'test1', transport: { type: 'stdio' } },
        { registryType: undefined as any, identifier: 'test2', transport: { type: 'stdio' } },
        { registryType: 'pypi', identifier: 'test3', transport: { type: 'stdio' } },
      ];
      const result = formatRegistryTypesPlain(packages);
      expect(result).toBe('npm, pypi');
    });

    it('should return "unknown" for empty packages array', () => {
      const result = formatRegistryTypesPlain([]);
      expect(result).toBe('unknown');
    });

    it('should return "unknown" for undefined packages', () => {
      const result = formatRegistryTypesPlain(undefined);
      expect(result).toBe('unknown');
    });

    it('should return "unknown" when all packages have undefined registry types', () => {
      const packages: ServerPackage[] = [
        { registryType: undefined as any, identifier: 'test1', transport: { type: 'stdio' } },
        { registryType: undefined as any, identifier: 'test2', transport: { type: 'stdio' } },
      ];
      const result = formatRegistryTypesPlain(packages);
      expect(result).toBe('unknown');
    });
  });

  describe('formatTransportTypesPlain', () => {
    it('should format single transport type', () => {
      const packages: ServerPackage[] = [{ registryType: 'npm', identifier: 'test', transport: { type: 'stdio' } }];
      const result = formatTransportTypesPlain(packages);
      expect(result).toBe('stdio');
    });

    it('should format multiple unique transport types', () => {
      const packages: ServerPackage[] = [
        { registryType: 'npm', identifier: 'test1', transport: { type: 'stdio' } },
        { registryType: 'npm', identifier: 'test2', transport: { type: 'sse' } },
        { registryType: 'npm', identifier: 'test3', transport: { type: 'webhook' } },
      ];
      const result = formatTransportTypesPlain(packages);
      expect(result).toBe('stdio, sse, webhook');
    });

    it('should deduplicate transport types', () => {
      const packages: ServerPackage[] = [
        { registryType: 'npm', identifier: 'test1', transport: { type: 'stdio' } },
        { registryType: 'npm', identifier: 'test2', transport: { type: 'stdio' } },
        { registryType: 'npm', identifier: 'test3', transport: { type: 'sse' } },
      ];
      const result = formatTransportTypesPlain(packages);
      expect(result).toBe('stdio, sse');
    });

    it('should handle transport objects', () => {
      const packages: ServerPackage[] = [
        { registryType: 'npm', identifier: 'test1', transport: { type: 'custom' } },
        { registryType: 'npm', identifier: 'test2', transport: { type: 'stdio' } },
      ];
      const result = formatTransportTypesPlain(packages);
      expect(result).toBe('custom, stdio');
    });

    it('should filter out empty transport values', () => {
      const packages: ServerPackage[] = [
        { registryType: 'npm', identifier: 'test1', transport: { type: 'stdio' } },
        { registryType: 'npm', identifier: 'test2', transport: undefined },
        { registryType: 'npm', identifier: 'test3', transport: { type: 'sse' } },
      ];
      const result = formatTransportTypesPlain(packages);
      expect(result).toBe('stdio, sse');
    });

    it('should return "stdio" for empty packages array', () => {
      const result = formatTransportTypesPlain([]);
      expect(result).toBe('stdio');
    });

    it('should return "stdio" for undefined packages', () => {
      const result = formatTransportTypesPlain(undefined);
      expect(result).toBe('stdio');
    });

    it('should return "stdio" when no valid transports found', () => {
      const packages: ServerPackage[] = [
        { registryType: 'npm', identifier: 'test1', transport: undefined },
        { registryType: 'npm', identifier: 'test2', transport: null as any },
      ];
      const result = formatTransportTypesPlain(packages);
      expect(result).toBe('stdio');
    });
  });

  describe('formatDate', () => {
    it('should format valid ISO date string', () => {
      const result = formatDate('2023-01-15T12:30:00Z');
      expect(result).toBe('Jan 15, 2023');
    });

    it('should format valid ISO date string with different format', () => {
      const result = formatDate('2023-12-25T00:00:00Z');
      expect(result).toBe('Dec 25, 2023');
    });

    it('should return "Unknown" for empty string', () => {
      const result = formatDate('');
      expect(result).toBe('Unknown');
    });

    it('should return "Unknown" for null', () => {
      const result = formatDate(null as any);
      expect(result).toBe('Unknown');
    });

    it('should return "Unknown" for undefined', () => {
      const result = formatDate(undefined as any);
      expect(result).toBe('Unknown');
    });

    it('should return "Invalid Date" for invalid date string', () => {
      const result = formatDate('not-a-date');
      expect(result).toBe('Invalid Date');
    });

    it('should return "Invalid Date" for malformed ISO string', () => {
      const result = formatDate('2023-13-45T25:70:99Z');
      expect(result).toBe('Invalid Date');
    });

    it('should handle non-string input', () => {
      const result = formatDate(123 as any);
      expect(result).toBe('Unknown');
    });
  });

  describe('formatRelativeDate', () => {
    beforeEach(() => {
      // Mock Date.now() to return a fixed time for consistent testing
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2023-01-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return "Just now" for very recent dates', () => {
      const result = formatRelativeDate('2023-01-15T11:59:30Z');
      expect(result).toBe('Just now');
    });

    it('should return minutes ago for recent dates', () => {
      const result = formatRelativeDate('2023-01-15T11:55:00Z');
      expect(result).toBe('5 minutes ago');
    });

    it('should return single minute for 1 minute ago', () => {
      const result = formatRelativeDate('2023-01-15T11:59:00Z');
      expect(result).toBe('1 minute ago');
    });

    it('should return hours ago for dates within same day', () => {
      const result = formatRelativeDate('2023-01-15T09:00:00Z');
      expect(result).toBe('3 hours ago');
    });

    it('should return single hour for 1 hour ago', () => {
      const result = formatRelativeDate('2023-01-15T11:00:00Z');
      expect(result).toBe('1 hour ago');
    });

    it('should return days ago for recent dates', () => {
      const result = formatRelativeDate('2023-01-13T12:00:00Z');
      expect(result).toBe('2 days ago');
    });

    it('should return single day for 1 day ago', () => {
      const result = formatRelativeDate('2023-01-14T12:00:00Z');
      expect(result).toBe('1 day ago');
    });

    it('should return formatted date for dates older than 7 days', () => {
      const result = formatRelativeDate('2023-01-01T12:00:00Z');
      expect(result).toBe('Jan 1, 2023');
    });

    it('should return "Unknown" for empty string', () => {
      const result = formatRelativeDate('');
      expect(result).toBe('Unknown');
    });

    it('should return "Invalid Date" for invalid date string', () => {
      const result = formatRelativeDate('not-a-date');
      expect(result).toBe('Invalid Date');
    });

    it('should handle future dates gracefully', () => {
      const result = formatRelativeDate('2023-01-16T12:00:00Z');
      expect(result).toBe('Just now'); // Future dates show as "just now"
    });
  });

  describe('formatTimestamp', () => {
    it('should format valid ISO timestamp with time', () => {
      const result = formatTimestamp('2023-01-15T12:30:45Z');
      // Result will depend on system locale, but should include date and time
      expect(result).toMatch(/Jan.*15.*2023/);
      // Time will be converted to local timezone, so just check it contains time info
      expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    });

    it('should format timestamp with different time', () => {
      const result = formatTimestamp('2023-12-25T23:59:59Z');
      // Date might be converted to next day due to timezone, so check for Dec 25 or 26
      expect(result).toMatch(/Dec.*(25|26).*2023/);
      // Time will be converted to local timezone, so just check it contains time info
      expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    });

    it('should return original string for invalid date', () => {
      const result = formatTimestamp('invalid-date');
      expect(result).toBe('invalid-date');
    });

    it('should handle empty string', () => {
      const result = formatTimestamp('');
      expect(result).toBe('');
    });

    it('should handle malformed ISO string', () => {
      const malformed = '2023-13-45T25:70:99Z';
      const result = formatTimestamp(malformed);
      expect(result).toBe(malformed);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle all functions with null/undefined inputs gracefully', () => {
      expect(() => truncateString(null as any, 5)).not.toThrow();
      expect(() => formatTransport(null as any)).not.toThrow();
      expect(() => formatStatus(null as any)).not.toThrow();
      expect(() => formatRegistryTypesPlain(null as any)).not.toThrow();
      expect(() => formatTransportTypesPlain(null as any)).not.toThrow();
      expect(() => formatDate(null as any)).not.toThrow();
      expect(() => formatRelativeDate(null as any)).not.toThrow();
      expect(() => formatTimestamp(null as any)).not.toThrow();
    });

    it('should handle extreme date values', () => {
      // Very old date
      const veryOld = formatDate('1900-01-01T00:00:00Z');
      expect(veryOld).toBe('Jan 1, 1900');

      // Very future date - use noon to avoid timezone issues
      const veryFuture = formatDate('2100-12-31T12:00:00Z');
      expect(veryFuture).toBe('Dec 31, 2100');
    });

    it('should handle packages with mixed valid and invalid data', () => {
      const mixedPackages: ServerPackage[] = [
        { registryType: 'npm', identifier: 'valid', transport: { type: 'stdio' } },
        { registryType: null as any, identifier: 'invalid1', transport: undefined },
        { registryType: 'pypi', identifier: 'valid2', transport: { type: 'custom' } },
        { registryType: '', identifier: 'invalid2', transport: null as any },
      ];

      const registryTypes = formatRegistryTypesPlain(mixedPackages);
      expect(registryTypes).toBe('npm, pypi');

      const transportTypes = formatTransportTypesPlain(mixedPackages);
      expect(transportTypes).toBe('stdio, custom');
    });
  });
});
