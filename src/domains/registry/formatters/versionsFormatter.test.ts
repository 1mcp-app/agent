import { ServerVersionsResponse } from '@src/domains/registry/types.js';
import printer from '@src/utils/ui/printer.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formatServerVersions } from './versionsFormatter.js';

// Mock printer
vi.mock('@src/utils/ui/printer.js', () => ({
  default: {
    table: vi.fn(),
    raw: vi.fn(),
    blank: vi.fn(),
    title: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    subtitle: vi.fn(),
    keyValue: vi.fn(),
  },
}));

// Mock chalk to capture color formatting
vi.mock('chalk', () => {
  const createChalkMock = (color: string) => {
    const mockFn = vi.fn((text: string) => {
      const result = `${color.toUpperCase()}:${text}`;
      // Create a new object that can have properties added
      const resultObj = Object.assign(result, {
        bold: vi.fn((boldText: string) => `${color.toUpperCase()}:BOLD:${boldText}`),
      });
      // Ensure it's a string, not an array
      return String(resultObj);
    });
    // Add chained methods to the function itself
    (mockFn as any).bold = vi.fn((text: string) => `${color.toUpperCase()}:BOLD:${text}`);
    return mockFn;
  };

  const chalkMock = {
    cyan: createChalkMock('cyan'),
    yellow: createChalkMock('yellow'),
    red: createChalkMock('red'),
    gray: createChalkMock('gray'),
    white: createChalkMock('white'),
    green: createChalkMock('green'),
    bold: createChalkMock('bold'),
  };

  // Add dynamic property access support
  const proxy = new Proxy(chalkMock, {
    get(target, prop) {
      if (prop in target) {
        return target[prop as keyof typeof target];
      }
      // Return a default mock for any other color
      return createChalkMock(prop as string);
    },
  });

  return {
    default: proxy,
  };
});

