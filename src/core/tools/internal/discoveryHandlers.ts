/**
 * Discovery tool handlers
 *
 * This module implements handlers for MCP discovery and information tools
 * including search, registry operations, and server information.
 */
import { AdapterFactory } from '@src/core/tools/internal/adapters/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import {
  type McpInfoOutput,
  McpInfoOutputSchema,
  type McpInfoToolArgs,
  type McpRegistryInfoOutput,
  McpRegistryInfoOutputSchema,
  type McpRegistryInfoToolArgs,
  type McpRegistryListOutput,
  McpRegistryListOutputSchema,
  type McpRegistryListToolArgs,
  type McpRegistryStatusOutput,
  McpRegistryStatusOutputSchema,
  type McpRegistryStatusToolArgs,
  type McpSearchOutput,
  McpSearchOutputSchema,
  type McpSearchToolArgs,
} from './schemas/index.js';

/**
 * Internal tool handler for searching MCP registry
 */
export async function handleMcpSearch(args: McpSearchToolArgs): Promise<McpSearchOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_search tool',
      meta: { args },
    }));

    const adapter = AdapterFactory.getDiscoveryAdapter();
    const servers = await adapter.searchServers(args.query || '', {
      limit: args.limit,
      cursor: args.cursor,
      transport: args.transport as 'stdio' | 'sse' | 'webhook' | undefined,
      status: args.status as 'active' | 'archived' | 'deprecated' | 'all',
      registry_type: args.type as 'npm' | 'pypi' | 'docker',
    });

    // Transform to match expected output schema with installation method info
    const result = {
      results: servers.map((server) => {
        // Determine installation method
        const packages = server.packages || [];
        const remotes = server.remotes || [];
        const hasPackages = packages.length > 0;
        const hasRemotes = remotes.length > 0;
        let installationMethod = 'unknown';
        let installationHint = '';

        if (hasPackages) {
          installationMethod = 'package';
          const pkgTypes = packages.map((p) => p.registryType).filter(Boolean);
          installationHint = `Installable via ${pkgTypes.join(', ')} packages`;
        } else if (hasRemotes) {
          installationMethod = 'remote';
          const remoteTypes = remotes.map((r) => r.type).filter(Boolean);
          installationHint = `Installable via ${remoteTypes.join(', ')} remotes`;
        }

        // Extract prerequisite information
        const firstPackage = packages[0];
        const envVars = firstPackage?.environmentVariables?.length || 0;
        const packageArgs = firstPackage?.packageArguments?.length || 0;
        const runtimeArgs = firstPackage?.runtimeArguments?.length || 0;

        let prerequisiteHint = '';
        if (envVars > 0 || packageArgs > 0 || runtimeArgs > 0) {
          const requirements = [];
          if (envVars > 0) requirements.push(`${envVars} env vars`);
          if (packageArgs > 0) requirements.push(`${packageArgs} package args`);
          if (runtimeArgs > 0) requirements.push(`${runtimeArgs} runtime args`);
          prerequisiteHint = `Requires: ${requirements.join(', ')}`;
        }

        return {
          name: server.name,
          version: server.version,
          description: server.description,
          author: (server._meta as { author?: string })?.author || 'Unknown',
          tags: (server._meta as { tags?: string[] })?.tags || [],
          transport: server.packages?.map((pkg) => pkg.transport?.type).filter(Boolean) || [],
          registry: 'official',
          downloads: (server._meta as { downloads?: number })?.downloads,

          // Enhanced installation information
          installationMethod,
          installationHint,
          prerequisiteHint,
          hasEnvironmentVariables: envVars > 0,
          hasPackageArguments: packageArgs > 0,
          hasRuntimeArguments: runtimeArgs > 0,
          installable: hasPackages || hasRemotes,
        };
      }),
      total: servers.length,
      query: args.query || '',
      registry: 'official',
    };

    return McpSearchOutputSchema.parse(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_search tool handler', { error: errorMessage });
    throw new Error(`Search failed: ${errorMessage}`);
  }
}

/**
 * Internal tool handler for getting MCP registry status
 */
export async function handleMcpRegistryStatus(args: McpRegistryStatusToolArgs): Promise<McpRegistryStatusOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_registry_status tool',
      meta: { args },
    }));

    const adapter = AdapterFactory.getDiscoveryAdapter();
    const status = await adapter.getRegistryStatus(args.includeStats);

    // Transform to match expected output schema
    const { total_servers, ...restStats } = status.stats || {};
    const result = {
      registry: args.registry || 'official',
      status: status.available ? ('online' as const) : ('offline' as const),
      responseTime: status.response_time_ms,
      lastCheck: status.last_updated,
      error: status.available ? undefined : 'Registry unavailable',
      metadata: {
        version: '1.0.0',
        supportedFormats: ['json', 'table'],
        totalServers: total_servers || 0,
        ...restStats,
      },
    };

    return McpRegistryStatusOutputSchema.parse(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_registry_status tool handler', { error: errorMessage });
    throw new Error(`Registry status check failed: ${errorMessage}`);
  }
}

