import { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TagQueryParser } from '../../../utils/tagQueryParser.js';
import { validateAndSanitizeTags } from '../../../utils/sanitization.js';
import logger from '../../../logger/logger.js';

/**
 * Middleware to extract and validate tag filters from query parameters.
 * Supports both simple 'tags' parameter (OR logic, backward compatible)
 * and advanced 'tag-filter' parameter (boolean expressions).
 *
 * Attaches to res.locals:
 * - tags: string[] | undefined (for backward compatibility)
 * - tagExpression: TagExpression | undefined (for advanced filtering)
 * - tagFilterMode: 'simple-or' | 'advanced' | 'none'
 */
export default function tagsExtractor(req: Request, res: Response, next: NextFunction) {
  const hasTags = req.query.tags !== undefined;
  const hasTagFilter = req.query['tag-filter'] !== undefined;

  // Mutual exclusion check
  if (hasTags && hasTagFilter) {
    res.status(400).json({
      error: {
        code: ErrorCode.InvalidParams,
        message:
          'Cannot use both "tags" and "tag-filter" parameters. Use "tags" for simple OR filtering, or "tag-filter" for advanced expressions.',
      },
    });
    return;
  }

  // Handle legacy tags parameter (OR logic)
  if (hasTags) {
    const tagsStr = req.query.tags as string;
    if (typeof tagsStr !== 'string') {
      res.status(400).json({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Invalid params: tags must be a string',
        },
      });
      return;
    }

    // Parse basic comma-separated tags
    const rawTags = TagQueryParser.parseSimple(tagsStr);

    if (rawTags.length > 0) {
      // Validate and sanitize the tags
      const validation = validateAndSanitizeTags(rawTags);

      // If there are validation errors, return 400
      if (validation.errors.length > 0) {
        logger.warn('Tag validation failed', {
          errors: validation.errors,
          warnings: validation.warnings,
          originalTags: rawTags,
          invalidTags: validation.invalidTags,
        });

        res.status(400).json({
          error: {
            code: ErrorCode.InvalidParams,
            message: `Invalid tags: ${validation.errors.join('; ')}`,
            details: {
              errors: validation.errors,
              warnings: validation.warnings,
              invalidTags: validation.invalidTags,
            },
          },
        });
        return;
      }

      // Log warnings if any
      if (validation.warnings.length > 0) {
        logger.warn('Tag validation warnings', {
          warnings: validation.warnings,
          originalTags: rawTags,
          sanitizedTags: validation.validTags,
        });
      }

      res.locals.tags = validation.validTags.length > 0 ? validation.validTags : undefined;
      res.locals.tagWarnings = validation.warnings;
    } else {
      res.locals.tags = undefined;
      res.locals.tagWarnings = [];
    }

    res.locals.tagFilterMode = 'simple-or';
    next();
    return;
  }

  // Handle new tag-filter parameter (advanced expressions)
  if (hasTagFilter) {
    const filterStr = req.query['tag-filter'] as string;
    if (typeof filterStr !== 'string') {
      res.status(400).json({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Invalid params: tag-filter must be a string',
        },
      });
      return;
    }

    try {
      const expression = TagQueryParser.parseAdvanced(filterStr);
      res.locals.tagExpression = expression;
      res.locals.tagFilterMode = 'advanced';
      // Provide backward compatible tags array for simple single-tag cases
      res.locals.tags = expression.type === 'tag' ? [expression.value!] : undefined;
      next();
    } catch (error) {
      res.status(400).json({
        error: {
          code: ErrorCode.InvalidParams,
          message: `Invalid tag-filter: ${error instanceof Error ? error.message : 'Unknown error'}`,
          examples: [
            'tag-filter=web+api',
            'tag-filter=(web,api)+prod',
            'tag-filter=web+api-test',
            'tag-filter=!development',
          ],
        },
      });
    }
    return;
  }

  // No filtering
  res.locals.tags = undefined;
  res.locals.tagExpression = undefined;
  res.locals.tagFilterMode = 'none';
  next();
}
