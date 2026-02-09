import { EventEmitter } from 'events';

import {
  ListPromptsResult,
  ListResourcesResult,
  ListToolsResult,
  Prompt,
  Resource,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { InternalCapabilitiesProvider } from '@src/core/capabilities/internalCapabilitiesProvider.js';
import { ClientStatus, OutboundConnections, MCPServerParams } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

/**
 * Filter capabilities based on server configuration
 */
function filterCapabilities<T extends { name: string } | { uri: string }>(
  items: T[],
  _serverName: string,
  config: MCPServerParams | undefined,
  itemType: 'tool' | 'resource' | 'prompt',
  itemKey: 'name' | 'uri',
): T[] {
  if (!config) {
    return items;
  }

  // Get the disabled and enabled lists based on item type
  const disabledItems: string[] = [];
  const enabledItems: string[] | undefined = (() => {
    switch (itemType) {
      case 'tool':
        return config.enabledTools;
      case 'resource':
        return config.enabledResources;
      case 'prompt':
        return config.enabledPrompts;
    }
  })();

  // Get disabled items based on item type
  switch (itemType) {
    case 'tool':
      if (config.disabledTools) {
        disabledItems.push(...config.disabledTools);
      }
      break;
    case 'resource':
      if (config.disabledResources) {
        disabledItems.push(...config.disabledResources);
      }
      break;
    case 'prompt':
      if (config.disabledPrompts) {
        disabledItems.push(...config.disabledPrompts);
      }
      break;
  }

  return items.filter((item) => {
    const itemIdentifier = itemKey === 'name' ? (item as { name: string }).name : (item as { uri: string }).uri;

    // If enabledItems is specified, only include items in that list
    if (enabledItems && enabledItems.length > 0) {
      return enabledItems.includes(itemIdentifier);
    }

    // Otherwise, exclude items in the disabled list
    return !disabledItems.includes(itemIdentifier);
  });
}

/**
 * Represents a snapshot of aggregated capabilities from all ready servers
 */
export interface AggregatedCapabilities {
  readonly tools: Tool[];
  readonly resources: Resource[];
  readonly prompts: Prompt[];
  readonly readyServers: string[];
  readonly timestamp: Date;
}

/**
 * Represents changes between two capability snapshots
 */
export interface CapabilityChanges {
  readonly hasChanges: boolean;
  readonly toolsChanged: boolean;
  readonly resourcesChanged: boolean;
  readonly promptsChanged: boolean;
  readonly addedServers: string[];
  readonly removedServers: string[];
  readonly previous: AggregatedCapabilities;
  readonly current: AggregatedCapabilities;
}

/**
 * Events emitted by CapabilityAggregator
 */
export interface CapabilityAggregatorEvents {
  'capabilities-changed': (changes: CapabilityChanges) => void;
  'server-capabilities-ready': (serverName: string, capabilities: AggregatedCapabilities) => void;
}

/**
 * Aggregates and tracks capabilities (tools, resources, prompts) from all ready MCP servers.
 * Detects changes when servers come online or go offline and emits events for notification.
 *
 * @example
 * ```typescript
 * const aggregator = new CapabilityAggregator(outboundConnections);
 * aggregator.on('capabilities-changed', (changes) => {
 *   if (changes.toolsChanged) {
 *     // Send ToolListChangedNotification to clients
 *   }
 * });
 *
 * // When server comes online
 * aggregator.updateCapabilities();
 * ```
 */
export class CapabilityAggregator extends EventEmitter {
  private outboundConns: OutboundConnections;
  private currentCapabilities: AggregatedCapabilities;
  private isInitialized: boolean = false;
  private internalProvider: InternalCapabilitiesProvider;

  constructor(outboundConnections: OutboundConnections) {
    super();
    this.outboundConns = outboundConnections;
    this.currentCapabilities = this.createEmptyCapabilities();
    this.internalProvider = InternalCapabilitiesProvider.getInstance();
    this.setMaxListeners(50);
  }

  /**
   * Create an empty capabilities snapshot
   */
  private createEmptyCapabilities(): AggregatedCapabilities {
    return {
      tools: [],
      resources: [],
      prompts: [],
      readyServers: [],
      timestamp: new Date(),
    };
  }

  /**
   * Get current aggregated capabilities
   */
  public getCurrentCapabilities(): AggregatedCapabilities {
    return this.currentCapabilities;
  }

  /**
   * Update capabilities by querying all ready servers
   * This should be called when server states change
   */
  public async updateCapabilities(): Promise<CapabilityChanges> {
    const previousCapabilities = this.currentCapabilities;
    const newCapabilities = await this.aggregateFromReadyServers();

    const changes = this.detectChanges(previousCapabilities, newCapabilities);
    this.currentCapabilities = newCapabilities;

    if (!this.isInitialized) {
      this.isInitialized = true;
      debugIf('CapabilityAggregator initialized with capabilities from ready servers');
    }

    if (changes.hasChanges) {
      logger.info(
        `Capabilities changed: tools=${changes.toolsChanged}, resources=${changes.resourcesChanged}, prompts=${changes.promptsChanged}`,
      );
      this.emit('capabilities-changed', changes);
    }

    return changes;
  }

  /**
   * Force refresh capabilities from all servers
   */
  public async refreshCapabilities(): Promise<AggregatedCapabilities> {
    const changes = await this.updateCapabilities();
    return changes.current;
  }

  /**
   * Aggregate capabilities from all ready servers
   */
  private async aggregateFromReadyServers(): Promise<AggregatedCapabilities> {
    const readyServers: string[] = [];
    const allTools: Tool[] = [];
    const allResources: Resource[] = [];
    const allPrompts: Prompt[] = [];

    // Add 1mcp tools first
    try {
      await this.internalProvider.initialize();
      const internalTools = this.internalProvider.getAvailableTools();
      const internalResources = this.internalProvider.getAvailableResources();
      const internalPrompts = this.internalProvider.getAvailablePrompts();

      allTools.push(...internalTools);
      allResources.push(...internalResources);
      allPrompts.push(...internalPrompts);

      // Only add 1mcp as a ready server if it provides capabilities
      if (internalTools.length > 0 || internalResources.length > 0 || internalPrompts.length > 0) {
        readyServers.push('1mcp');
      }
    } catch (error) {
      logger.warn(`Failed to load 1mcp tools: ${error}`);
    }

    // Add tools from external MCP servers
    for (const [serverName, connection] of this.outboundConns.entries()) {
      if (connection.status !== ClientStatus.Connected || !connection.client.transport) {
        continue;
      }

      try {
        readyServers.push(serverName);

        // Fetch tools, resources, and prompts in parallel
        const [toolsResult, resourcesResult, promptsResult] = await Promise.allSettled([
          this.safeListTools(serverName, connection.client),
          this.safeListResources(serverName, connection.client),
          this.safeListPrompts(serverName, connection.client),
        ]);

        // Get server config for filtering (if available)
        const serverConfig = connection.serverConfig;

        // Process tools with filtering
        if (toolsResult.status === 'fulfilled' && toolsResult.value.tools) {
          const filteredTools = filterCapabilities(
            toolsResult.value.tools,
            serverName,
            serverConfig,
            'tool',
            'name',
          );
          if (filteredTools.length !== toolsResult.value.tools.length) {
            const disabledCount = toolsResult.value.tools.length - filteredTools.length;
            debugIf(() => ({
              message: `Filtered ${disabledCount} tools from ${serverName}`,
              meta: { serverName, disabledCount, remainingCount: filteredTools.length },
            }));
          }
          allTools.push(...filteredTools);
        }

        // Process resources with filtering
        if (resourcesResult.status === 'fulfilled' && resourcesResult.value.resources) {
          const filteredResources = filterCapabilities(
            resourcesResult.value.resources,
            serverName,
            serverConfig,
            'resource',
            'uri',
          );
          if (filteredResources.length !== resourcesResult.value.resources.length) {
            const disabledCount = resourcesResult.value.resources.length - filteredResources.length;
            debugIf(() => ({
              message: `Filtered ${disabledCount} resources from ${serverName}`,
              meta: { serverName, disabledCount, remainingCount: filteredResources.length },
            }));
          }
          allResources.push(...filteredResources);
        }

        // Process prompts with filtering
        if (promptsResult.status === 'fulfilled' && promptsResult.value.prompts) {
          const filteredPrompts = filterCapabilities(
            promptsResult.value.prompts,
            serverName,
            serverConfig,
            'prompt',
            'name',
          );
          if (filteredPrompts.length !== promptsResult.value.prompts.length) {
            const disabledCount = promptsResult.value.prompts.length - filteredPrompts.length;
            debugIf(() => ({
              message: `Filtered ${disabledCount} prompts from ${serverName}`,
              meta: { serverName, disabledCount, remainingCount: filteredPrompts.length },
            }));
          }
          allPrompts.push(...filteredPrompts);
        }
      } catch (error) {
        logger.warn(`Failed to aggregate capabilities from ${serverName}: ${error}`);
        // Continue with other servers
      }
    }

    return {
      tools: this.deduplicateTools(allTools),
      resources: this.deduplicateResources(allResources),
      prompts: this.deduplicatePrompts(allPrompts),
      readyServers: readyServers.sort(),
      timestamp: new Date(),
    };
  }

  /**
   * Safely list tools from a server
   */
  private async safeListTools(
    serverName: string,
    client: { listTools(): Promise<ListToolsResult> },
  ): Promise<ListToolsResult> {
    try {
      return await client.listTools();
    } catch (error) {
      debugIf(() => ({ message: `Failed to list tools from ${serverName}: ${error}` }));
      return { tools: [] };
    }
  }

  /**
   * Safely list resources from a server
   */
  private async safeListResources(
    serverName: string,
    client: { listResources(): Promise<ListResourcesResult> },
  ): Promise<ListResourcesResult> {
    try {
      return await client.listResources();
    } catch (error) {
      debugIf(() => ({ message: `Failed to list resources from ${serverName}: ${error}` }));
      return { resources: [] };
    }
  }

  /**
   * Safely list prompts from a server
   */
  private async safeListPrompts(
    serverName: string,
    client: { listPrompts(): Promise<ListPromptsResult> },
  ): Promise<ListPromptsResult> {
    try {
      return await client.listPrompts();
    } catch (error) {
      debugIf(() => ({ message: `Failed to list prompts from ${serverName}: ${error}` }));
      return { prompts: [] };
    }
  }

  /**
   * Detect changes between two capability snapshots
   */
  private detectChanges(previous: AggregatedCapabilities, current: AggregatedCapabilities): CapabilityChanges {
    const toolsChanged = !this.arraysEqual(
      previous.tools.map((t) => t.name).sort(),
      current.tools.map((t) => t.name).sort(),
    );

    const resourcesChanged = !this.arraysEqual(
      previous.resources.map((r) => r.uri).sort(),
      current.resources.map((r) => r.uri).sort(),
    );

    const promptsChanged = !this.arraysEqual(
      previous.prompts.map((p) => p.name).sort(),
      current.prompts.map((p) => p.name).sort(),
    );

    const addedServers = current.readyServers.filter((s) => !previous.readyServers.includes(s));
    const removedServers = previous.readyServers.filter((s) => !current.readyServers.includes(s));

    const hasChanges =
      toolsChanged || resourcesChanged || promptsChanged || addedServers.length > 0 || removedServers.length > 0;

    return {
      hasChanges,
      toolsChanged,
      resourcesChanged,
      promptsChanged,
      addedServers,
      removedServers,
      previous,
      current,
    };
  }

  /**
   * Check if two arrays are equal (shallow comparison)
   */
  private arraysEqual<T>(a: T[], b: T[]): boolean {
    return a.length === b.length && a.every((val, index) => val === b[index]);
  }

  /**
   * Remove duplicate tools based on name
   */
  private deduplicateTools(tools: Tool[]): Tool[] {
    const seen = new Set<string>();
    return tools.filter((tool) => {
      if (seen.has(tool.name)) {
        debugIf(`Duplicate tool name detected: ${tool.name}`);
        return false;
      }
      seen.add(tool.name);
      return true;
    });
  }

  /**
   * Remove duplicate resources based on URI
   */
  private deduplicateResources(resources: Resource[]): Resource[] {
    const seen = new Set<string>();
    return resources.filter((resource) => {
      if (seen.has(resource.uri)) {
        debugIf(`Duplicate resource URI detected: ${resource.uri}`);
        return false;
      }
      seen.add(resource.uri);
      return true;
    });
  }

  /**
   * Remove duplicate prompts based on name
   */
  private deduplicatePrompts(prompts: Prompt[]): Prompt[] {
    const seen = new Set<string>();
    return prompts.filter((prompt) => {
      if (seen.has(prompt.name)) {
        debugIf(`Duplicate prompt name detected: ${prompt.name}`);
        return false;
      }
      seen.add(prompt.name);
      return true;
    });
  }

  /**
   * Get summary of current capabilities for logging
   */
  public getCapabilitiesSummary(): string {
    const caps = this.currentCapabilities;
    return `${caps.tools.length} tools, ${caps.resources.length} resources, ${caps.prompts.length} prompts from ${caps.readyServers.length} servers`;
  }
}
