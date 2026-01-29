import type { TemplateServerManager } from '@src/core/server/templateServerManager.js';
import type { OutboundConnection, OutboundConnections } from '@src/core/types/client.js';
import type { MCPServerParams } from '@src/core/types/index.js';

import { ExternalServerAdapter } from './ExternalServerAdapter.js';
import { TemplateServerAdapter } from './TemplateServerAdapter.js';
import { ServerAdapter, ServerContext, ServerType } from './types.js';

/**
 * ServerRegistry manages server adapters and provides unified access to all server types.
 *
 * The registry acts as a centralized lookup for server adapters, providing:
 * - Unified connection resolution across all server types
 * - Type-safe server access
 * - Centralized server lifecycle tracking
 */
export class ServerRegistry {
  private adapters = new Map<string, ServerAdapter>();

  constructor(
    private readonly outboundConns: OutboundConnections,
    private readonly templateManager?: TemplateServerManager,
  ) {}

  /**
   * Register an external server adapter
   */
  registerExternal(name: string, config: MCPServerParams): void {
    const adapter = new ExternalServerAdapter(name, config, this.outboundConns);
    this.adapters.set(name, adapter);
  }

  /**
   * Register a template server adapter
   */
  registerTemplate(name: string, config: MCPServerParams): void {
    if (!this.templateManager) {
      throw new Error('TemplateServerManager is required for template server adapters');
    }
    const adapter = new TemplateServerAdapter(name, config, this.outboundConns, this.templateManager);
    this.adapters.set(name, adapter);
  }

  /**
   * Register a server adapter directly
   */
  register(adapter: ServerAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  /**
   * Get a server adapter by name
   */
  get(name: string): ServerAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * Check if a server is registered
   */
  has(name: string): boolean {
    return this.adapters.has(name);
  }

  /**
   * Resolve connection for a server
   */
  resolveConnection(name: string, context?: ServerContext): OutboundConnection | undefined {
    const adapter = this.adapters.get(name);
    return adapter?.resolveConnection(context);
  }

  /**
   * Get all registered server names
   */
  getServerNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get all adapters of a specific type
   */
  getAdaptersByType(type: ServerType): ServerAdapter[] {
    return Array.from(this.adapters.values()).filter((adapter) => adapter.type === type);
  }

  /**
   * Remove a server adapter
   */
  unregister(name: string): boolean {
    return this.adapters.delete(name);
  }

  /**
   * Clear all adapters
   */
  clear(): void {
    this.adapters.clear();
  }

  /**
   * Get the total number of registered servers
   */
  size(): number {
    return this.adapters.size;
  }
}
