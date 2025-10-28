import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import logger from '@src/logger/logger.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UrlGenerator } from './urlGenerator.js';

// Mock dependencies
vi.mock('@src/core/server/agentConfig.js');
vi.mock('../config/presetManager.js');
vi.mock('@src/logger/logger.js');

const mockAgentConfig = AgentConfigManager as any;
const mockPresetManager = PresetManager as any;

describe('UrlGenerator', () => {
  let urlGenerator: UrlGenerator;
  let mockAgentConfigInstance: any;
  let mockPresetManagerInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock AgentConfigManager
    mockAgentConfigInstance = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'externalUrl') return 'http://localhost:3050';
        if (key === 'host') return 'localhost';
        if (key === 'port') return 3050;
        if (key === 'features') return { auth: false };
        return undefined;
      }),
      getUrl: vi.fn().mockReturnValue('http://localhost:3050'),
      getStreambleHttpUrl: vi.fn().mockReturnValue('http://localhost:3050/mcp'),
      isAuthEnabled: vi.fn().mockReturnValue(false),
    };
    mockAgentConfig.getInstance = vi.fn().mockReturnValue(mockAgentConfigInstance);

    // Mock PresetManager
    mockPresetManagerInstance = {
      hasPreset: vi.fn(),
      getPreset: vi.fn(),
      validatePreset: vi.fn(),
    };
    mockPresetManager.getInstance = vi.fn().mockReturnValue(mockPresetManagerInstance);

    urlGenerator = new UrlGenerator();
  });

  describe('generatePresetUrl', () => {
    it('should generate URL with preset parameter', () => {
      const url = urlGenerator.generatePresetUrl('development');

      expect(url).toBe('http://localhost:3050/mcp?preset=development');
      expect(logger.debug).toHaveBeenCalledWith('Generated preset URL', {
        presetName: 'development',
        url: 'http://localhost:3050/mcp?preset=development',
      });
    });

    it('should handle preset names with special characters', () => {
      const url = urlGenerator.generatePresetUrl('dev-staging_v2');
      expect(url).toBe('http://localhost:3050/mcp?preset=dev-staging_v2');
    });
  });

  describe('generateTagFilterUrl', () => {
    it('should generate URL with tag-filter parameter', () => {
      const url = urlGenerator.generateTagFilterUrl('web+api-test');

      expect(url).toBe('http://localhost:3050/?tag-filter=web%2Bapi-test');
      expect(logger.debug).toHaveBeenCalledWith('Generated tag filter URL', {
        tagFilter: 'web+api-test',
        url: 'http://localhost:3050/?tag-filter=web%2Bapi-test',
      });
    });
  });

  describe('generateTagsUrl', () => {
    it('should generate URL with tags parameter (deprecated)', () => {
      const url = urlGenerator.generateTagsUrl(['web', 'api', 'database']);

      expect(url).toBe('http://localhost:3050/mcp?tags=web%2Capi%2Cdatabase');
      expect(logger.debug).toHaveBeenCalledWith('Generated tags URL (deprecated)', {
        tags: ['web', 'api', 'database'],
        url: 'http://localhost:3050/mcp?tags=web%2Capi%2Cdatabase',
      });
    });

    it('should handle empty tags array', () => {
      const url = urlGenerator.generateTagsUrl([]);
      expect(url).toBe('http://localhost:3050/mcp?tags=');
    });
  });

  describe('generateUrl', () => {
    beforeEach(() => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
    });

    it('should prioritize preset over other options', () => {
      const url = urlGenerator.generateUrl({
        preset: 'development',
        tagFilter: 'web+api',
        tags: ['web', 'api'],
      });

      expect(url).toBe('http://localhost:3050/mcp?preset=development');
    });

    it('should use tag-filter when no preset', () => {
      const url = urlGenerator.generateUrl({
        tagFilter: 'web+api',
        tags: ['web', 'api'],
      });

      expect(url).toBe('http://localhost:3050/mcp?tag-filter=web%2Bapi');
    });

    it('should use tags when no preset or tag-filter', () => {
      const url = urlGenerator.generateUrl({
        tags: ['web', 'api'],
      });

      expect(url).toBe('http://localhost:3050/mcp?tags=web%2Capi');
    });

    it('should generate base URL when no filtering options', () => {
      const url = urlGenerator.generateUrl({});
      expect(url).toBe('http://localhost:3050/mcp');
    });

    it('should add custom parameters', () => {
      const url = urlGenerator.generateUrl({
        preset: 'development',
        customParams: {
          sessionId: 'test-session',
          debug: 'true',
        },
      });

      expect(url).toBe('http://localhost:3050/mcp?preset=development&sessionId=test-session&debug=true');
    });

    it('should throw error for non-existent preset', () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(false);

      expect(() => urlGenerator.generateUrl({ preset: 'nonexistent' })).toThrow("Preset 'nonexistent' not found");
    });

    it('should include auth parameters when enabled', () => {
      mockAgentConfigInstance.isAuthEnabled.mockReturnValue(true);

      const url = urlGenerator.generateUrl({
        preset: 'development',
        includeAuth: true,
      });

      // Note: Auth parameters would be added here in actual implementation
      expect(url).toBe('http://localhost:3050/mcp?preset=development');
    });

    it('should log generation details', () => {
      const options = {
        preset: 'development',
        customParams: { debug: 'true' },
      };

      urlGenerator.generateUrl(options);

      expect(logger.debug).toHaveBeenCalledWith('Generated URL', {
        options,
        url: 'http://localhost:3050/mcp?preset=development&debug=true',
        baseUrl: 'http://localhost:3050/mcp',
      });
    });
  });

  describe('validateAndGeneratePresetUrl', () => {
    it('should validate and generate URL for valid preset', async () => {
      const mockPreset = {
        name: 'development',
        strategy: 'or' as const,
        servers: ['server1'],
        tagExpression: 'web,api',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
      };

      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
      mockPresetManagerInstance.getPreset.mockReturnValue(mockPreset);
      mockPresetManagerInstance.validatePreset.mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: [],
      });

      const result = await urlGenerator.validateAndGeneratePresetUrl('development');

      expect(result).toEqual({
        url: 'http://localhost:3050/mcp?preset=development',
        valid: true,
      });
    });

    it('should return error for non-existent preset', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(false);

      const result = await urlGenerator.validateAndGeneratePresetUrl('nonexistent');

      expect(result).toEqual({
        url: '',
        valid: false,
        error: "Preset 'nonexistent' not found",
      });
    });

    it('should return error for invalid preset configuration', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
      mockPresetManagerInstance.getPreset.mockReturnValue(null);

      const result = await urlGenerator.validateAndGeneratePresetUrl('invalid');

      expect(result).toEqual({
        url: '',
        valid: false,
        error: "Preset 'invalid' configuration is invalid",
      });
    });

    it('should return validation errors', async () => {
      const mockPreset = {
        name: 'invalid',
        strategy: 'or' as const,
        servers: [],
        tagExpression: '',
        created: '2025-01-01T00:00:00Z',
        lastModified: '2025-01-01T00:00:00Z',
      };

      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
      mockPresetManagerInstance.getPreset.mockReturnValue(mockPreset);
      mockPresetManagerInstance.validatePreset.mockResolvedValue({
        isValid: false,
        errors: ['No servers specified', 'Empty tag expression'],
        warnings: [],
      });

      const result = await urlGenerator.validateAndGeneratePresetUrl('invalid');

      expect(result).toEqual({
        url: '',
        valid: false,
        error: 'Preset validation failed: No servers specified; Empty tag expression',
      });
    });

    it('should handle validation errors gracefully', async () => {
      mockPresetManagerInstance.hasPreset.mockReturnValue(true);
      mockPresetManagerInstance.getPreset.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = await urlGenerator.validateAndGeneratePresetUrl('error');

      expect(result).toEqual({
        url: '',
        valid: false,
        error: 'Failed to generate URL: Unexpected error',
      });

      expect(logger.error).toHaveBeenCalledWith(
        'URL validation and generation failed',
        expect.objectContaining({ presetName: 'error' }),
      );
    });
  });

  describe('parseUrl', () => {
    it('should parse URL with preset parameter', () => {
      const result = urlGenerator.parseUrl('http://localhost:3050/mcp?preset=development&debug=true');

      expect(result).toEqual({
        preset: 'development',
        otherParams: { debug: 'true' },
      });
    });

    it('should parse URL with tag-filter parameter', () => {
      const result = urlGenerator.parseUrl('http://localhost:3050/mcp?tag-filter=web%2Bapi&sessionId=test');

      expect(result).toEqual({
        tagFilter: 'web+api',
        otherParams: { sessionId: 'test' },
      });
    });

    it('should parse URL with tags parameter', () => {
      const result = urlGenerator.parseUrl('http://localhost:3050/mcp?tags=web%2Capi%2Cdatabase');

      expect(result).toEqual({
        tags: ['web', 'api', 'database'],
        otherParams: {},
      });
    });

    it('should handle URL with no parameters', () => {
      const result = urlGenerator.parseUrl('http://localhost:3050/mcp');

      expect(result).toEqual({
        otherParams: {},
      });
    });

    it('should handle invalid URL gracefully', () => {
      const result = urlGenerator.parseUrl('not-a-valid-url');

      expect(result).toEqual({
        otherParams: {},
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to parse URL',
        expect.objectContaining({ url: 'not-a-valid-url' }),
      );
    });

    it('should prioritize preset over other filtering parameters', () => {
      const result = urlGenerator.parseUrl('http://localhost:3050/mcp?preset=dev&tag-filter=web&tags=api');

      expect(result).toEqual({
        preset: 'dev',
        otherParams: {},
      });
    });

    it('should handle empty tags parameter', () => {
      const result = urlGenerator.parseUrl('http://localhost:3050/mcp?tags=');

      // Empty tags parameter should not set tags property
      expect(result).toEqual({
        otherParams: {},
      });
    });
  });

  describe('utility methods', () => {
    describe('getBaseUrl', () => {
      it('should return base URL without parameters', () => {
        const url = urlGenerator.getBaseUrl();
        expect(url).toBe('http://localhost:3050');
      });
    });

    describe('isPresetUrl', () => {
      it('should return true for URL with preset parameter', () => {
        const result = urlGenerator.isPresetUrl('http://localhost:3050/mcp?preset=development');
        expect(result).toBe(true);
      });

      it('should return false for URL without preset parameter', () => {
        const result = urlGenerator.isPresetUrl('http://localhost:3050/mcp?tags=web,api');
        expect(result).toBe(false);
      });

      it('should return false for invalid URL', () => {
        const result = urlGenerator.isPresetUrl('invalid-url');
        expect(result).toBe(false);
      });
    });

    describe('extractPresetName', () => {
      it('should extract preset name from URL', () => {
        const result = urlGenerator.extractPresetName('http://localhost:3050/mcp?preset=development&debug=true');
        expect(result).toBe('development');
      });

      it('should return null for URL without preset', () => {
        const result = urlGenerator.extractPresetName('http://localhost:3050/mcp?tags=web,api');
        expect(result).toBeNull();
      });

      it('should return null for invalid URL', () => {
        const result = urlGenerator.extractPresetName('invalid-url');
        expect(result).toBeNull();
      });
    });

    describe('generateConnectionString', () => {
      it('should generate connection string for MCP clients', () => {
        mockPresetManagerInstance.hasPreset.mockReturnValue(true);

        const connectionString = urlGenerator.generateConnectionString({
          preset: 'development',
        });

        expect(connectionString).toBe('http://localhost:3050/mcp?preset=development');
      });

      it('should handle empty options', () => {
        const connectionString = urlGenerator.generateConnectionString();
        expect(connectionString).toBe('http://localhost:3050/mcp');
      });
    });
  });

  describe('integration with different base URLs', () => {
    it('should work with HTTPS URLs', () => {
      mockAgentConfigInstance.get.mockImplementation((key: string) => {
        if (key === 'externalUrl') return 'https://api.example.com:8443';
        if (key === 'host') return 'api.example.com';
        if (key === 'port') return 8443;
        if (key === 'features') return { auth: false };
        return undefined;
      });
      mockAgentConfigInstance.getStreambleHttpUrl.mockReturnValue('https://api.example.com:8443/mcp');

      const url = urlGenerator.generatePresetUrl('production');
      expect(url).toBe('https://api.example.com:8443/mcp?preset=production');
    });

    it('should work with URLs containing paths', () => {
      mockAgentConfigInstance.get.mockImplementation((key: string) => {
        if (key === 'externalUrl') return 'http://localhost:3050/api/v1';
        if (key === 'host') return 'localhost';
        if (key === 'port') return 3050;
        if (key === 'features') return { auth: false };
        return undefined;
      });
      mockAgentConfigInstance.getStreambleHttpUrl.mockReturnValue('http://localhost:3050/api/v1/mcp');

      const url = urlGenerator.generatePresetUrl('development');
      expect(url).toBe('http://localhost:3050/api/v1/mcp?preset=development');
    });

    it('should handle URLs with existing query parameters', () => {
      mockAgentConfigInstance.get.mockImplementation((key: string) => {
        if (key === 'externalUrl') return 'http://localhost:3050';
        if (key === 'host') return 'localhost';
        if (key === 'port') return 3050;
        if (key === 'features') return { auth: false };
        return undefined;
      });
      mockAgentConfigInstance.getStreambleHttpUrl.mockReturnValue('http://localhost:3050/mcp');

      const url = urlGenerator.generatePresetUrl('development');
      expect(url).toBe('http://localhost:3050/mcp?preset=development');
    });
  });
});
