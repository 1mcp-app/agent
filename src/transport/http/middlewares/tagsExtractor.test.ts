import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import tagsExtractor from './tagsExtractor.js';

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
            'Cannot use both "tags" and "tag-filter" parameters. Use "tags" for simple OR filtering, or "tag-filter" for advanced expressions.',
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
});
