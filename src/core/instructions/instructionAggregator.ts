import { EventEmitter } from 'events';
import logger from '../../logger/logger.js';
import { FilteringService } from '../filtering/filteringService.js';
import { OutboundConnections, InboundConnectionConfig } from '../types/index.js';

/**
 * Events emitted by InstructionAggregator
 */
export interface InstructionAggregatorEvents {
  'instructions-changed': (aggregatedInstructions: string) => void;
}

/**
 * Aggregates instructions from multiple MCP servers into a single instruction string.
 * Provides both simple concatenation and filtered instructions with educational templates.
 * The aggregator acts as an educational prompt to help LLMs understand 1MCP better.
 *
 * @example
 * ```typescript
 * const aggregator = new InstructionAggregator();
 * aggregator.on('instructions-changed', (instructions) => {
 *   // Update server instances with new instructions
 * });
 *
 * // When server comes online
 * aggregator.setInstructions('server1', 'Server 1 instructions');
 *
 * // Get filtered instructions for a client
 * const filtered = aggregator.getFilteredInstructions(config, connections);
 * ```
 */
export class InstructionAggregator extends EventEmitter {
  private serverInstructions = new Map<string, string>();
  private isInitialized: boolean = false;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Set or update instructions for a specific server
   * @param serverName The name of the server
   * @param instructions The instruction string from the server, or undefined to remove
   */
  public setInstructions(serverName: string, instructions: string | undefined): void {
    const previousInstructions = this.serverInstructions.get(serverName);
    const hasChanges = previousInstructions !== instructions;

    if (instructions?.trim()) {
      this.serverInstructions.set(serverName, instructions.trim());
      logger.debug(`Updated instructions for server: ${serverName}`);
    } else {
      this.serverInstructions.delete(serverName);
      logger.debug(`Removed instructions for server: ${serverName}`);
    }

    if (!this.isInitialized) {
      this.isInitialized = true;
      logger.debug('InstructionAggregator initialized');
    }

    if (hasChanges) {
      const aggregatedInstructions = this.getAggregatedInstructions();
      logger.info(`Instructions changed. Total servers with instructions: ${this.serverInstructions.size}`);
      this.emit('instructions-changed', aggregatedInstructions);
    }
  }

  /**
   * Remove instructions for a specific server
   * @param serverName The name of the server to remove
   */
  public removeServer(serverName: string): void {
    const hadInstructions = this.serverInstructions.has(serverName);
    this.serverInstructions.delete(serverName);

    if (hadInstructions) {
      const aggregatedInstructions = this.getAggregatedInstructions();
      logger.info(`Removed server instructions: ${serverName}. Remaining servers: ${this.serverInstructions.size}`);
      this.emit('instructions-changed', aggregatedInstructions);
    }
  }

  /**
   * Get filtered instructions for a specific client based on their configuration
   * This is the main method that should be used by server connections
   *
   * @param config Client's inbound connection configuration
   * @param connections All available outbound connections
   * @returns Formatted instruction string with educational template
   */
  public getFilteredInstructions(config: InboundConnectionConfig, connections: OutboundConnections): string {
    logger.debug('InstructionAggregator: Getting filtered instructions', {
      filterMode: config.tagFilterMode,
      totalConnections: connections.size,
      totalInstructions: this.serverInstructions.size,
    });

    // Filter connections based on client configuration
    const filteredConnections = FilteringService.getFilteredConnections(connections, config);

    // Get filtering summary for logging
    const filteringSummary = FilteringService.getFilteringSummary(connections, filteredConnections, config);
    logger.info('InstructionAggregator: Filtering applied', filteringSummary);

    // Generate the educational template with filtered instructions
    return this.formatInstructionsWithTemplate(filteredConnections, config);
  }

  /**
   * Get the current aggregated instructions from all servers (backward compatibility)
   * Uses simple concatenation with server headers
   * @returns The aggregated instruction string
   */
  public getAggregatedInstructions(): string {
    const sections: string[] = [];

    // Sort servers by name for consistent output
    const sortedServers = Array.from(this.serverInstructions.entries()).sort(([a], [b]) => a.localeCompare(b));

    for (const [serverName, instructions] of sortedServers) {
      sections.push(`## ${serverName}\n${instructions}`);
    }

    return sections.length > 0 ? sections.join('\n\n') : '';
  }

  /**
   * Get the number of servers that have provided instructions
   * @returns The count of servers with instructions
   */
  public getServerCount(): number {
    return this.serverInstructions.size;
  }

  /**
   * Get a list of server names that have provided instructions
   * @returns Array of server names
   */
  public getServerNames(): string[] {
    return Array.from(this.serverInstructions.keys()).sort();
  }

  /**
   * Check if a specific server has instructions
   * @param serverName The server name to check
   * @returns True if the server has instructions
   */
  public hasInstructions(serverName: string): boolean {
    return this.serverInstructions.has(serverName);
  }

  /**
   * Get instructions for a specific server
   * @param serverName The server name
   * @returns The instructions for the server, or undefined if not found
   */
  public getServerInstructions(serverName: string): string | undefined {
    return this.serverInstructions.get(serverName);
  }

  /**
   * Clear all instructions (useful for testing)
   */
  public clear(): void {
    const hadInstructions = this.serverInstructions.size > 0;
    this.serverInstructions.clear();

    if (hadInstructions) {
      logger.debug('Cleared all server instructions');
      this.emit('instructions-changed', '');
    }
  }

