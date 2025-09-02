import { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TagQueryParser } from '../../../utils/tagQueryParser.js';
import { validateAndSanitizeTags } from '../../../utils/sanitization.js';
import { PresetManager } from '../../../utils/presetManager.js';
import logger from '../../../logger/logger.js';

/**
 * Middleware to extract and validate tag filters from query parameters.
 * Supports:
 * - 'preset' parameter (dynamic preset-based filtering)
 * - 'tag-filter' parameter (advanced boolean expressions)
 * - 'tags' parameter (simple OR logic, deprecated)
 *
 * Attaches to res.locals:
 * - tags: string[] | undefined (for backward compatibility)
 * - tagExpression: TagExpression | undefined (for advanced filtering)
 * - tagFilterMode: 'preset' | 'advanced' | 'simple-or' | 'none'
 * - presetName: string | undefined (for preset tracking)
 */
export default function tagsExtractor(req: Request, res: Response, next: NextFunction) {
  const hasPreset = req.query.preset !== undefined;
  const hasTags = req.query.tags !== undefined;
  const hasTagFilter = req.query['tag-filter'] !== undefined;

  // Mutual exclusion check - preset takes priority
  const paramCount = [hasPreset, hasTags, hasTagFilter].filter(Boolean).length;
  if (paramCount > 1) {
    res.status(400).json({
      error: {
        code: ErrorCode.InvalidParams,
        message:
          'Cannot use multiple filtering parameters simultaneously. Use "preset" for dynamic presets, "tag-filter" for advanced expressions, or "tags" for simple OR filtering.',
      },
    });
    return;
  }

  // Handle preset parameter (highest priority)
  if (hasPreset) {
    const presetName = req.query.preset as string;
    if (typeof presetName !== 'string') {
      res.status(400).json({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Invalid params: preset must be a string',
        },
      });
      return;
    }

    try {
      const presetManager = PresetManager.getInstance();
      const tagExpression = presetManager.resolvePresetToExpression(presetName);

      if (!tagExpression) {
        res.status(400).json({
          error: {
            code: ErrorCode.InvalidParams,
            message: `Preset '${presetName}' not found`,
            examples: ['preset=development', 'preset=production', 'preset=staging'],
          },
        });
        return;
      }

      // Parse the preset's tag expression
      const preset = presetManager.getPreset(presetName);
      if (!preset) {
        res.status(400).json({
          error: {
            code: ErrorCode.InvalidParams,
            message: `Preset '${presetName}' configuration invalid`,
          },
        });
        return;
      }

      try {
        let parsedExpression;
        if (preset.strategy === 'advanced') {
          parsedExpression = TagQueryParser.parseAdvanced(tagExpression);
        } else {
          // Convert simple strategies to expressions
          const tags = TagQueryParser.parseSimple(tagExpression);
          if (tags.length === 0) {
            parsedExpression = { type: 'tag', value: '' } as any;
          } else if (preset.strategy === 'or') {
            parsedExpression =
              tags.length === 1
                ? { type: 'tag', value: tags[0] }
                : { type: 'or', children: tags.map((tag) => ({ type: 'tag', value: tag })) };
          } else {
            // 'and'
            parsedExpression =
              tags.length === 1
                ? { type: 'tag', value: tags[0] }
                : { type: 'and', children: tags.map((tag) => ({ type: 'tag', value: tag })) };
          }
        }

        res.locals.tagExpression = parsedExpression;
        res.locals.tagFilterMode = 'preset';
        res.locals.presetName = presetName;

        // Provide backward compatible tags array for simple cases
        if (parsedExpression.type === 'tag' && parsedExpression.value) {
          res.locals.tags = [parsedExpression.value];
        } else if (parsedExpression.type === 'or' && parsedExpression.children?.every((c: any) => c.type === 'tag')) {
          res.locals.tags = parsedExpression.children.map((c: any) => c.value);
        }

        logger.debug('Preset parameter processed', {
          presetName,
          strategy: preset.strategy,
          expression: tagExpression,
        });

        next();
        return;
      } catch (error) {
        logger.error('Failed to parse preset tag expression', { presetName, tagExpression, error });
        res.status(400).json({
          error: {
            code: ErrorCode.InvalidParams,
            message: `Preset '${presetName}' has invalid tag expression`,
          },
        });
        return;
      }
    } catch (error) {
      logger.error('Preset resolution failed', { presetName, error });
      res.status(500).json({
        error: {
          code: ErrorCode.InternalError,
          message: 'Failed to resolve preset configuration',
        },
      });
      return;
    }
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
