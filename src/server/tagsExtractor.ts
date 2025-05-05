import { Request, Response, NextFunction } from 'express';
import { ERROR_CODES } from '../constants.js';

/**
 * Middleware to extract and validate 'tags' from query parameters.
 * Attaches tags as res.locals.tags (string[] | undefined).
 */
export default function tagsExtractor(req: Request, res: Response, next: NextFunction) {
  let tags: string[] | undefined;
  if (req.query.tags) {
    const tagsStr = req.query.tags as string;
    if (typeof tagsStr !== 'string') {
      res.status(400).json({
        error: {
          code: ERROR_CODES.INVALID_PARAMS,
          message: 'Invalid params: tags must be a string',
        },
      });
      return;
    }
    tags = tagsStr.split(',').filter((tag) => tag.trim().length > 0);
  }
  // Attach tags to res.locals for downstream handlers
  res.locals.tags = tags;
  next();
}
