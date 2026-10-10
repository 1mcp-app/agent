import { type jsonSchemaValidator, ProtocolError } from '@modelcontextprotocol/server';

import { getConfiguredServerTargets } from '@src/config/configuredServerTargets.js';
import {
  getCapabilityPaginationGeneration,
  registerCapabilityPaginationNotifications,
  unregisterCapabilityPaginationConnections,
} from '@src/core/capabilities/capabilityPagination.js';
import { InternalCapabilitiesProvider } from '@src/core/capabilities/internalCapabilitiesProvider.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { filterConnectionsForSession, resolveCapabilityVisibility } from '@src/core/protocol/requestHandlerUtils.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import type { InboundConnectionConfig } from '@src/core/types/index.js';
import { withInteractionRoute } from '@src/gateway/interactions/interactionRoute.js';
import type { JsonValue } from '@src/sdk/contracts/index.js';
import { createMcpParamHeaders, scanMcpParamDeclarations } from '@src/sdk/contracts/mcpParamHeaders.js';

/**
 * This registry only projects already-admitted schemas for the SDK's header lookup.
 * fromJsonSchema's default validator compiles synchronously; never use it here.
 * Generic gateway handlers replace the registry's handlers and retain worker-based
 * input/output validation. Accidental registry execution must fail closed.
 */
export const toolHeaderProjectionValidator: jsonSchemaValidator = {
  getValidator: () => () => {
    throw new Error('Tool schema evaluation requires the gateway schema boundary');
  },
};

export async function resolveModernToolHeaderRegistry(
  manager: Pick<ServerManager, 'getClients'> & Partial<Pick<ServerManager, 'getLazyLoadingOrchestrator'>>,
  config: InboundConnectionConfig,
  method: unknown,
  params: unknown,
  signal: AbortSignal,
) {
  if (method !== 'tools/call') return undefined;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  const name = (params as { name?: unknown }).name;
  if (typeof name !== 'string') return undefined;
  const connections = manager.getClients();
  const visible = FilteringService.getFilteredConnections(
    filterConnectionsForSession(connections, config.bindingId),
    config,
  );
  const visibility = resolveCapabilityVisibility(connections, config, undefined, 'tools');
  // Observe before the asynchronous read so a notification during admission also
  // invalidates the declaration. Separate maps fence only the selected provider.
  const observers = Array.from(visible, ([key, connection]) => {
    const observed = new Map([[key, connection]]);
    registerCapabilityPaginationNotifications(observed, connection);
    return { connection, observed, generation: getCapabilityPaginationGeneration(observed, 'tools') };
  });
  let retained: (typeof observers)[number] | undefined;
  try {
    const provider = InternalCapabilitiesProvider.getInstance();
    await provider.initialize();
    const lazyOrchestrator = manager.getLazyLoadingOrchestrator?.();
    const lazy = lazyOrchestrator?.isEnabled() ?? false;
    const internalTools = provider.getAvailableTools();
    const metaTools =
      lazy && lazyOrchestrator ? (await lazyOrchestrator.getCapabilitiesForVisibility(visibility)).tools : [];
    const serverConfigs = getConfiguredServerTargets();
    const args = (params as { arguments?: JsonValue }).arguments;
    const toolListContinuation =
      lazy &&
      name === 'tool_list' &&
      args &&
      typeof args === 'object' &&
      !Array.isArray(args) &&
      typeof args.cursor === 'string';
    // Cursor-backed lazy listing is owned by the internal cached catalog. Match
    // the authoritative handler's acquisition without waiting on unrelated peers.
    const acquisitionVisibility = toolListContinuation
      ? { ...visibility, serverCandidates: new Map<string, string>() }
      : visibility;
    const snapshot = await acquireRuntimeCapabilityCatalog(connections, acquisitionVisibility, {
      serverConfigs,
      signal,
      internalTools: lazy
        ? internalTools.filter((tool) => !['tool_list', 'tool_schema', 'tool_invoke'].includes(tool.name))
        : internalTools,
      unprefixedTools: metaTools,
    });
    const selected = snapshot.resolve('tools', name);
    const definition = snapshot.getToolDefinition(name);
    if (!selected || !definition)
      return {
        headerTool: undefined,
        close: () => {},
        async run<T>(_operation: () => Promise<T>, _additionalFence: () => boolean = () => true): Promise<T> {
          // An unobserved definition cannot authorize a later, freshly discovered
          // external provider whose declarations were never checked by the SDK.
          throw new ProtocolError(-32602, 'Tool definition is unavailable');
        },
      };
    // The SDK accepts declarations outside the owned primitive/schema subset.
    // An invalid declaration set disables all header projection while leaving
    // the original admitted schema and ordinary worker validation intact.
    const scan = scanMcpParamDeclarations(definition.tool.inputSchema as JsonValue);
    const headerTool = scan.valid && scan.declarations.length > 0 ? definition.tool : undefined;
    const assertHeaderArguments = () => {
      if (!scan.valid) return;
      const unsafeIntegers = scan.declarations.filter((declaration) => {
        if (declaration.type !== 'integer') return false;
        let value = args;
        for (const field of declaration.path) {
          if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, field)) return false;
          value = value[field];
        }
        // Fractions and wrong primitive types still follow ordinary worker
        // schema validation. Only integral values skipped by the SDK need this guard.
        return typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value);
      });
      try {
        // Reuse the owned encoder's safe-integer guard without forwarding headers.
        createMcpParamHeaders(unsafeIntegers, args);
      } catch {
        throw new ProtocolError(-32602, 'Header integer parameter must be a safe integer');
      }
    };
    if (selected.entry.route.origin === 'internal')
      return {
        headerTool,
        close: () => {},
        async run<T>(operation: () => Promise<T>, _additionalFence: () => boolean = () => true): Promise<T> {
          definition.assertCurrent();
          assertHeaderArguments();
          return operation();
        },
      };
    if (!selected.connection) throw new ProtocolError(-32602, 'Tool definition is unavailable');
    const { entry, connection } = selected;
    const observer = observers.find((item) => item.connection === connection);
    if (!observer) throw new ProtocolError(-32602, 'Tool definition is unavailable');
    const adapter = connection.adapter;
    const configuredTarget = JSON.stringify(serverConfigs[entry.route.server]);
    const isCurrent = () => {
      try {
        definition.assertCurrent();
        return (
          manager.getClients().get(entry.route.connectionKey) === connection &&
          connection.adapter === adapter &&
          getCapabilityPaginationGeneration(observer.observed, 'tools') === observer.generation &&
          JSON.stringify(getConfiguredServerTargets()[entry.route.server]) === configuredTarget
        );
      } catch {
        return false;
      }
    };
    retained = observer;
    return {
      headerTool,
      close: () => unregisterCapabilityPaginationConnections(observer.observed),
      run<T>(operation: () => Promise<T>, additionalFence: () => boolean = () => true): Promise<T> {
        assertHeaderArguments();
        return withInteractionRoute(
          {
            adapter,
            method: 'tools/call',
            identity: entry.route.upstreamIdentity,
            isCurrent: () => isCurrent() && additionalFence(),
          },
          operation,
        );
      },
    };
  } finally {
    for (const observer of observers) {
      if (observer !== retained) unregisterCapabilityPaginationConnections(observer.observed);
    }
  }
}
