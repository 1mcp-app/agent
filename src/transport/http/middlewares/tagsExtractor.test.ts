import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import tagsExtractor from './tagsExtractor.js';
import { PresetManager } from '../../../utils/presetManager.js';

// Mock PresetManager
vi.mock('../../../utils/presetManager.js');

describe('tagsExtractor middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      query: {},
    };
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      locals: {},
    };
    mockNext = vi.fn() as unknown as NextFunction;
  });

  // Helper to safely access locals
  const getLocals = () => mockResponse.locals!;

  describe('Legacy tags parameter', () => {
    it('should parse simple comma-separated tags', () => {
      mockRequest.query = { tags: 'web,api,database' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tags).toEqual(['web', 'api', 'database']);
      expect(getLocals().tagFilterMode).toBe('simple-or');
      expect(getLocals().tagExpression).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle empty tags gracefully', () => {
      mockRequest.query = { tags: 'web,,api,' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tags).toEqual(['web', 'api']);
      expect(getLocals().tagFilterMode).toBe('simple-or');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle whitespace in tags', () => {
      mockRequest.query = { tags: ' web , api , database ' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tags).toEqual(['web', 'api', 'database']);
      expect(getLocals().tagFilterMode).toBe('simple-or');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 400 for non-string tags parameter', () => {
      mockRequest.query = { tags: ['web', 'api'] }; // Array instead of string

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Invalid params: tags must be a string',
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Advanced tag-filter parameter', () => {
    it('should parse simple tag expression', () => {
      mockRequest.query = { 'tag-filter': 'web' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'tag',
        value: 'web',
      });
      expect(getLocals().tagFilterMode).toBe('advanced');
      expect(getLocals().tags).toEqual(['web']); // backward compatibility
      expect(mockNext).toHaveBeenCalled();
    });

    it('should parse AND expression', () => {
      mockRequest.query = { 'tag-filter': 'web+api' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
      expect(getLocals().tagFilterMode).toBe('advanced');
      expect(getLocals().tags).toBeUndefined(); // complex expression
      expect(mockNext).toHaveBeenCalled();
    });

    it('should parse OR expression', () => {
      mockRequest.query = { 'tag-filter': 'web,api' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'or',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
      expect(getLocals().tagFilterMode).toBe('advanced');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should parse NOT expression', () => {
      mockRequest.query = { 'tag-filter': '!test' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'not',
        children: [{ type: 'tag', value: 'test' }],
      });
      expect(getLocals().tagFilterMode).toBe('advanced');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should parse complex expression with parentheses', () => {
      mockRequest.query = { 'tag-filter': '(web,api)+prod' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'and',
        children: [
          {
            type: 'group',
            children: [
              {
                type: 'or',
                children: [
                  { type: 'tag', value: 'web' },
                  { type: 'tag', value: 'api' },
                ],
              },
            ],
          },
          { type: 'tag', value: 'prod' },
        ],
      });
      expect(getLocals().tagFilterMode).toBe('advanced');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 400 for non-string tag-filter parameter', () => {
      mockRequest.query = { 'tag-filter': ['web', 'api'] }; // Array instead of string

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Invalid params: tag-filter must be a string',
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid tag-filter expression', () => {
      mockRequest.query = { 'tag-filter': 'web and' }; // Incomplete expression

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.InvalidParams,
            message: expect.stringContaining('Invalid tag-filter'),
            examples: [
              'tag-filter=web+api',
              'tag-filter=(web,api)+prod',
              'tag-filter=web+api-test',
              'tag-filter=!development',
            ],
          }),
        }),
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Mutual exclusion', () => {
    it('should return 400 when both tags and tag-filter are provided', () => {
      mockRequest.query = {
        tags: 'web,api',
        'tag-filter': 'web+api',
      };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message:
            'Cannot use multiple filtering parameters simultaneously. Use "preset" for dynamic presets, "tag-filter" for advanced expressions, or "tags" for simple OR filtering.',
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('No filtering', () => {
    it('should set default values when no query parameters are provided', () => {
      mockRequest.query = {};

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tags).toBeUndefined();
      expect(getLocals().tagExpression).toBeUndefined();
      expect(getLocals().tagFilterMode).toBe('none');
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Natural language syntax', () => {
    it('should parse natural language AND', () => {
      mockRequest.query = { 'tag-filter': 'web and api' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should parse natural language OR', () => {
      mockRequest.query = { 'tag-filter': 'web or api' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'or',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should parse natural language NOT', () => {
      mockRequest.query = { 'tag-filter': 'not test' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'not',
        children: [{ type: 'tag', value: 'test' }],
      });
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Symbol syntax', () => {
    it('should parse && operator', () => {
      mockRequest.query = { 'tag-filter': 'web && api' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should parse || operator', () => {
      mockRequest.query = { 'tag-filter': 'web || api' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'or',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Preset parameter', () => {
    let mockPresetManager: any;

    beforeEach(() => {
      mockPresetManager = {
        getInstance: vi.fn(),
        resolvePresetToExpression: vi.fn(),
        getPreset: vi.fn(),
      };
      (PresetManager as any).getInstance = vi.fn().mockReturnValue(mockPresetManager);
    });

    it('should process valid preset parameter', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('web,api');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'development',
        strategy: 'or',
        tagExpression: 'web,api',
        servers: ['server1', 'server2'],
      });

      mockRequest.query = { preset: 'development' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'or',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
      expect(getLocals().tagFilterMode).toBe('preset');
      expect(getLocals().presetName).toBe('development');
      expect(getLocals().tags).toEqual(['web', 'api']);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle single tag preset', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('web');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'web-only',
        strategy: 'or',
        tagExpression: 'web',
        servers: ['server1'],
      });

      mockRequest.query = { preset: 'web-only' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'tag',
        value: 'web',
      });
      expect(getLocals().tags).toEqual(['web']);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle AND strategy preset', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('web,secure');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'secure-web',
        strategy: 'and',
        tagExpression: 'web,secure',
        servers: ['server1'],
      });

      mockRequest.query = { preset: 'secure-web' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'secure' },
        ],
      });
      expect(getLocals().tagFilterMode).toBe('preset');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle advanced strategy preset', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('(web+api) or database');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'complex',
        strategy: 'advanced',
        tagExpression: '(web+api) or database',
        servers: ['server1', 'server2'],
      });

      mockRequest.query = { preset: 'complex' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagExpression).toEqual({
        type: 'or',
        children: [
          {
            type: 'group',
            children: [
              {
                type: 'and',
                children: [
                  { type: 'tag', value: 'web' },
                  { type: 'tag', value: 'api' },
                ],
              },
            ],
          },
          { type: 'tag', value: 'database' },
        ],
      });
      expect(getLocals().tagFilterMode).toBe('preset');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 400 for non-existent preset', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue(null);

      mockRequest.query = { preset: 'nonexistent' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: "Preset 'nonexistent' not found",
          examples: ['preset=development', 'preset=production', 'preset=staging'],
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid preset parameter type', () => {
      mockRequest.query = { preset: 123 as any };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Invalid params: preset must be a string',
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for null preset configuration', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('web,api');
      mockPresetManager.getPreset.mockReturnValue(null);

      mockRequest.query = { preset: 'invalid-config' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: "Preset 'invalid-config' configuration invalid",
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 for preset with invalid tag expression', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('invalid(syntax');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'broken',
        strategy: 'advanced',
        tagExpression: 'invalid(syntax',
        servers: ['server1'],
      });

      mockRequest.query = { preset: 'broken' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: "Preset 'broken' has invalid tag expression",
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 500 for preset manager errors', () => {
      mockPresetManager.resolvePresetToExpression.mockImplementation(() => {
        throw new Error('Preset manager error');
      });

      mockRequest.query = { preset: 'error-test' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InternalError,
          message: 'Failed to resolve preset configuration',
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Parameter mutual exclusion', () => {
    it('should reject preset + tags combination', () => {
      mockRequest.query = { preset: 'development', tags: 'web,api' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message:
            'Cannot use multiple filtering parameters simultaneously. Use "preset" for dynamic presets, "tag-filter" for advanced expressions, or "tags" for simple OR filtering.',
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject preset + tag-filter combination', () => {
      mockRequest.query = { preset: 'development', 'tag-filter': 'web+api' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject tags + tag-filter combination', () => {
      mockRequest.query = { tags: 'web,api', 'tag-filter': 'web+api' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject all three parameters together', () => {
      mockRequest.query = {
        preset: 'development',
        tags: 'web,api',
        'tag-filter': 'web+api',
      };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('MongoDB JSON Query Support', () => {
    let mockPresetManager: any;

    beforeEach(() => {
      mockPresetManager = {
        getInstance: vi.fn(),
        resolvePresetToExpression: vi.fn(),
        getPreset: vi.fn(),
      };
      (PresetManager as any).getInstance = vi.fn().mockReturnValue(mockPresetManager);
    });

    it('should process preset with MongoDB $or query', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('context7 OR playwright');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'dev',
        strategy: 'or',
        tagQuery: {
          $or: [{ tag: 'context7' }, { tag: 'playwright' }],
        },
      });

      mockRequest.query = { preset: 'dev' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagQuery).toEqual({
        $or: [{ tag: 'context7' }, { tag: 'playwright' }],
      });
      expect(getLocals().tagFilterMode).toBe('preset');
      expect(getLocals().presetName).toBe('dev');
      expect(getLocals().tags).toEqual(['context7', 'playwright']);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should process preset with MongoDB $and query', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('web AND api');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'production',
        strategy: 'and',
        tagQuery: {
          $and: [{ tag: 'web' }, { tag: 'api' }],
        },
      });

      mockRequest.query = { preset: 'production' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagQuery).toEqual({
        $and: [{ tag: 'web' }, { tag: 'api' }],
      });
      expect(getLocals().tagFilterMode).toBe('preset');
      expect(getLocals().presetName).toBe('production');
      expect(getLocals().tags).toEqual(['web', 'api']);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should process preset with simple tag query', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('database');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'database-only',
        strategy: 'or',
        tagQuery: { tag: 'database' },
      });

      mockRequest.query = { preset: 'database-only' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagQuery).toEqual({ tag: 'database' });
      expect(getLocals().tagFilterMode).toBe('preset');
      expect(getLocals().presetName).toBe('database-only');
      expect(getLocals().tags).toEqual(['database']);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should process preset with complex nested query', () => {
      const complexQuery = {
        $or: [
          { tag: 'frontend' },
          {
            $and: [{ tag: 'backend' }, { tag: 'api' }],
          },
        ],
      };

      mockPresetManager.resolvePresetToExpression.mockReturnValue('frontend OR (backend AND api)');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'complex',
        strategy: 'advanced',
        tagQuery: complexQuery,
      });

      mockRequest.query = { preset: 'complex' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagQuery).toEqual(complexQuery);
      expect(getLocals().tagFilterMode).toBe('preset');
      expect(getLocals().presetName).toBe('complex');
      // For complex queries, we still extract simple tags from the first level
      expect(getLocals().tags).toEqual(['frontend']);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle preset with empty tag query', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('empty-string');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'empty',
        strategy: 'or',
        tagQuery: {},
      });

      mockRequest.query = { preset: 'empty' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagQuery).toEqual({});
      expect(getLocals().tagFilterMode).toBe('preset');
      expect(getLocals().presetName).toBe('empty');
      expect(getLocals().tags).toEqual([]); // Empty array when no tags extracted
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 500 for preset resolution error', () => {
      // Mock an error in the preset resolution
      mockPresetManager.resolvePresetToExpression.mockImplementationOnce(() => {
        throw new Error('Preset resolution failed');
      });

      mockRequest.query = { preset: 'invalid-preset' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InternalError,
          message: 'Failed to resolve preset configuration',
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('extractTagsFromQuery helper function', () => {
    let mockPresetManager: any;

    beforeEach(() => {
      mockPresetManager = {
        getInstance: vi.fn(),
        resolvePresetToExpression: vi.fn(),
        getPreset: vi.fn(),
      };
      (PresetManager as any).getInstance = vi.fn().mockReturnValue(mockPresetManager);
    });

    // We need to test the helper function, but it's not exported
    // Let's test it indirectly through the preset functionality

    it('should extract tags from $or query with simple tags', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('web OR api');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'test',
        strategy: 'or',
        tagQuery: {
          $or: [{ tag: 'web' }, { tag: 'api' }],
        },
      });

      mockRequest.query = { preset: 'test' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tags).toEqual(['web', 'api']);
    });

    it('should extract tags from $and query with simple tags', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('web AND api');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'test',
        strategy: 'and',
        tagQuery: {
          $and: [{ tag: 'web' }, { tag: 'api' }],
        },
      });

      mockRequest.query = { preset: 'test' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tags).toEqual(['web', 'api']);
    });

    it('should extract single tag from simple nested queries', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('complex');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'test',
        strategy: 'advanced',
        tagQuery: {
          $or: [
            { tag: 'frontend' },
            {
              $and: [{ tag: 'backend' }, { tag: 'api' }],
            },
          ],
        },
      });

      mockRequest.query = { preset: 'test' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      // Should extract simple tags from the first level
      expect(getLocals().tags).toEqual(['frontend']);
    });
  });
});
