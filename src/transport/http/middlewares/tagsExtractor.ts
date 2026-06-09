import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { resolveFilterSelection } from '@src/core/filtering/filterSelection.js';
import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import logger from '@src/logger/logger.js';
import { sendBadRequest } from '@src/transport/http/utils/httpErrorHandler.js';

import { NextFunction, Request, Response } from 'express';

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
  try {
    const presetManager = PresetManager.getInstance();
    const result = resolveFilterSelection(
      {
        preset: req.query.preset,
        tagFilter: req.query['tag-filter'],
        filter: req.query.filter,
        tags: req.query.tags,
      },
      {
        presetLookup: {
          getPreset: (name) => {
            const preset = presetManager.getPreset(name);
            return preset
              ? {
                  name,
                  strategy: preset.strategy,
                  tagQuery: preset.tagQuery,
                }
              : undefined;
          },
        },
      },
    );

    if (!result.ok) {
      if (result.error.code === 'invalid_preset') {
        logger.error('Failed to process preset tag query', result.error.details);
      }

      const details =
        'details' in result.error && result.error.details && typeof result.error.details === 'object'
          ? (result.error.details as Record<string, unknown>)
          : undefined;
      sendBadRequest(res, result.error.message, details);
      return;
    }

    const { compatibility } = result.selection;
    res.locals.filterSelection = result.selection;
    res.locals.tags = compatibility.tags;
    res.locals.tagExpression = compatibility.tagExpression;
    res.locals.tagQuery = compatibility.tagQuery;
    res.locals.tagFilterMode = compatibility.tagFilterMode;
    res.locals.presetName = compatibility.presetName;
    res.locals.tagWarnings = compatibility.tagWarnings;

    next();
  } catch (error) {
    logger.error('Filter selection failed', { error });
    res.status(500).json({
      error: {
        code: ErrorCode.InternalError,
        message: 'Failed to resolve filter configuration',
      },
    });
  }
}
