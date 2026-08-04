import { CONTEXT_HEADERS } from '@src/transport/http/utils/contextExtractor.js';

import { Request } from 'express';

export function getRequestSessionId(req: Request): string | undefined {
  const headerSessionId = req.headers?.[CONTEXT_HEADERS.SESSION_ID];
  return Array.isArray(headerSessionId) ? headerSessionId[0] : headerSessionId;
}