  /**
   * Format instructions using the educational template
   * This template helps LLMs understand 1MCP and how to use it effectively
   *
   * @param filteredConnections Connections that passed filtering
   * @param config Client configuration (for context about filtering)
   * @returns Formatted instruction string
   */
  private formatInstructionsWithTemplate(
    filteredConnections: OutboundConnections,
    config: InboundConnectionConfig,
  ): string {
    // Get server names that have instructions and are in filtered connections
    const availableServers: string[] = [];
    const serverInstructionSections: string[] = [];

    // Sort filtered connections by name for consistent output
    const sortedConnections = Array.from(filteredConnections.entries()).sort(([a], [b]) => a.localeCompare(b));

    for (const [serverName, _connection] of sortedConnections) {
      const serverInstructions = this.serverInstructions.get(serverName);
      if (serverInstructions?.trim()) {
        availableServers.push(serverName);
        serverInstructionSections.push(`<${serverName}>\n${serverInstructions.trim()}\n</${serverName}>`);
      }
    }

    // Build the educational template
    const template = this.buildEducationalTemplate(
      availableServers.length,
      availableServers,
      serverInstructionSections,
      config,
    );

    logger.debug('InstructionAggregator: Generated template', {
      availableServers: availableServers.length,
      serverNames: availableServers,
      templateLength: template.length,
    });

    return template;
  }

  /**
   * Build the educational template that explains 1MCP to LLMs
   *
   * @param serverCount Number of available servers
   * @param serverNames Names of available servers
   * @param serverInstructions Array of formatted server instruction sections
   * @param config Client configuration for context
   * @returns Complete educational template
   */
  private buildEducationalTemplate(
    serverCount: number,
    serverNames: string[],
    serverInstructions: string[],
    config: InboundConnectionConfig,
  ): string {
    if (serverCount === 0) {
      return this.buildNoServersTemplate();
    }

    const filterContext = this.getFilterContext(config);
    const serverList = serverNames.join('\n');
    const instructions = serverInstructions.join('\n\n');

    return `# 1MCP - Model Context Protocol Proxy

You are interacting with 1MCP, a proxy server that aggregates capabilities from multiple MCP (Model Context Protocol) servers. 1MCP acts as a unified gateway, allowing you to access tools and resources from various specialized MCP servers through a single connection.

## How 1MCP Works

- **Unified Access**: Connect to multiple MCP servers through one proxy
- **Tool Aggregation**: All tools are available with the naming pattern \`{server}_1mcp_{tool}\`
- **Resource Sharing**: Access files, data, and capabilities across different servers
- **Intelligent Routing**: Your requests are automatically routed to the appropriate servers

## Currently Connected Servers

${serverCount} MCP server${serverCount === 1 ? '' : 's'} ${serverCount === 1 ? 'is' : 'are'} currently available${filterContext}:

${serverList}

## Available Capabilities

All tools from connected servers are accessible using the format: \`{server}_1mcp_{tool}\`

Examples:
- \`filesystem_1mcp_read_file\` - Read files through filesystem server
- \`web_1mcp_search\` - Search the web through web server
- \`database_1mcp_query\` - Query databases through database server

## Server-Specific Instructions

${instructions}

## Tips for Using 1MCP

- Use descriptive requests - 1MCP will route to the best available server
- Tools are namespaced by server to avoid conflicts
- If a server is unavailable, 1MCP will inform you of alternatives
- Resources and data can be shared between servers when needed`;
  }

  /**
   * Build template for when no servers are available
   */
  private buildNoServersTemplate(): string {
    return `# 1MCP - Model Context Protocol Proxy

You are interacting with 1MCP, a proxy server that aggregates capabilities from multiple MCP (Model Context Protocol) servers.

## Current Status

No MCP servers are currently connected. 1MCP is ready to connect to servers and provide unified access to their capabilities once they become available.

## What 1MCP Provides

- **Unified Access**: Connect to multiple MCP servers through one proxy
- **Tool Aggregation**: Access tools using the pattern \`{server}_1mcp_{tool}\`
- **Resource Sharing**: Share files, data, and capabilities across servers
- **Intelligent Routing**: Automatic request routing to appropriate servers

1MCP will automatically detect and connect to available MCP servers. Once connected, their tools and capabilities will become available through the unified interface.`;
  }

  /**
   * Get filter context description for the template
   */
  private getFilterContext(config: InboundConnectionConfig): string {
    if (!config.tagFilterMode || config.tagFilterMode === 'none') {
      return '';
    }

    if (config.tagFilterMode === 'simple-or' && config.tags?.length) {
      return ` (filtered by tags: ${config.tags.join(', ')})`;
    }

    if (config.tagFilterMode === 'advanced' && config.tagExpression) {
      return ' (filtered by advanced expression)';
    }

    if (config.tagFilterMode === 'preset') {
      return ' (filtered by preset)';
    }

    return ' (filtered)';
  }

  /**
   * Get a summary of current instruction state for logging
   */
  public getSummary(): string {
    const serverCount = this.serverInstructions.size;
    const serverNames = this.getServerNames();
    return `${serverCount} servers with instructions: ${serverNames.join(', ')}`;
  }
}
