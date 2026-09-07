import { LEGACY_PROTOCOL_REVISIONS } from '@src/gateway/contracts/protocolEra.js';
import logger from '@src/logger/logger.js';
import { ErrorCode } from '@src/sdk/contracts/index.js';

import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

const protocolVersionHeaderSchema = z.string();

export default function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  logger.error('Express error:', err);
  const rawClaimedVersion = req.headers?.['mcp-protocol-version'];
  const parsedVersion = protocolVersionHeaderSchema.safeParse(rawClaimedVersion);
  const claimedVersion = parsedVersion.success ? parsedVersion.data : undefined;
  if (
    req.path === '/mcp' &&
    claimedVersion !== undefined &&
    !(LEGACY_PROTOCOL_REVISIONS as readonly string[]).includes(claimedVersion) &&
    err instanceof SyntaxError
  ) {
    res.status(400).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
    return;
  }
  res.status(500).json({
    error: {
      code: ErrorCode.InternalError,
      message: 'Internal server error',
    },
  });
}
