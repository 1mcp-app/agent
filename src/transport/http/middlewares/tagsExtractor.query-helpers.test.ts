import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { PresetManager } from '@src/domains/preset/manager/presetManager.js';

import { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import tagsExtractor from './tagsExtractor.js';

// Mock PresetManager
vi.mock('@src/domains/preset/manager/presetManager.js');

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

  describe('Parameter mutual exclusion', () => {
    it('should reject preset + tags combination', () => {
      mockRequest.query = { preset: 'development', tags: 'web,api' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message:
            'Cannot use multiple filtering parameters simultaneously. Use "preset" for dynamic presets, "tag-filter" for advanced expressions, "filter" for legacy compatibility, or "tags" for simple OR filtering.',
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
      // Recursive extraction feeds scope validation with every referenced tag.
      expect(getLocals().tags).toEqual(['frontend', 'backend', 'api']);
      expect(getLocals().filterSelection).toMatchObject({
        mode: 'preset',
        requestedTags: ['frontend', 'backend', 'api'],
      });
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

    it('should return 400 for missing preset resolution result', () => {
      // Mock an error in the preset resolution
      mockPresetManager.resolvePresetToExpression.mockImplementationOnce(() => {
        throw new Error('Preset resolution failed');
      });

      mockRequest.query = { preset: 'invalid-preset' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: "Preset 'invalid-preset' not found",
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

      // Should extract all referenced tags for scope validation.
      expect(getLocals().tags).toEqual(['frontend', 'backend', 'api']);
    });
  });
});
