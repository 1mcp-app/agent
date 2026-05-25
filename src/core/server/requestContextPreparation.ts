import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { OutboundConnections } from '@src/core/types/client.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import type { InboundConnectionConfig } from '@src/core/types/server.js';
import type { ContextData } from '@src/types/context.js';
import { resolveCanonicalSessionId, withCanonicalSessionId } from '@src/utils/context/sessionIdentity.js';

export type RequestContextPreparationResult =
  | { status: 'no_context' }
  | { status: 'routing_only'; sessionId: string }
  | {
      status: 'already_prepared' | 'prepared';
      sessionId: string;
      templateNames: string[];
      createdTemplateNames: string[];
    };

export interface RequestContextPreparationDependencies {
  deriveSessionId(context: ContextData): string;
  loadRenderedTemplates(context: ContextData): Promise<Record<string, MCPServerParams>>;
  getRenderedHashForSession(sessionId: string, templateName: string): string | undefined;
  touchEphemeralClient(sessionId: string): void;
  createTemplateBasedServers(
    sessionId: string,
    context: ContextData,
    filterConfig: InboundConnectionConfig,
    serverConfigData: { mcpTemplates?: Record<string, MCPServerParams> },
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
    lifecycle: 'ephemeral',
  ): Promise<void>;
  hasTemplateAdapter(templateName: string): boolean;
  registerTemplateAdapter(templateName: string, config: MCPServerParams): void;
  getOutboundConnections(): OutboundConnections;
  getClientTransports(): Record<string, Transport>;
  refreshCapabilities(): Promise<void>;
}

export interface PrepareRequestContextInput {
  deps: RequestContextPreparationDependencies;
  filterConfig: InboundConnectionConfig;
  context?: ContextData | null;
  transportSessionId?: string;
}

export async function prepareRequestContext(
  input: PrepareRequestContextInput,
): Promise<RequestContextPreparationResult> {
  const { deps, context, filterConfig, transportSessionId } = input;

  if (!context) {
    return transportSessionId ? { status: 'routing_only', sessionId: transportSessionId } : { status: 'no_context' };
  }

  const sessionId = resolveCanonicalSessionId({
    context,
    transportSessionId,
    deriveSessionId: deps.deriveSessionId,
  });
  const canonicalContext = withCanonicalSessionId(context, sessionId);
  const renderedTemplates = await deps.loadRenderedTemplates(canonicalContext);
  const templateEntries = Object.entries(renderedTemplates);
  const templateNames = templateEntries.map(([templateName]) => templateName);

  if (templateEntries.length === 0) {
    return {
      status: 'already_prepared',
      sessionId,
      templateNames,
      createdTemplateNames: [],
    };
  }

  for (const [templateName, config] of templateEntries) {
    if (!deps.hasTemplateAdapter(templateName)) {
      deps.registerTemplateAdapter(templateName, config);
    }
  }

  const pendingTemplates = Object.fromEntries(
    templateEntries.filter(([templateName]) => !deps.getRenderedHashForSession(sessionId, templateName)),
  );
  const createdTemplateNames = Object.keys(pendingTemplates);

  if (createdTemplateNames.length === 0) {
    deps.touchEphemeralClient(sessionId);
    return {
      status: 'already_prepared',
      sessionId,
      templateNames,
      createdTemplateNames,
    };
  }

  await deps.createTemplateBasedServers(
    sessionId,
    canonicalContext,
    filterConfig,
    { mcpTemplates: pendingTemplates },
    deps.getOutboundConnections(),
    deps.getClientTransports(),
    'ephemeral',
  );
  await deps.refreshCapabilities();

  return {
    status: 'prepared',
    sessionId,
    templateNames,
    createdTemplateNames,
  };
}
