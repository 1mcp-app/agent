import { createServerInstallationService, getProgressTrackingService } from '@src/domains/server-management/index.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';

import type { Argv } from 'yargs';

import { backupConfig, initializeConfigContext, reloadMcpConfig, serverExists } from './utils/configUtils.js';
import {
  generateOperationId,
  parseServerNameVersion,
  validateServerName,
  validateVersion,
} from './utils/serverUtils.js';

export interface InstallCommandArgs extends GlobalOptions {
  serverName: string;
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

/**
 * Build the install command configuration
 */
export function buildInstallCommand(yargs: Argv) {
  return yargs
    .positional('serverName', {
      describe: 'Server name or name@version to install',
      type: 'string',
      demandOption: true,
    })
    .option('force', {
      describe: 'Force installation even if already exists',
      type: 'boolean',
      default: false,
    })
    .option('dry-run', {
      describe: 'Show what would be installed without installing',
      type: 'boolean',
      default: false,
    })
    .option('verbose', {
      describe: 'Detailed output',
      type: 'boolean',
      default: false,
      alias: 'v',
    })
    .example([
      ['$0 mcp install filesystem', 'Install latest version of filesystem server'],
      ['$0 mcp install filesystem@1.0.0', 'Install specific version'],
      ['$0 mcp install filesystem --force', 'Force reinstallation'],
      ['$0 mcp install filesystem --dry-run', 'Preview installation'],
    ]);
}

/**
 * Install command handler
 */
export async function installCommand(argv: InstallCommandArgs): Promise<void> {
  try {
    const {
      serverName: inputServerName,
      config: configPath,
      'config-dir': configDir,
      force = false,
      dryRun = false,
      verbose = false,
    } = argv;

    // Initialize configuration context
    initializeConfigContext(configPath, configDir);

    if (verbose) {
      logger.info('Starting installation process...');
    }

    // Parse server name and version
    const { name: serverName, version } = parseServerNameVersion(inputServerName);

    // Validate version format if provided
    if (version && !validateVersion(version)) {
      throw new Error(`Invalid version format: '${version}'. Expected semantic version (e.g., 1.2.3).`);
    }

    if (verbose) {
      logger.info(`Parsed server name: ${serverName}, version: ${version || 'latest'}`);
    }

    // Validate server name
    validateServerName(serverName);

    // Check if server already exists
    if (serverExists(serverName)) {
      if (!force) {
        throw new Error(`Server '${serverName}' already exists. Use --force to reinstall.`);
      }
      if (verbose) {
        logger.info(`Server '${serverName}' exists, will reinstall due to --force flag`);
      }
    }

    // Dry run mode
    if (dryRun) {
      console.log('🔍 Dry run mode - no changes will be made\n');
      console.log(`Would install: ${serverName}${version ? `@${version}` : ''}`);
      console.log(`From registry: https://registry.modelcontextprotocol.io\n`);
      console.log('Use without --dry-run to perform actual installation.');
      return;
    }

    // Create operation ID for tracking
    const operationId = generateOperationId();
    const progressTracker = getProgressTrackingService();

    // Start progress tracking
    progressTracker.startOperation(operationId, 'install', 5);

    try {
      // Get installation service
      const installationService = createServerInstallationService();

      // Update progress: Validating
      progressTracker.updateProgress(operationId, 1, 'Validating server', `Checking registry for ${serverName}`);

      // Create backup if replacing existing server
      let backupPath: string | undefined;
      if (serverExists(serverName)) {
        progressTracker.updateProgress(operationId, 2, 'Creating backup', `Backing up existing configuration`);
        backupPath = backupConfig();
        logger.info(`Backup created: ${backupPath}`);
      }

      // Update progress: Installing
      progressTracker.updateProgress(
        operationId,
        3,
        'Installing server',
        `Installing ${serverName}${version ? `@${version}` : ''}`,
      );

      // Perform installation
      const result = await installationService.installServer(serverName, version, {
        force,
        verbose,
      });

      // Update progress: Finalizing
      progressTracker.updateProgress(operationId, 4, 'Finalizing', 'Verifying configuration');

      // Save the configuration (service returns the config to be saved)
      // For now, this will be handled by the install server method directly
      // which will call setServer internally

      // In a full implementation, we would get the config from result and save it
      // setServer(serverName, result.serverConfig);

      // Update progress: Reloading
      progressTracker.updateProgress(operationId, 5, 'Reloading configuration', 'Applying changes');

      // Reload MCP configuration
      reloadMcpConfig();

      // Update progress: Complete (completeOperation logs completion)

      // Complete the operation
      const duration = result.installedAt ? Date.now() - result.installedAt.getTime() : 0;
      progressTracker.completeOperation(operationId, {
        success: true,
        operationId,
        duration,
        message: `Successfully installed ${serverName}`,
      });

      // Report success
      console.log(`\n✅ Successfully installed server '${serverName}'${version ? ` version ${version}` : ''}`);
      if (backupPath) {
        console.log(`📁 Backup created: ${backupPath}`);
      }
      if (result.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        result.warnings.forEach((warning) => console.log(`   • ${warning}`));
      }
    } catch (error) {
      progressTracker.failOperation(operationId, error as Error);
      throw error;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Installation failed: ${errorMessage}\n`);
    if (error instanceof Error && error.stack) {
      logger.error('Installation error stack:', error.stack);
    }
    throw error;
  }
}
