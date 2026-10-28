import { ConfigManager } from '@src/config/configManager.js';
import {
  prepareRequestContext,
  type PrepareRequestContextInput,
  registerRequestContext,
  type RequestContextPreparationDependencies,
  type RequestContextPreparationResult,
  type RequestContextRegistrationResult,
} from '@src/core/server/requestContextPreparation.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import {
  CONTEXT_HEADERS,
  deriveContextSessionId,
  extractTemplateContextRequest,
} from '@src/transport/http/utils/contextExtractor.js';
import {
  authorizeRequestTemplateContext,
  getRequestProjectPreparationAuthority,
} from '@src/transport/http/utils/templateContextAuthority.js';

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
    async registerBindingContext(bindingId, context, filterConfig, authority) {
      return serverManager
        .getTemplateServerManager()
        .registerBindingContext?.(bindingId, context, filterConfig, ...(authority ? [authority] : []));
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
      authority,
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
          ...(authority ? [authority] : []),
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

function resolveHttpRequestContextInput(
  serverManager: ServerManager,
  req: Request,
  filterConfig: ReturnType<typeof buildFilterConfig>,
  serverName?: string,
): PrepareRequestContextInput {
  const extracted = extractTemplateContextRequest(req);
  const transportSessionId = getHeaderSessionId(req);
  const authorization = extracted ? authorizeRequestTemplateContext({ ...extracted, transportSessionId }) : undefined;
  return {
    deps: createRequestContextPreparationDependencies(serverManager),
    context: authorization?.status === 'trusted' ? authorization.context : undefined,
    transportSessionId,
    filterConfig,
    authority: getRequestProjectPreparationAuthority(authorization),
    serverName,
  };
}

function validateHttpRequestBinding(
  serverManager: ServerManager,
  res: Response,
  context: PrepareRequestContextInput['context'],
  result: RequestContextPreparationResult | RequestContextRegistrationResult,
): string | undefined {
  if (result.status === 'no_context') return undefined;
  if ('bindingId' in result && !serverManager.getTemplateServerManager().getBindingContext(result.bindingId)) {
    throw new Error('Project binding is no longer available');
  }
  if (context) res.setHeader?.(CONTEXT_HEADERS.SESSION_ID, result.sessionId);
  return 'bindingId' in result ? result.bindingId : result.sessionId;
}

/** Resolve current project policy and ownership without starting template backends. */
export async function registerHttpRequestContext(
  serverManager: ServerManager,
  req: Request,
  res: Response,
  filterConfig: ReturnType<typeof buildFilterConfig>,
): Promise<string | undefined> {
  const input = resolveHttpRequestContextInput(serverManager, req, filterConfig);
  const result = await registerRequestContext(input);
  return validateHttpRequestBinding(serverManager, res, input.context, result);
}

export async function prepareHttpRequestContext(
  serverManager: ServerManager,
  req: Request,
  res: Response,
  filterConfig: ReturnType<typeof buildFilterConfig>,
  serverName?: string,
): Promise<RequestContextPreparationResult> {
  const input = resolveHttpRequestContextInput(serverManager, req, filterConfig, serverName);
  const result = await prepareRequestContext(input);
  validateHttpRequestBinding(serverManager, res, input.context, result);
  return result;
}

export async function ensureRequestContextInitialized(
  serverManager: ServerManager,
  req: Request,
  res: Response,
  filterConfig: ReturnType<typeof buildFilterConfig>,
  serverName?: string,
): Promise<string | undefined> {
  const result = await prepareHttpRequestContext(serverManager, req, res, filterConfig, serverName);
  if (result.status === 'no_context') return undefined;
  return 'bindingId' in result ? result.bindingId : result.sessionId;
}
