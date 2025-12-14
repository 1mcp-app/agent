import { backupConfig, serverExists, setServer } from '@src/commands/mcp/utils/mcpServerConfig.js';
import { generateOperationId } from '@src/commands/mcp/utils/serverUtils.js';
import { getConfigPath } from '@src/constants/paths.js';
import { MCPServerParams } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { InstallAdapterOptions } from './types.js';

/**
 * Perform direct package installation using configuration functions
 */
export async function performDirectPackageInstallation(
  serverName: string,
  version?: string,
  options: InstallAdapterOptions = {},
): Promise<{
  success: boolean;
  serverName: string;
  version?: string;
  installedAt: Date;
  configPath?: string;
  backupPath?: string;
  warnings: string[];
  errors: string[];
  operationId: string;
}> {
  const operationId = generateOperationId();
  const warnings: string[] = [];
  const errors: string[] = [];

  debugIf(() => ({
    message: 'Adapter: Starting direct package installation',
    meta: { serverName, version, options },
  }));

  try {
    // Create backup if server exists and not forced
    let backupPath: string | undefined;
    if (serverExists(serverName) && !options.force) {
      errors.push(`Server '${serverName}' already exists. Use force: true to overwrite.`);
      return {
        success: false,
        serverName,
        version,
        installedAt: new Date(),
        warnings,
        errors,
        operationId,
      };
    }

    if (serverExists(serverName) && options.force && options.backup) {
      backupPath = backupConfig();
      warnings.push(`Backup created: ${backupPath}`);
    }

    // Build server configuration directly
    const serverConfig: MCPServerParams = {
      type: options.transport || 'stdio',
      command: options.command,
      args: options.args || [],
      url: options.url,
      env: options.env || {},
      tags: options.tags || [],
      timeout: options.timeout,
      disabled: options.enabled === false, // Invert logic - disabled is the opposite of enabled
      cwd: options.cwd,
      restartOnExit: options.autoRestart || false,
      maxRestarts: options.maxRestarts,
      restartDelay: options.restartDelay,
    };

    // Add the server to configuration
    setServer(serverName, serverConfig);

    // Special case: For stdio with command "npx" and args containing "-y" and a package,
    // Convert to the -- pattern format that works with npx
    if (
      serverConfig.type === 'stdio' &&
      serverConfig.command === 'npx' &&
      serverConfig.args?.includes('-y') &&
      options.package
    ) {
      // Format args as a single command string for the -- pattern
      const args = serverConfig.args || [];
      const packageIndex = args.indexOf('-y');
      if (packageIndex !== -1 && packageIndex < args.length - 1) {
        const packageName = args[packageIndex + 1];
        // Create new server config with updated args
        const updatedServerConfig: MCPServerParams = {
          ...serverConfig,
          args: ['-y', packageName],
        };
        setServer(serverName, updatedServerConfig);
      }
    }

    return {
      success: true,
      serverName,
      version,
      installedAt: new Date(),
      configPath: getConfigPath(),
      backupPath,
      warnings,
      errors,
      operationId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    errors.push(`Direct package installation failed: ${errorMessage}`);
    logger.error('Direct package installation error', {
      serverName,
      version,
      options,
      error: errorMessage,
    });

    return {
      success: false,
      serverName,
      version,
      installedAt: new Date(),
      warnings,
      errors,
      operationId,
    };
  }
}
