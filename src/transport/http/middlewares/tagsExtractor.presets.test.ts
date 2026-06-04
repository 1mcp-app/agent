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
        tagQuery: { $or: [{ tag: 'web' }, { tag: 'api' }] },
        created: '2024-01-01T00:00:00.000Z',
        lastModified: '2024-01-01T00:00:00.000Z',
      });

      mockRequest.query = { preset: 'development' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagQuery).toEqual({ $or: [{ tag: 'web' }, { tag: 'api' }] });
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
        tagQuery: { tag: 'web' },
        created: '2024-01-01T00:00:00.000Z',
        lastModified: '2024-01-01T00:00:00.000Z',
      });

      mockRequest.query = { preset: 'web-only' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagQuery).toEqual({ tag: 'web' });
      expect(getLocals().tags).toEqual(['web']);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle AND strategy preset', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('web,secure');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'secure-web',
        strategy: 'and',
        tagQuery: { $and: [{ tag: 'web' }, { tag: 'secure' }] },
        created: '2024-01-01T00:00:00.000Z',
        lastModified: '2024-01-01T00:00:00.000Z',
      });

      mockRequest.query = { preset: 'secure-web' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagQuery).toEqual({ $and: [{ tag: 'web' }, { tag: 'secure' }] });
      expect(getLocals().tagFilterMode).toBe('preset');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle advanced strategy preset', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('(web+api) or database');
      mockPresetManager.getPreset.mockReturnValue({
        name: 'complex',
        strategy: 'advanced',
        tagQuery: { $or: [{ $and: [{ tag: 'web' }, { tag: 'api' }] }, { tag: 'database' }] },
        created: '2024-01-01T00:00:00.000Z',
        lastModified: '2024-01-01T00:00:00.000Z',
      });

      mockRequest.query = { preset: 'complex' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(getLocals().tagQuery).toEqual({ $or: [{ $and: [{ tag: 'web' }, { tag: 'api' }] }, { tag: 'database' }] });
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
          message: "Preset 'invalid-config' not found",
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 500 for preset manager errors', () => {
      mockPresetManager.resolvePresetToExpression.mockReturnValue('valid,expression');
      // Mock getPreset to throw an error to trigger the outer error handling path
      mockPresetManager.getPreset.mockImplementation(() => {
        throw new Error('Preset manager error');
      });

      mockRequest.query = { preset: 'broken' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InternalError,
          message: 'Failed to resolve filter configuration',
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 when preset lookup returns no preset', () => {
      mockPresetManager.resolvePresetToExpression.mockImplementation(() => {
        throw new Error('Preset manager error');
      });

      mockRequest.query = { preset: 'error-test' };

      tagsExtractor(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: "Preset 'error-test' not found",
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
