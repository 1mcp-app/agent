/**
 * Installation tool handlers
 *
 * This module implements handlers for MCP server installation operations
 * including install, uninstall, and update functionality.
 */
import { FlagManager } from '@src/core/flags/flagManager.js';
import { AdapterFactory } from '@src/core/tools/internal/adapters/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import {
  type McpInstallOutput,
  McpInstallOutputSchema,
  McpInstallToolArgs,
  type McpUninstallOutput,
  McpUninstallOutputSchema,
  McpUninstallToolArgs,
  type McpUpdateOutput,
  McpUpdateOutputSchema,
  McpUpdateToolArgs,
} from './schemas/index.js';

/**
 * Internal tool handler for installing MCP servers
 */
export async function handleMcpInstall(args: McpInstallToolArgs): Promise<McpInstallOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_install tool',
      meta: { args },
    }));

    // Check if installation tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'installation', 'install')) {
      const result = {
        name: args.name,
        status: 'failed' as const,
        message: 'MCP server installation is currently disabled by configuration',
        error: 'Installation tools are disabled',
      };
      return McpInstallOutputSchema.parse(result);
    }

    // Fetch registry information for prerequisite details if registryId is provided
    let prerequisiteInfo = args.prerequisites;
    let installationMethod = args.installationMethod;
    let registryInfo: unknown = null;

    if (args.registryId && !prerequisiteInfo) {
      try {
        const { createRegistryClient } = await import('@src/domains/registry/mcpRegistryClient.js');
        const registryClient = createRegistryClient();

        // Try to get server details from registry
        registryInfo = await registryClient.getServerById(args.registryId, args.version);

        if (registryInfo) {
          // Extract prerequisite information from registry data
          prerequisiteInfo = extractPrerequisiteInfo(registryInfo);

          // Determine installation method
          const packages = (registryInfo as { packages?: unknown[] })?.packages || [];
          installationMethod = packages.length > 0 ? 'package' : 'remote';

          debugIf(() => ({
            message: 'Fetched registry information for prerequisites',
            meta: {
              registryId: args.registryId,
              installationMethod,
              hasEnvironmentVariables: prerequisiteInfo?.environmentVariables?.length || 0,
              hasPackageArguments: prerequisiteInfo?.packageArguments?.length || 0,
              hasDependencies: prerequisiteInfo?.dependencies?.length || 0,
            },
          }));
        }
      } catch (error) {
        debugIf(() => ({
          message: 'Failed to fetch registry information',
          meta: { error: error instanceof Error ? error.message : String(error) },
        }));
        // Continue without prerequisite info - registry fetch is optional
      }
    }

    const adapter = AdapterFactory.getInstallationAdapter();
    const result = await adapter.installServer(args.registryId || args.name, args.version, {
      force: args.force,
      backup: args.backup,
      tags: args.tags,
      env: args.env,
      args: args.args,
      package: args.package,
      command: args.command,
      url: args.url,
      transport: args.transport,
    });

    // Transform to match expected output schema with enhanced information
    const structuredResult = {
      name: result.serverName,
      status: result.success ? ('success' as const) : ('failed' as const),
      message: `MCP server '${result.serverName}' ${result.success ? 'installed' : 'installation failed'}${result.success ? ' successfully' : ''}`,
      package:
        args.package ||
        (installationMethod === 'package'
          ? (registryInfo as { packages?: Array<{ identifier?: string }> })?.packages?.[0]?.identifier
          : undefined),
      version: result.version,
      location: result.configPath,
      installedAt: result.installedAt instanceof Date ? result.installedAt.toISOString() : result.installedAt,
      configPath: result.configPath,
      backupPath: result.backupPath,
      operationId: result.operationId,
      warnings: result.warnings,
      reloadRecommended: result.success,
      error: result.success ? undefined : result.errors?.[0] || 'Installation failed',

      // Enhanced fields for LLM context
      registryId: args.registryId,
      installationMethod,
      prerequisites: prerequisiteInfo,
    };

    return McpInstallOutputSchema.parse(structuredResult);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_install tool handler', { error: errorMessage });

    const result = {
      name: args.name,
      status: 'failed' as const,
      message: `Installation failed: ${errorMessage}`,
      error: errorMessage,
    };

    return McpInstallOutputSchema.parse(result);
  }
}

/**
 * Extract prerequisite information from registry server data
 */
