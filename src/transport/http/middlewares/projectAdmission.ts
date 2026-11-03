import { getProjectLifecycle, ProjectDrainingError, projectPaths } from '@src/application/projectLifecycle.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { extractTemplateContextRequest } from '@src/transport/http/utils/contextExtractor.js';
import { authorizeRequestTemplateContext } from '@src/transport/http/utils/templateContextAuthority.js';

import type { Request, RequestHandler, Response } from 'express';

/** The context here grants no authority; ingress still performs its normal proof and auth checks. */
export function withHttpProjectAdmission(
  serverManager: ServerManager,
  work: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return async (req, res) => {
    try {
      const lifecycle = getProjectLifecycle();
      if (!lifecycle) {
        await work(req, res);
        return;
      }
      const extracted = extractTemplateContextRequest(req);
      const session = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(session) ? session[0] : session;
      const authorization = extracted
        ? authorizeRequestTemplateContext({ ...extracted, transportSessionId: sessionId })
        : undefined;
      const contexts = sessionId
        ? [...(serverManager.getTemplateServerManager?.()?.getSessionProjectContexts?.(sessionId) ?? [])]
        : [];
      if (authorization?.status === 'trusted') contexts.push(authorization.context);
      await lifecycle.run(contexts.flatMap(projectPaths), () => work(req, res));
    } catch (error) {
      if (!(error instanceof ProjectDrainingError)) throw error;
      res.status(409).json({ error: error.message, ...error.data });
    }
  };
}
