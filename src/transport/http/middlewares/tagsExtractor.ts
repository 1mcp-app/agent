import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import { TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import { TagQuery } from '@src/domains/preset/types/presetTypes.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { sendBadRequest } from '@src/transport/http/utils/httpErrorHandler.js';
import { validateAndSanitizeTags } from '@src/utils/validation/sanitization.js';

import { NextFunction, Request, Response } from 'express';

/**
 * Extract simple tags from a MongoDB-style query for backward compatibility
 */
function extractTagsFromQuery(query: TagQuery): string[] {
  if (!query || typeof query !== 'object') {
    return [];
  }

  const tags: string[] = [];

  function extractFromQuery(q: TagQuery): void {
    if (!q || typeof q !== 'object') {
      return;
    }

    // Simple tag match
    if (q.tag) {
      tags.push(q.tag);
      return;
    }

    // $or with tag matches - only extract simple direct tags
    if (q.$or && Array.isArray(q.$or)) {
      for (const subQuery of q.$or) {
        if (subQuery.tag) {
          tags.push(subQuery.tag);
        }
        // Don't recurse into nested queries for simplicity
      }
      return;
    }

    // $and with tag matches - only extract simple direct tags
    if (q.$and && Array.isArray(q.$and)) {
      for (const subQuery of q.$and) {
        if (subQuery.tag) {
          tags.push(subQuery.tag);
        }
        // Don't recurse into nested queries for simplicity
      }
      return;
    }
  }

  extractFromQuery(query);
  return tags;
}

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
 * - tagQuery: TagQuery | undefined (for MongoDB-style preset queries)
 * - tagFilterMode: 'preset' | 'advanced' | 'simple-or' | 'none'
 * - presetName: string | undefined (for preset tracking)
 */
export default function tagsExtractor(req: Request, res: Response, next: NextFunction) {
  const hasPreset = req.query.preset !== undefined;
  const hasTags = req.query.tags !== undefined;
  const hasTagFilter = req.query['tag-filter'] !== undefined;
  const hasFilter = req.query.filter !== undefined;

  // Mutual exclusion check - preset takes priority
  const paramCount = [hasPreset, hasTags, hasTagFilter, hasFilter].filter(Boolean).length;
  if (paramCount > 1) {
    sendBadRequest(
      res,
      'Cannot use multiple filtering parameters simultaneously. Use "preset" for dynamic presets, "tag-filter" for advanced expressions, or "tags" for simple OR filtering.',
    );
    return;
  }

  // Handle preset parameter (highest priority)
  if (hasPreset) {
    const presetName = req.query.preset as string;
    if (typeof presetName !== 'string') {
      sendBadRequest(res, 'Invalid params: preset must be a string');
      return;
    }

    try {
      const presetManager = PresetManager.getInstance();
      const tagExpression = presetManager.resolvePresetToExpression(presetName);

      if (!tagExpression) {
        sendBadRequest(res, `Preset '${presetName}' not found`, {
          examples: ['preset=development', 'preset=production', 'preset=staging'],
        });
        return;
      }

      // Use the preset's JSON tagQuery directly instead of parsing string expression
      const preset = presetManager.getPreset(presetName);
      if (!preset) {
        sendBadRequest(res, `Preset '${presetName}' configuration invalid`);
        return;
      }

      try {
        // Store the MongoDB-style JSON query directly for evaluation
        res.locals.tagQuery = preset.tagQuery;
        res.locals.tagFilterMode = 'preset';
        res.locals.presetName = presetName;

        // For backward compatibility, extract simple tags if possible
        const extractedTags = extractTagsFromQuery(preset.tagQuery);
        res.locals.tags = extractedTags.length > 0 ? extractedTags : [];

        debugIf(() => ({
          message: 'Preset parameter processed',
          meta: {
            presetName,
            strategy: preset.strategy,
            tagQuery: preset.tagQuery,
          },
        }));

        next();
        return;
      } catch (error) {
        logger.error('Failed to process preset tag query', { presetName, tagQuery: preset.tagQuery, error });
        sendBadRequest(res, `Preset '${presetName}' has invalid tag query`);
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
      sendBadRequest(res, 'Invalid params: tags must be a string');
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
        sendBadRequest(res, `Invalid tags: ${validation.errors.join('; ')}`, {
          details: {
            errors: validation.errors,
            warnings: validation.warnings,
            invalidTags: validation.invalidTags,
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
      sendBadRequest(res, 'Invalid params: tag-filter must be a string');
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
      sendBadRequest(res, `Invalid tag-filter: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        examples: [
          'tag-filter=web+api',
          'tag-filter=(web,api)+prod',
          'tag-filter=web+api-test',
          'tag-filter=!development',
        ],
      });
    }
    return;
  }

  // Handle filter parameter (STDIO proxy compatibility)
  if (hasFilter) {
    const filterStr = req.query.filter as string;

    if (typeof filterStr !== 'string') {
      res.status(400).json({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Invalid params: filter must be a string',
        },
      });
      return;
    }

    try {
      // Try to parse as advanced expression first
      try {
        const expression = TagQueryParser.parseAdvanced(filterStr);
        res.locals.tagExpression = expression;
        res.locals.tagFilterMode = 'advanced';
        res.locals.tags = expression.type === 'tag' ? [expression.value!] : undefined;
        debugIf(() => ({
          message: 'Filter parameter processed (advanced mode)',
          meta: { filterStr, expression },
        }));
        next();
        return;
      } catch (_advancedError) {
        // Fall back to simple parsing for comma-separated tags
        const rawTags = TagQueryParser.parseSimple(filterStr);
        if (rawTags.length > 0) {
          const validation = validateAndSanitizeTags(rawTags);

          if (validation.errors.length > 0) {
            res.status(400).json({
              error: {
                code: ErrorCode.InvalidParams,
                message: `Invalid filter: ${validation.errors.join('; ')}`,
              },
            });
            return;
          }

          res.locals.tags = validation.validTags.length > 0 ? validation.validTags : undefined;
          res.locals.tagFilterMode = 'simple-or';
          debugIf(() => ({
            message: 'Filter parameter processed (simple mode)',
            meta: { filterStr, tags: res.locals.tags },
          }));
          next();
          return;
        }
        // Empty filter after parsing - treat as invalid
        res.status(400).json({
          error: {
            code: ErrorCode.InvalidParams,
            message: `Invalid filter: empty or malformed filter expression`,
          },
        });
        return;
      }
    } catch (error) {
      res.status(400).json({
        error: {
          code: ErrorCode.InvalidParams,
          message: `Invalid filter: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      });
      return;
    }
  }

  // No filtering
  res.locals.tags = undefined;
  res.locals.tagExpression = undefined;
  res.locals.tagFilterMode = 'none';
  next();
}