describe('versionsFormatter', () => {
  let mockVersionsResponse: ServerVersionsResponse;

  beforeEach(() => {
    vi.clearAllMocks();

    mockVersionsResponse = {
      name: 'test-server',
      serverId: 'test-server-id',
      versions: [
        {
          version: '1.2.0',
          status: 'active',
          isLatest: true,
          publishedAt: '2023-02-01T00:00:00Z',
          updatedAt: '2023-02-01T00:00:00Z',
        },
        {
          version: '1.1.0',
          status: 'active',
          isLatest: false,
          publishedAt: '2023-01-15T00:00:00Z',
          updatedAt: '2023-01-16T00:00:00Z',
        },
        {
          version: '1.0.0',
          status: 'deprecated',
          isLatest: false,
          publishedAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-01T00:00:00Z',
        },
        {
          version: '0.9.0',
          status: 'archived',
          isLatest: false,
          publishedAt: '2022-12-01T00:00:00Z',
          updatedAt: '2022-12-01T00:00:00Z',
        },
      ],
    };
  });

  describe('formatServerVersions', () => {
    it('should format versions in JSON format', () => {
      const result = formatServerVersions(mockVersionsResponse, 'json');

      expect(result).toBe(JSON.stringify(mockVersionsResponse, null, 2));
    });

    it('should format versions in table format by default', () => {
      const result = formatServerVersions(mockVersionsResponse);

      expect(result).toContain('Versions for test-server (4 total):');
      expect(printer.table).toHaveBeenCalledTimes(1);

      // Check that the table was called with proper data
      const tableCall = (printer.table as any).mock.calls[0][0];
      expect(tableCall.rows).toHaveLength(4);
      expect(tableCall.rows[0]).toEqual({
        Version: '1.2.0',
        Status: 'active',
        Latest: 'Yes',
        Published: expect.any(String),
        Updated: expect.any(String),
      });
    });

    it('should format versions in table format explicitly', () => {
      const result = formatServerVersions(mockVersionsResponse, 'table');

      expect(result).toContain('Versions for test-server (4 total):');
      expect(printer.table).toHaveBeenCalledTimes(1);
    });

    it('should format versions in detailed format', () => {
      const result = formatServerVersions(mockVersionsResponse, 'detailed');

      // Should be wrapped in boxen
      expect(result).toContain('test-server');
      expect(result).toContain('4 versions');
      expect(result).toContain('1.2.0');
      expect(result).toContain('[LATEST]');
      expect(result).toContain('● active');
      expect(result).toContain('● deprecated');
      expect(result).toContain('● archived');
      expect(result).toContain('Server Information:');
      expect(result).toContain('Server ID: test-server-id');
    });

    it('should handle empty versions array', () => {
      const emptyVersionsResponse: ServerVersionsResponse = {
        name: 'empty-server',
        serverId: 'empty-server-id',
        versions: [],
      };

      const tableResult = formatServerVersions(emptyVersionsResponse, 'table');
      expect(tableResult).toContain('No versions found for server: empty-server');

      const detailedResult = formatServerVersions(emptyVersionsResponse, 'detailed');
      expect(detailedResult).toContain('YELLOW:No versions found for server: empty-server');
    });

    it('should sort versions by published date (newest first)', () => {
      // Mix up the order to test sorting
      const unsortedVersionsResponse: ServerVersionsResponse = {
        name: 'test-server',
        serverId: 'test-server-id',
        versions: [
          {
            version: '1.0.0',
            status: 'deprecated',
            isLatest: false,
            publishedAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
          },
          {
            version: '1.2.0',
            status: 'active',
            isLatest: true,
            publishedAt: '2023-02-01T00:00:00Z',
            updatedAt: '2023-02-01T00:00:00Z',
          },
          {
            version: '1.1.0',
            status: 'active',
            isLatest: false,
            publishedAt: '2023-01-15T00:00:00Z',
            updatedAt: '2023-01-16T00:00:00Z',
          },
        ],
      };

      formatServerVersions(unsortedVersionsResponse, 'table');

      const tableCall = (printer.table as any).mock.calls[0][0];
      expect(tableCall.rows[0].Version).toBe('1.2.0'); // Newest first
      expect(tableCall.rows[1].Version).toBe('1.1.0');
      expect(tableCall.rows[2].Version).toBe('1.0.0'); // Oldest last
    });

    it('should show "Yes" for latest version and "No" for others', () => {
      formatServerVersions(mockVersionsResponse, 'table');

      const tableCall = (printer.table as any).mock.calls[0][0];
      expect(tableCall.rows[0].Latest).toBe('Yes'); // 1.2.0
      expect(tableCall.rows[1].Latest).toBe('No'); // 1.1.0
      expect(tableCall.rows[2].Latest).toBe('No'); // 1.0.0
      expect(tableCall.rows[3].Latest).toBe('No'); // 0.9.0
    });

    it('should handle versions with same published and updated dates', () => {
      const versionsWithSameDates: ServerVersionsResponse = {
        name: 'test-server',
        serverId: 'test-server-id',
        versions: [
          {
            version: '1.0.0',
            status: 'active',
            isLatest: true,
            publishedAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
          },
        ],
      };

      const result = formatServerVersions(versionsWithSameDates, 'detailed');

      // Should not show duplicate date information
      expect(result).toContain('Published:');
      expect(result).toContain('1.0.0');
    });

    it('should show different published and updated dates', () => {
      const versionsWithDifferentDates: ServerVersionsResponse = {
        name: 'test-server',
        serverId: 'test-server-id',
        versions: [
          {
            version: '1.1.0',
            status: 'active',
            isLatest: true,
            publishedAt: '2023-01-15T00:00:00Z',
            updatedAt: '2023-01-16T00:00:00Z',
          },
        ],
      };

      const result = formatServerVersions(versionsWithDifferentDates, 'detailed');

      expect(result).toContain('Published:');
      expect(result).toContain('Updated:');
    });

    it('should count active and deprecated versions correctly', () => {
      const result = formatServerVersions(mockVersionsResponse, 'detailed');

      expect(result).toContain('Active Versions: 2'); // 1.2.0 and 1.1.0
      expect(result).toContain('Deprecated Versions: 1'); // 1.0.0
    });

    it('should handle single version', () => {
      const singleVersionResponse: ServerVersionsResponse = {
        name: 'single-version-server',
        serverId: 'single-version-id',
        versions: [
          {
            version: '1.0.0',
            status: 'active',
            isLatest: true,
            publishedAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
          },
        ],
      };

      const tableResult = formatServerVersions(singleVersionResponse, 'table');
      expect(tableResult).toContain('Versions for single-version-server (1 total):');

      const detailedResult = formatServerVersions(singleVersionResponse, 'detailed');
      expect(detailedResult).toContain('CYAN:BOLD:single-version-serverGRAY: (1 version)');
    });

    it('should handle all archived versions', () => {
      const archivedVersionsResponse: ServerVersionsResponse = {
        name: 'archived-server',
        serverId: 'archived-server-id',
        versions: [
          {
            version: '0.1.0',
            status: 'archived',
            isLatest: false,
            publishedAt: '2022-01-01T00:00:00Z',
            updatedAt: '2022-01-01T00:00:00Z',
          },
        ],
      };

      const result = formatServerVersions(archivedVersionsResponse, 'detailed');

      expect(result).toContain('Active Versions: 0');
      expect(result).toContain('Deprecated Versions: 0');
      expect(result).toContain('● archived');
    });

    it('should handle versions with unknown status', () => {
      const unknownStatusVersionsResponse: ServerVersionsResponse = {
        name: 'unknown-status-server',
        serverId: 'unknown-status-id',
        versions: [
          {
            version: '1.0.0',
            status: 'unknown' as any,
            isLatest: true,
            publishedAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
          },
        ],
      };

      const result = formatServerVersions(unknownStatusVersionsResponse, 'detailed');

      expect(result).toContain('● unknown');
    });

    it('should handle invalid date formats gracefully', () => {
      const invalidDateVersionsResponse: ServerVersionsResponse = {
        name: 'invalid-date-server',
        serverId: 'invalid-date-id',
        versions: [
          {
            version: '1.0.0',
            status: 'active',
            isLatest: true,
            publishedAt: 'invalid-date',
            updatedAt: 'invalid-date',
          },
        ],
      };

      expect(() => {
        formatServerVersions(invalidDateVersionsResponse, 'table');
      }).not.toThrow();

      expect(() => {
        formatServerVersions(invalidDateVersionsResponse, 'detailed');
      }).not.toThrow();
    });

    it('should handle missing server ID', () => {
      const noServerIdResponse: ServerVersionsResponse = {
        name: 'no-id-server',
        serverId: '',
        versions: [
          {
            version: '1.0.0',
            status: 'active',
            isLatest: true,
            publishedAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z',
          },
        ],
      };

      const result = formatServerVersions(noServerIdResponse, 'detailed');

      expect(result).toContain('Server ID:');
    });
  });
});