/**
 * Internal tool handler for getting MCP registry information
 */
export async function handleMcpRegistryInfo(args: McpRegistryInfoToolArgs): Promise<McpRegistryInfoOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_registry_info tool',
      meta: { args },
    }));

    // Mock registry info - in real implementation, this would get detailed registry information
    const registryInfo = {
      name: args.registry || 'official',
      url: 'https://registry.modelcontextprotocol.io',
      description: 'The official Model Context Protocol server registry',
      version: '1.0.0',
      supportedFormats: ['json', 'table'],
      features: ['search', 'get', 'list'],
      statistics: {
        totalPackages: 150,
        lastUpdated: new Date().toISOString(),
      },
    };

    return McpRegistryInfoOutputSchema.parse(registryInfo);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_registry_info tool handler', { error: errorMessage });
    throw new Error(`Registry info check failed: ${errorMessage}`);
  }
}

/**
 * Internal tool handler for listing MCP registry contents
 */
export async function handleMcpRegistryList(args: McpRegistryListToolArgs): Promise<McpRegistryListOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_registry_list tool',
      meta: { args },
    }));

    // Mock registry list - in real implementation, this would query the actual registry
    const registryList = {
      registries: [
        {
          name: 'Official MCP Registry',
          url: 'https://registry.modelcontextprotocol.io',
          status: 'online' as const,
          description: 'The official Model Context Protocol server registry',
          packageCount: args.includeStats ? 150 : undefined,
        },
        {
          name: 'Community Registry',
          url: 'https://community-registry.modelcontextprotocol.io',
          status: 'online' as const,
          description: 'Community-contributed MCP servers',
          packageCount: args.includeStats ? 75 : undefined,
        },
        {
          name: 'Experimental Registry',
          url: 'https://experimental-registry.modelcontextprotocol.io',
          status: 'unknown' as const, // 'beta' mapped to 'unknown' for schema compliance
          description: 'Experimental and cutting-edge MCP servers',
          packageCount: args.includeStats ? 25 : undefined,
        },
      ],
      total: 3,
    };

    return McpRegistryListOutputSchema.parse(registryList);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_registry_list tool handler', { error: errorMessage });
    throw new Error(`Registry list failed: ${errorMessage}`);
  }
}

/**
 * Internal tool handler for getting information about specific MCP servers
 */
export async function handleMcpInfo(args: McpInfoToolArgs): Promise<McpInfoOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_info tool',
      meta: { args },
    }));

    const adapter = AdapterFactory.getDiscoveryAdapter();
    const server = await adapter.getServerById(args.name, args.version);

    if (!server) {
      const result = {
        server: {
          name: args.name || 'unknown',
          status: 'unknown' as const,
          transport: 'stdio' as const,
        },
      };

      return McpInfoOutputSchema.parse(result);
    }

    // Transform to match expected output schema
    const serverMeta = server._meta as {
      capabilities?: {
        tools?: {
          list?: unknown[];
          count?: number;
        };
        resources?: {
          list?: unknown[];
          count?: number;
        };
        prompts?: {
          list?: unknown[];
          count?: number;
        };
      };
      tags?: string[];
    };
    const capabilities = serverMeta?.capabilities || {};

    const result = {
      server: {
        name: server.name,
        status: 'unknown' as const, // Would need ServerManager integration for real status
        transport: 'stdio' as const, // Determine from server.packages
      },
      configuration: {
        command: server.packages?.[0]?.identifier,
        tags: (serverMeta?.tags as string[]) || [],
        autoRestart: false, // Default value
        enabled: true, // Default value
      },
      capabilities: {
        tools: capabilities.tools?.list
          ? Array(capabilities.tools.count || 0)
              .fill(null)
              .map((_, i) => ({
                name: `tool_${i}`,
                description: `Tool ${i}`,
              }))
          : [],
        resources: capabilities.resources?.list
          ? Array(capabilities.resources.count || 0)
              .fill(null)
              .map((_, i) => ({
                uri: `resource://${i}`,
                name: `Resource ${i}`,
              }))
          : [],
        prompts:
          capabilities.prompts?.list || capabilities.prompts?.count
            ? Array(capabilities.prompts.count || 0)
                .fill(null)
                .map((_, i) => ({
                  name: `prompt_${i}`,
                  description: `Prompt ${i}`,
                }))
            : [],
      },
      health: {
        status: 'unknown' as const,
        lastCheck: new Date().toISOString(),
      },
    };

    return McpInfoOutputSchema.parse(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_info tool handler', { error: errorMessage });
    throw new Error(`Server info check failed: ${errorMessage}`);
  }
}

/**
 * Cleanup function for discovery handlers
 */
export function cleanupDiscoveryHandlers(): void {
  AdapterFactory.cleanup();
}
