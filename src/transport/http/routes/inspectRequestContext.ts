import { ConfigManager } from '@src/config/configManager.js';
import {
  prepareRequestContext,
  type RequestContextPreparationDependencies,
  type RequestContextPreparationResult,
} from '@src/core/server/requestContextPreparation.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import {
  CONTEXT_HEADERS,
  deriveContextSessionId,
  extractTemplateContextRequest,
} from '@src/transport/http/utils/contextExtractor.js';
import { authorizeRequestTemplateContext } from '@src/transport/http/utils/templateContextAuthority.js';

import { Request, Response } from 'express';

import { buildFilterConfig } from './inspectHelpers.js';

function getHeaderSessionId(req: Request): string | undefined {
  const headerSessionId = req.headers?.[CONTEXT_HEADERS.SESSION_ID];
  return Array.isArray(headerSessionId) ? headerSessionId[0] : headerSessionId;
}

export function createRequestContextPreparationDependencies(
  serverManager: ServerManager,
): RequestContextPreparationDependencies {
  return {
    async registerBindingContext(bindingId, context, filterConfig) {
      return serverManager.getTemplateServerManager().registerBindingContext?.(bindingId, context, filterConfig);
    },
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

export async function prepareHttpRequestContext(
  serverManager: ServerManager,
  req: Request,
  res: Response,
  filterConfig: ReturnType<typeof buildFilterConfig>,
): Promise<RequestContextPreparationResult> {
  const extracted = extractTemplateContextRequest(req);
  const transportSessionId = getHeaderSessionId(req);
  const authorization = extracted
    ? authorizeRequestTemplateContext({
        ...extracted,
        transportSessionId,
      })
    : undefined;
  const context = authorization?.status === 'trusted' ? authorization.context : undefined;
  const result = await prepareRequestContext({
    deps: createRequestContextPreparationDependencies(serverManager),
    context,
    transportSessionId,
    filterConfig,
  });

  if (result.status === 'no_context') {
    return result;
  }

  if ('bindingId' in result && !serverManager.getTemplateServerManager().getBindingContext(result.bindingId)) {
    throw new Error('Project binding is no longer available');
  }

  if (authorization?.status === 'trusted') {
    res.setHeader?.(CONTEXT_HEADERS.SESSION_ID, result.sessionId);
  }

  return result;
}

export async function ensureRequestContextInitialized(
  serverManager: ServerManager,
  req: Request,
  res: Response,
  filterConfig: ReturnType<typeof buildFilterConfig>,
): Promise<string | undefined> {
  const result = await prepareHttpRequestContext(serverManager, req, res, filterConfig);
  if (result.status === 'no_context') return undefined;
  return 'bindingId' in result ? result.bindingId : result.sessionId;
}
