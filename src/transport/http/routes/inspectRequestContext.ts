import { ConfigManager } from '@src/config/configManager.js';
import {
  prepareRequestContext,
  type RequestContextPreparationDependencies,
} from '@src/core/server/requestContextPreparation.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import {
  CONTEXT_HEADERS,
  deriveContextSessionId,
  extractRequestContext,
} from '@src/transport/http/utils/contextExtractor.js';

import { Request, Response } from 'express';

import { buildFilterConfig } from './inspectHelpers.js';

function getHeaderSessionId(req: Request): string | undefined {
  const headerSessionId = req.headers?.[CONTEXT_HEADERS.SESSION_ID];
  return Array.isArray(headerSessionId) ? headerSessionId[0] : headerSessionId;
}

function createPreparationDependencies(serverManager: ServerManager): RequestContextPreparationDependencies {
  return {
    deriveSessionId: deriveContextSessionId,
    async loadRenderedTemplates(context) {
      const { templateServers } = await ConfigManager.getInstance().loadConfigWithTemplates(context);
      return templateServers;
    },
    getRenderedHashForSession(sessionId, templateName) {
      return serverManager.getTemplateServerManager().getRenderedHashForSession(sessionId, templateName);
    },
    touchEphemeralClient(sessionId) {
      serverManager.getTemplateServerManager().touchEphemeralClient(sessionId);
    },
    createTemplateBasedServers(
      sessionId,
      context,
      filterConfig,
      serverConfigData,
      outboundConns,
      transports,
      lifecycle,
    ) {
      return serverManager
        .getTemplateServerManager()
        .createTemplateBasedServers(
          sessionId,
          context,
          filterConfig,
          serverConfigData,
          outboundConns,
          transports,
          lifecycle,
        );
    },
    hasTemplateAdapter(templateName) {
      return serverManager.getServerRegistry().has(templateName);
    },
    registerTemplateAdapter(templateName, config) {
      serverManager.getServerRegistry().registerTemplate(templateName, config);
    },
    getOutboundConnections() {
      return serverManager.getClients();
    },
    getClientTransports() {
      return serverManager.getClientTransports();
    },
    async refreshCapabilities() {
      await serverManager.getLazyLoadingOrchestrator()?.refreshCapabilities();
    },
  };
}

export async function ensureRequestContextInitialized(
  serverManager: ServerManager,
  req: Request,
  res: Response,
  filterConfig: ReturnType<typeof buildFilterConfig>,
): Promise<string | undefined> {
  const context = extractRequestContext(req);
  const result = await prepareRequestContext({
    deps: createPreparationDependencies(serverManager),
    context,
    transportSessionId: getHeaderSessionId(req),
    filterConfig,
  });

  if (result.status === 'no_context') {
    return undefined;
  }

  if (context) {
    res.setHeader?.(CONTEXT_HEADERS.SESSION_ID, result.sessionId);
  }

  return result.sessionId;
}