function extractPrerequisiteInfo(registryServer: unknown): McpInstallToolArgs['prerequisites'] {
  const server = registryServer as {
    packages?: Array<{
      registryType?: string;
      runtimeHint?: string;
      environmentVariables?: Array<{
        name?: string;
        variable?: string;
        description?: string;
        isRequired?: boolean;
        isSecret?: boolean;
        value?: string;
      }>;
      packageArguments?: Array<{
        name?: string;
        description?: string;
        isRequired?: boolean;
        value?: string;
        choices?: string[];
      }>;
      runtimeArguments?: Array<{
        name?: string;
        description?: string;
        isRequired?: boolean;
        value?: string;
        choices?: string[];
      }>;
      transport?: {
        type?: string;
      };
    }>;
  };

  const prerequisites: McpInstallToolArgs['prerequisites'] = {
    environmentVariables: [],
    packageArguments: [],
    runtimeArguments: [],
    dependencies: [],
    systemRequirements: {},
  };

  // Extract from packages if available
  if (server.packages && server.packages.length > 0) {
    const pkg = server.packages[0]; // Use first package as primary

    // Environment variables
    if (pkg.environmentVariables) {
      prerequisites.environmentVariables = pkg.environmentVariables
        .filter((envVar): envVar is NonNullable<typeof envVar> => envVar.name != null)
        .map((envVar) => ({
          name: envVar.name || envVar.variable || '',
          description: envVar.description,
          isRequired: envVar.isRequired,
          isSecret: envVar.isSecret,
          defaultValue: envVar.value,
        }));
    }

    // Package arguments
    if (pkg.packageArguments) {
      prerequisites.packageArguments = pkg.packageArguments
        .filter((arg): arg is NonNullable<typeof arg> => arg.name != null)
        .map((arg) => ({
          name: arg.name || '',
          description: arg.description,
          isRequired: arg.isRequired,
          defaultValue: arg.value,
          choices: arg.choices,
        }));
    }

    // Runtime arguments
    if (pkg.runtimeArguments) {
      prerequisites.runtimeArguments = pkg.runtimeArguments
        .filter((arg): arg is NonNullable<typeof arg> => arg.name != null)
        .map((arg) => ({
          name: arg.name || '',
          description: arg.description,
          isRequired: arg.isRequired,
          defaultValue: arg.value,
          choices: arg.choices,
        }));
    }

    // Dependencies based on registry type
    if (prerequisites.dependencies) {
      if (pkg.registryType === 'npm' || pkg.runtimeHint === 'npx') {
        prerequisites.dependencies.push({
          type: 'node',
          name: 'Node.js',
          version: '>=14.0.0',
          description: 'Node.js runtime for npm packages',
        });
      } else if (pkg.registryType === 'pypi') {
        prerequisites.dependencies.push({
          type: 'python',
          name: 'Python',
          version: '>=3.7',
          description: 'Python runtime for PyPI packages',
        });
      } else if (pkg.registryType === 'docker') {
        prerequisites.dependencies.push({
          type: 'docker',
          name: 'Docker',
          version: '>=20.0',
          description: 'Docker runtime for Docker images',
        });
      }
    }

    // Transport info
    if (pkg.transport && pkg.transport.type) {
      (prerequisites.systemRequirements as { transport?: string }).transport = pkg.transport.type;
    }
  }

  return prerequisites;
}

/**
 * Internal tool handler for uninstalling MCP servers
 */
export async function handleMcpUninstall(args: McpUninstallToolArgs): Promise<McpUninstallOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_uninstall tool',
      meta: { args },
    }));

    // Check if installation tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'installation', 'uninstall')) {
      const result = {
        name: args.name,
        status: 'failed' as const,
        message: 'MCP server uninstallation is currently disabled by configuration',
        error: 'Installation tools are disabled',
      };
      return McpUninstallOutputSchema.parse(result);
    }

    const adapter = AdapterFactory.getInstallationAdapter();
    const result = await adapter.uninstallServer(args.name, {
      force: args.force,
      backup: args.backup,
      removeAll: args.removeAll,
    });

    // Transform to match expected output schema
    const structuredResult = {
      name: result.serverName,
      status: result.success ? ('success' as const) : ('failed' as const),
      message: `MCP server '${result.serverName}' ${result.success ? 'uninstalled' : 'uninstallation failed'}${result.success ? ' successfully' : ''}`,
      removed: result.success,
      removedAt: result.removedAt instanceof Date ? result.removedAt.toISOString() : result.removedAt,
      configRemoved: result.configRemoved,
      gracefulShutdown: args.graceful,
      operationId: result.operationId,
      warnings: result.warnings,
      reloadRecommended: result.success,
      error: result.success ? undefined : result.errors?.[0] || 'Uninstallation failed',
    };

    return McpUninstallOutputSchema.parse(structuredResult);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_uninstall tool handler', { error: errorMessage });

    const result = {
      name: args.name,
      status: 'failed' as const,
      message: `Uninstallation failed: ${errorMessage}`,
      error: errorMessage,
    };

    return McpUninstallOutputSchema.parse(result);
  }
}

/**
 * Internal tool handler for updating MCP servers
 */
export async function handleMcpUpdate(args: McpUpdateToolArgs): Promise<McpUpdateOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_update tool',
      meta: { args },
    }));

    // Check if installation tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'installation', 'update')) {
      const result = {
        name: args.name,
        status: 'failed' as const,
        message: 'MCP server updates are currently disabled by configuration',
        error: 'Installation tools are disabled',
      };
      return McpUpdateOutputSchema.parse(result);
    }

    const adapter = AdapterFactory.getInstallationAdapter();
    const result = await adapter.updateServer(args.name, args.version, {
      force: args.force,
      backup: args.backup,
      dryRun: args.dryRun,
    });

    // Transform to match expected output schema
    const structuredResult = {
      name: result.serverName,
      status: result.success ? ('success' as const) : ('failed' as const),
      message: `MCP server '${result.serverName}' ${result.success ? 'updated' : 'update failed'}${result.success ? ' successfully' : ''}`,
      previousVersion: result.previousVersion,
      newVersion: result.newVersion,
      updatedAt: result.updatedAt instanceof Date ? result.updatedAt.toISOString() : result.updatedAt,
      operationId: result.operationId,
      warnings: result.warnings,
      reloadRecommended: result.success,
      error: result.success ? undefined : result.errors?.[0] || 'Update failed',
    };

    return McpUpdateOutputSchema.parse(structuredResult);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_update tool handler', { error: errorMessage });

    const result = {
      name: args.name,
      status: 'failed' as const,
      message: `Update failed: ${errorMessage}`,
      error: errorMessage,
    };

    return McpUpdateOutputSchema.parse(result);
  }
}

/**
 * Cleanup function for installation handlers
 */
export function cleanupInstallationHandlers(): void {
  AdapterFactory.cleanup();
}
