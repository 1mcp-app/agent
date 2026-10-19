import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { revalidatePreparationAuthentication } from '@src/application/backendPreparationAdmission.js';
import {
  peekBackendPreparationCoordinator,
  persistedProjectPreparationBlockers,
} from '@src/application/backendPreparationCoordinator.js';
import {
  canonicalLifecyclePath,
  getProjectLifecycle,
  getVerifiedProjectOwner,
  type ProjectLifecycleStatus,
  projectPaths,
} from '@src/application/projectLifecycle.js';
import { ConfigManager } from '@src/config/configManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { requireProjectTarget } from '@src/domains/project-selection/projectSelection.js';
import { getAuthInfo, revalidateAuthInfo } from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import { CONTEXT_HEADERS, extractTemplateContextRequest } from '@src/transport/http/utils/contextExtractor.js';
import { authorizeRequestTemplateContext } from '@src/transport/http/utils/templateContextAuthority.js';

import type { RequestHandler } from 'express';
import { z } from 'zod';

export const projectRequestSchema = z
  .object({
    action: z.enum(['status', 'release', 'drain', 'resume']),
    waitMs: z.number().int().min(0).max(60_000).optional(),
    _meta: z.object({ context: z.unknown(), contextProof: z.unknown() }).strict(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.waitMs !== undefined && request.action !== 'drain')
      context.addIssue({ code: 'custom', path: ['waitMs'], message: 'waitMs is only accepted for drain' });
  });

/** Static backends may be shared outside the checkout: report them rather than close them. */
function staticProjectBlockers(serverManager: ServerManager, checkout: string): { kind: string; id: string }[] {
  const clients = serverManager.getClients?.();
  if (!clients) return [];
  const canonical = canonicalLifecyclePath(checkout);
  return Object.entries(ConfigManager.getInstance().loadDeclaredServerConfigs().staticServers)
    .filter(([name, config]) => {
      if (!clients.has(name) || config.type !== 'stdio') return false;
      const relative = path.relative(canonical, canonicalLifecyclePath(config.cwd ?? process.cwd()));
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    })
    .map(([name]) => ({ kind: 'shared-static-backend', id: name }));
}

export function createProjectHandler(serverManager: ServerManager): RequestHandler {
  return async (req, res): Promise<void> => {
    const parsed = projectRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid project lifecycle request', issues: parsed.error.issues });
      return;
    }
    try {
      const extracted = extractTemplateContextRequest(req);
      const header = req.headers[CONTEXT_HEADERS.SESSION_ID];
      const transportSessionId = Array.isArray(header) ? header[0] : header;
      const authorize = () =>
        extracted ? authorizeRequestTemplateContext({ ...extracted, transportSessionId }) : undefined;
      const authorization = authorize();
      if (authorization?.status !== 'trusted' || authorization.provenance !== 'verified-local') {
        res.status(403).json({ error: 'Project lifecycle requires a verified local checkout context' });
        return;
      }
      const owner = getVerifiedProjectOwner(authorization.context);
      if (!owner) {
        res.status(403).json({ error: 'A verified Project Owner credential is required' });
        return;
      }
      const { action } = parsed.data;
      if ((action === 'drain' || action === 'resume') && owner.role !== 'operator') {
        res.status(403).json({ error: 'Checkout drain and resume require operator authority' });
        return;
      }
      requireProjectTarget(authorization.context, action === 'drain' || action === 'resume' ? 'single' : 'native-set');
      const checkouts = projectPaths(authorization.context);
      const auth = getAuthInfo(res);
      const validate = async () => {
        if (!(await revalidatePreparationAuthentication(auth, () => revalidateAuthInfo(auth)))) return false;
        const current = authorize();
        return (
          current?.status === 'trusted' &&
          current.provenance === 'verified-local' &&
          current.contextHash === authorization.contextHash &&
          (Boolean(auth) || !AgentConfigManager.getInstance().isAuthEnabled()) &&
          Boolean(getVerifiedProjectOwner(current.context))
        );
      };
      if (!(await validate())) {
        res.status(401).json({ error: 'Authorization is no longer valid' });
        return;
      }
      const lifecycle = getProjectLifecycle();
      if (!lifecycle) {
        res.status(503).json({ error: 'Runtime lifecycle persistence is unavailable' });
        return;
      }
      const manager = serverManager.getTemplateServerManager();
      if (action === 'drain') lifecycle.drain(checkouts[0]);
      if (action === 'resume') lifecycle.resume(checkouts[0]);
      const inspect = async (): Promise<ProjectLifecycleStatus[]> => {
        const results: ProjectLifecycleStatus[] = [];
        for (const checkout of checkouts) {
          const jobs = [
            ...(peekBackendPreparationCoordinator(serverManager)?.getProjectBlockers(checkout) ?? []),
            ...persistedProjectPreparationBlockers(checkout),
          ];
          const cleanup: { kind: string; id: string }[] = [];
          try {
            if (action === 'release' && !jobs.length)
              await manager.releaseProjectOwner(checkout, owner.ownerId, checkouts);
            if (action === 'drain' && !jobs.length) await manager.closeUnusedProjectInstances(checkout);
          } catch {
            cleanup.push({ kind: 'cleanup-failed', id: checkout });
          }
          results.push(
            lifecycle.status(checkout, [
              ...manager.getProjectBlockers(checkout),
              ...staticProjectBlockers(serverManager, checkout),
              ...jobs,
              ...cleanup,
            ]),
          );
        }
        return results;
      };
      let results = await inspect();
      const deadline = Date.now() + (parsed.data.waitMs ?? 0);
      while (results.some((result) => !result.complete) && Date.now() < deadline && !req.aborted && !res.destroyed) {
        await setTimeout(Math.min(50, deadline - Date.now()));
        if (!(await validate())) {
          res.status(401).json({ error: 'Authorization is no longer valid' });
          return;
        }
        results = await inspect();
      }
      res.json({ results });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Project lifecycle failed';
      if (message.startsWith('Project Selection') || message.startsWith('This backend accepts one')) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(503).json({ error: 'Project lifecycle unavailable; inspect runtime persistence and cleanup' });
    }
  };
}
