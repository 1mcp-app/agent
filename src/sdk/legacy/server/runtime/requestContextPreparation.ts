import { isOperatorDisabledTemplateDefinition } from '@src/config/configuredServerTargets.js';
import type { TrustedTemplateContext } from '@src/core/context/templateContextTrust.js';
import type { OutboundConnections } from '@src/core/types/client.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import type { InboundConnectionConfig } from '@src/core/types/server.js';
import {
  canonicalizeProjectSet,
  createProjectBindingId,
  resolveProjectSelection,
  withProjectSelection,
} from '@src/domains/project-selection/projectSelection.js';
import type { Transport } from '@src/sdk/legacy/shared/transport.js';
import type { ContextData } from '@src/types/context.js';
import { resolveCanonicalSessionId, withCanonicalSessionId } from '@src/utils/context/sessionIdentity.js';

export type RequestContextPreparationResult =
  | { status: 'no_context' }
  | { status: 'routing_only'; sessionId: string }
  | {
      status: 'already_prepared' | 'prepared';
      sessionId: string;
      bindingId: string;
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
  registerBindingContext?(
    bindingId: string,
    context: ContextData,
    filterConfig: InboundConnectionConfig,
  ): Promise<string | undefined>;
}

export interface PrepareRequestContextInput {
  deps: RequestContextPreparationDependencies;
  filterConfig: InboundConnectionConfig;
  context?: TrustedTemplateContext | null;
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
  const canonical = withCanonicalSessionId(context, sessionId);
  const canonicalContext = canonical.projectSet
    ? withProjectSelection(canonical, await canonicalizeProjectSet(canonical.projectSet, process.cwd()))
    : canonical;
  const initialBindingId = createProjectBindingId(sessionId, canonicalContext);
  const bindingId =
    (await deps.registerBindingContext?.(initialBindingId, canonicalContext, filterConfig)) ?? initialBindingId;
  const selection = resolveProjectSelection(canonicalContext);
  const renderedTemplates = await deps.loadRenderedTemplates(canonicalContext);
  const templateEntries = Object.entries(renderedTemplates).filter(([_templateName, config]) => {
    if (isOperatorDisabledTemplateDefinition(config)) return false;
    const mode = config.projectTarget?.mode ?? 'single';
    if (mode === 'independent') return true;
    if (selection.kind === 'unresolved') return false;
    return mode === 'native-set' || selection.kind === 'single';
  });
  const templateNames = templateEntries.map(([templateName]) => templateName);

  if (templateEntries.length === 0) {
    return {
      status: 'already_prepared',
      sessionId,
      bindingId,
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
    templateEntries.filter(([templateName]) => !deps.getRenderedHashForSession(bindingId, templateName)),
  );
  const createdTemplateNames = Object.keys(pendingTemplates);

  if (createdTemplateNames.length === 0) {
    deps.touchEphemeralClient(bindingId);
    return {
      status: 'already_prepared',
      sessionId,
      bindingId,
      templateNames,
      createdTemplateNames,
    };
  }

  await deps.createTemplateBasedServers(
    bindingId,
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
    bindingId,
    templateNames,
    createdTemplateNames,
  };
}
