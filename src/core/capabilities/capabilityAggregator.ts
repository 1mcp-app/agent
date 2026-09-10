import { EventEmitter } from 'events';

import { getConfiguredServerTargets } from '@src/config/configuredServerTargets.js';
import { InternalCapabilitiesProvider } from '@src/core/capabilities/internalCapabilitiesProvider.js';
import type { OutboundConnections } from '@src/core/types/index.js';
import type { Prompt, Resource, ResourceTemplate, Tool } from '@src/sdk/contracts/index.js';

import { buildCatalogGeneration, type CatalogGeneration } from './catalogGeneration.js';
import {
  acquireRuntimeCapabilityCatalog,
  type RuntimeCapabilitySnapshot,
  RuntimeCatalogBackendChangedError,
} from './runtimeCapabilityCatalog.js';

export interface AggregatedCapabilities {
  readonly tools: readonly Tool[];
  readonly resources: readonly Resource[];
  readonly resourceTemplates: readonly ResourceTemplate[];
  readonly prompts: readonly Prompt[];
  readonly readyServers: readonly string[];
  readonly timestamp: Date;
}

export interface CapabilityChanges {
  readonly hasChanges: boolean;
  readonly toolsChanged: boolean;
  readonly resourcesChanged: boolean;
  readonly resourceTemplatesChanged: boolean;
  readonly promptsChanged: boolean;
  readonly addedServers: string[];
  readonly removedServers: string[];
  readonly previous: AggregatedCapabilities;
  readonly current: AggregatedCapabilities;
}

export interface CapabilityAggregatorEvents {
  'capabilities-changed': (changes: CapabilityChanges) => void;
  'server-capabilities-ready': (serverName: string, capabilities: AggregatedCapabilities) => void;
}

/** Publishes the runtime catalog as one aggregate snapshot for discovery and notifications. */
export class CapabilityAggregator extends EventEmitter {
  private generation = buildCatalogGeneration(0, []);
  private snapshot?: RuntimeCapabilitySnapshot;
  private currentCapabilities: AggregatedCapabilities = {
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    readyServers: [],
    timestamp: new Date(),
  };
  private refreshSequence = 0;

  constructor(private readonly outboundConns: OutboundConnections) {
    super();
    this.setMaxListeners(50);
  }

  public getCurrentCapabilities(): AggregatedCapabilities {
    return this.currentCapabilities;
  }

  public getCatalogGeneration(): CatalogGeneration {
    return this.generation;
  }

  public getCatalogSnapshot(): RuntimeCapabilitySnapshot | undefined {
    return this.snapshot;
  }

  public async updateCapabilities(): Promise<CapabilityChanges> {
    const sequence = ++this.refreshSequence;
    const internal = InternalCapabilitiesProvider.getInstance();
    await internal.initialize();
    const collect = async () => {
      const snapshot = await acquireRuntimeCapabilityCatalog(this.outboundConns, undefined, {
        serverConfigs: getConfiguredServerTargets(),
        internalTools: internal.getAvailableTools(),
        internalResources: internal.getAvailableResources(),
        internalPrompts: internal.getAvailablePrompts(),
      });
      const [tools, resources, resourceTemplates, prompts] = await Promise.all([
        snapshot.list<Tool>('tools', { enablePagination: false }),
        snapshot.list<Resource>('resources', { enablePagination: false }),
        snapshot.list<ResourceTemplate>('resourceTemplates', { enablePagination: false }),
        snapshot.list<Prompt>('prompts', { enablePagination: false }),
      ]);
      return { snapshot, tools, resources, resourceTemplates, prompts };
    };
    const { snapshot, tools, resources, resourceTemplates, prompts } = await collect().catch((error: unknown) => {
      if (!(error instanceof RuntimeCatalogBackendChangedError)) throw error;
      return collect();
    });
    const previous = this.currentCapabilities;
    if (sequence !== this.refreshSequence) return this.detectChanges(previous, previous);
    const readyServers = new Set(Array.from(snapshot.connections.keys()));
    if (snapshot.generation.entries.some((entry) => entry.route.origin === 'internal')) readyServers.add('1mcp');
    const current = Object.freeze({
      tools: Object.freeze(tools.items),
      resources: Object.freeze(resources.items),
      resourceTemplates: Object.freeze(resourceTemplates.items),
      prompts: Object.freeze(prompts.items),
      readyServers: Object.freeze([...readyServers].sort()),
      timestamp: new Date(),
    });
    const changes = this.detectChanges(previous, current);
    this.generation = snapshot.generation;
    this.snapshot = snapshot;
    this.currentCapabilities = current;
    if (changes.hasChanges) this.emit('capabilities-changed', changes);
    return changes;
  }

  public async refreshCapabilities(): Promise<AggregatedCapabilities> {
    return (await this.updateCapabilities()).current;
  }

  private detectChanges(previous: AggregatedCapabilities, current: AggregatedCapabilities): CapabilityChanges {
    const changed = (before: readonly unknown[], after: readonly unknown[]) =>
      JSON.stringify(before.map((item) => JSON.stringify(item)).sort()) !==
      JSON.stringify(after.map((item) => JSON.stringify(item)).sort());
    const toolsChanged = changed(previous.tools, current.tools);
    const resourceTemplatesChanged = changed(previous.resourceTemplates, current.resourceTemplates);
    const resourcesChanged = changed(previous.resources, current.resources) || resourceTemplatesChanged;
    const promptsChanged = changed(previous.prompts, current.prompts);
    const addedServers = current.readyServers.filter((server) => !previous.readyServers.includes(server));
    const removedServers = previous.readyServers.filter((server) => !current.readyServers.includes(server));
    return {
      hasChanges:
        toolsChanged || resourcesChanged || promptsChanged || addedServers.length > 0 || removedServers.length > 0,
      toolsChanged,
      resourcesChanged,
      resourceTemplatesChanged,
      promptsChanged,
      addedServers,
      removedServers,
      previous,
      current,
    };
  }

  public getCapabilitiesSummary(): string {
    const caps = this.currentCapabilities;
    return `${caps.tools.length} tools, ${caps.resources.length} resources, ${caps.prompts.length} prompts from ${caps.readyServers.length} servers`;
  }
}
