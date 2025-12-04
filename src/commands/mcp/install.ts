import { MCPRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import { createServerInstallationService, getProgressTrackingService } from '@src/domains/server-management/index.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';

import boxen from 'boxen';
import chalk from 'chalk';
import type { Argv } from 'yargs';

import {
  backupConfig,
  getAllServers,
  initializeConfigContext,
  reloadMcpConfig,
  serverExists,
} from './utils/configUtils.js';
import { InstallWizard } from './utils/installWizard.js';
import { generateOperationId, parseServerNameVersion, validateVersion } from './utils/serverUtils.js';

export interface InstallCommandArgs extends GlobalOptions {
  serverName?: string;
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  interactive?: boolean;
}

/**
 * Build the install command configuration
 */
export function buildInstallCommand(yargs: Argv) {
  return yargs
    .positional('serverName', {
      describe: 'Server name or name@version to install',
      type: 'string',
      demandOption: false,
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
    .option('interactive', {
      describe: 'Launch interactive wizard for guided installation',
      type: 'boolean',
      default: false,
      alias: 'i',
    })
    .option('verbose', {
      describe: 'Detailed output',
      type: 'boolean',
      default: false,
      alias: 'v',
    })
    .example([
      ['$0 mcp install', 'Launch interactive installation wizard'],
      ['$0 mcp install filesystem', 'Install latest version (requires exact registry ID)'],
      ['$0 mcp install io.github.user/filesystem', 'Install with full registry ID'],
      ['1mcp registry search mysql && 1mcp mcp install <registry-id>', 'Search then install workflow'],
      ['$0 mcp install filesystem@1.0.0', 'Install specific version'],
      ['$0 mcp install filesystem --interactive', 'Install with interactive configuration'],
      ['$0 mcp install filesystem --force', 'Force reinstallation'],
      ['$0 mcp install filesystem --dry-run', 'Preview installation'],
    ]);
}

/**
 * Install command handler
 */
export async function installCommand(argv: InstallCommandArgs): Promise<void> {
  const {
    serverName: inputServerName,
    config: configPath,
    'config-dir': configDir,
    force = false,
    dryRun = false,
    verbose = false,
    interactive = false,
  } = argv;

  try {
    // Initialize configuration context
    initializeConfigContext(configPath, configDir);

    if (verbose) {
      logger.info('Starting installation process...');
    }

    // Launch interactive wizard if no server name provided or --interactive flag set
    if (!inputServerName || interactive) {
      await runInteractiveInstallation(argv);
      return;
    }

    // Parse server name and version
    const { name: registryServerId, version } = parseServerNameVersion(inputServerName);

    // Validate version format if provided
    if (version && !validateVersion(version)) {
      throw new Error(`Invalid version format: '${version}'. Expected semantic version (e.g., 1.2.3).`);
    }

    if (verbose) {
      logger.info(`Parsed registry server ID: ${registryServerId}, version: ${version || 'latest'}`);
    }

    // For registry installations, we need to validate the registry server ID format
    // and then derive a valid local server name
    validateRegistryServerId(registryServerId);

    // Derive a valid local server name from the registry ID
    const serverName = deriveLocalServerName(registryServerId);

    if (verbose) {
      logger.info(`Derived local server name: ${serverName} from registry ID: ${registryServerId}`);
    }

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

      // Perform installation - pass the registry server ID for fetching from registry
      // but use the derived local name for configuration
      const result = await installationService.installServer(registryServerId, version, {
        force,
        verbose,
        localServerName: serverName, // Pass the derived local name
        registryServerId: registryServerId, // Pass the registry ID for tagging
      });

      // Update progress: Finalizing
      progressTracker.updateProgress(operationId, 4, 'Finalizing', 'Saving configuration');

      // Save the configuration returned by the installation service
      if (result.config) {
        const { setServer } = await import('./utils/configUtils.js');
        setServer(serverName, result.config);
        if (verbose) {
          logger.info(`Configuration saved for server '${serverName}'`);
        }
      }

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

    // Enhanced error guidance for registry-related failures
    if (
      errorMessage.includes('Failed to fetch server with ID') ||
      errorMessage.includes('not found in registry') ||
      (errorMessage.includes('Server') && errorMessage.includes('not found'))
    ) {
      console.error(`\n❌ Server '${inputServerName}' not found in registry.\n`);
      console.error(`💡 Suggestions:\n`);
      console.error(`   • Search for available servers:`);
      console.error(`     1mcp registry search ${inputServerName}\n`);
      console.error(`   • Use interactive mode to browse:`);
      console.error(`     1mcp mcp install --interactive\n`);
      console.error(`   • Try the full registry ID if you know it:`);
      console.error(`     1mcp mcp install io.github.username/${inputServerName}\n`);
      console.error(`   • View available servers:`);
      console.error(`     1mcp registry search\n`);
    } else {
      console.error(`\n❌ Installation failed: ${errorMessage}\n`);
    }

    if (error instanceof Error && error.stack) {
      logger.error('Installation error stack:', error.stack);
    }
    throw error;
  }
}

/**
 * Validate registry server ID format
 * Registry server IDs can contain dots, slashes, and hyphens (e.g., io.github.user/server-name)
 */
function validateRegistryServerId(registryId: string): void {
  if (!registryId || registryId.trim().length === 0) {
    throw new Error('Registry server ID cannot be empty');
  }

  const trimmedId = registryId.trim();

  // Check for invalid characters that should never be in server IDs
  // eslint-disable-next-line no-control-regex
  const invalidChars = /[<>"\\|?*\x00-\x1f]/;
  if (invalidChars.test(trimmedId)) {
    throw new Error(`Registry server ID contains invalid characters: ${registryId}`);
  }

  // Check length limits
  if (trimmedId.length > 255) {
    throw new Error(`Registry server ID too long (max 255 characters): ${registryId}`);
  }

  // Check for invalid patterns
  if (trimmedId.includes('//') || trimmedId.startsWith('/') || trimmedId.endsWith('/')) {
    throw new Error(`Registry server ID has invalid format: ${registryId}`);
  }

  logger.debug(`Registry server ID validation passed: ${trimmedId}`);
}

/**
 * Derive a valid local server name from a registry server ID
 * Example: io.github.SnowLeopard-AI/bigquery-mcp -> bigquery-mcp
 */
function deriveLocalServerName(registryId: string): string {
  // Extract the last part after the slash, or use the full ID if no slash
  const lastPart = registryId.includes('/') ? registryId.split('/').pop()! : registryId;

  // If it already starts with a letter and only contains valid chars, use it as-is
  const localNameRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  if (localNameRegex.test(lastPart) && lastPart.length <= 50) {
    return lastPart;
  }

  // Otherwise, sanitize it:
  // 1. Replace invalid characters with underscores
  // 2. Ensure it starts with a letter
  // 3. Truncate if too long
  let sanitized = lastPart.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Ensure it starts with a letter
  if (!/^[a-zA-Z]/.test(sanitized)) {
    sanitized = `server_${sanitized}`;
  }

  // Truncate to 50 characters if longer
  if (sanitized.length > 50) {
    sanitized = sanitized.substring(0, 50);
  }

  // Ensure it's not empty after sanitization
  if (sanitized.length === 0) {
    sanitized = 'server';
  }

  logger.debug(`Derived local server name '${sanitized}' from registry ID '${registryId}'`);
  return sanitized;
}

/**
 * Run interactive installation workflow
 */
async function runInteractiveInstallation(argv: InstallCommandArgs): Promise<void> {
  const {
    serverName: initialServerId,
    config: configPath,
    'config-dir': configDir,
    force = false,
    dryRun = false,
    verbose = false,
  } = argv;

  // Initialize configuration context
  initializeConfigContext(configPath, configDir);

  // Create registry client
  const registryClient = new MCPRegistryClient({
    baseUrl: 'https://registry.modelcontextprotocol.io',
    timeout: 30000,
    cache: {
      defaultTtl: 300,
      maxSize: 100,
      cleanupInterval: 60000,
    },
  });

  // Create wizard
  const wizard = new InstallWizard(registryClient);

  // Get existing server names for conflict detection
  const getExistingNames = () => Object.keys(getAllServers());

  // Run wizard loop (supports installing multiple servers)
  let continueInstalling = true;
  let currentServerId = initialServerId;

  try {
    while (continueInstalling) {
      const existingNames = getExistingNames();
      const wizardResult = await wizard.run(currentServerId, existingNames);

      if (wizardResult.cancelled) {
        console.log('\n❌ Installation cancelled.\n');
        wizard.cleanup();
        process.exit(0);
      }

      // Perform installation with collected configuration
      try {
        const registryServerId = wizardResult.serverId;
        const version = wizardResult.version;
        const serverName = wizardResult.localName || deriveLocalServerName(registryServerId);

        // Use forceOverride from wizard if user selected override option
        const shouldForce = force || wizardResult.forceOverride || false;

        // Check if server already exists (early check)
        const serverAlreadyExists = serverExists(serverName);
        if (serverAlreadyExists && !shouldForce) {
          console.error(`\n❌ Server '${serverName}' already exists. Use --force to reinstall.\n`);
          wizard.cleanup();
          if (wizardResult.installAnother) {
            currentServerId = undefined;
            continue;
          }
          process.exit(1);
        }

        // Dry run mode
        if (dryRun) {
          console.log('🔍 Dry run mode - no changes will be made\n');
          console.log(`Would install: ${serverName}${version ? `@${version}` : ''}`);
          console.log(`From registry: https://registry.modelcontextprotocol.io\n`);
          if (wizardResult.installAnother) {
            currentServerId = undefined;
            continue;
          }
          wizard.cleanup();
          process.exit(0);
        }

        // Create operation ID for tracking
        const operationId = generateOperationId();
        const progressTracker = getProgressTrackingService();

        // Helper function to show step indicator
        const showStepIndicator = (currentStep: number, skipClear = false) => {
          if (!skipClear) {
            console.clear();
          }
          const steps = ['Search', 'Select', 'Configure', 'Confirm', 'Install'];
          const stepBar = steps
            .map((step, index) => {
              const num = index + 1;
              if (num < currentStep) {
                return chalk.green(`✓ ${step}`);
              } else if (num === currentStep) {
                return chalk.cyan.bold(`► ${step}`);
              } else {
                return chalk.gray(`○ ${step}`);
              }
            })
            .join(' → ');
          console.log(boxen(stepBar, { padding: { left: 2, right: 2, top: 0, bottom: 0 }, borderStyle: 'round' }));
          console.log('');
        };

        // Show Install step indicator (clear screen before starting)
        showStepIndicator(5, false);

        // Start progress tracking
        progressTracker.startOperation(operationId, 'install', 5);

        try {
          // Get installation service
          const installationService = createServerInstallationService();

          // Update progress: Validating
          console.log(chalk.cyan('⏳ Validating server...'));
          progressTracker.updateProgress(operationId, 1, 'Validating server', `Checking registry for ${serverName}`);

          // Create backup if replacing existing server
          let backupPath: string | undefined;
          if (serverAlreadyExists) {
            console.log(chalk.cyan('⏳ Creating backup...'));
            progressTracker.updateProgress(operationId, 2, 'Creating backup', `Backing up existing configuration`);
            backupPath = backupConfig();
            console.log(chalk.gray(`   Backup created: ${backupPath}`));
            logger.info(`Backup created: ${backupPath}`);

            // Remove the existing server before reinstalling to prevent duplicates
            const { removeServer } = await import('./utils/configUtils.js');
            const removed = removeServer(serverName);
            if (removed) {
              console.log(chalk.gray(`   Removed existing server '${serverName}'`));
              if (verbose) {
                logger.info(`Removed existing server '${serverName}' before reinstalling`);
              }
            }
          }

          // Update progress: Installing
          console.log(chalk.cyan(`⏳ Installing ${serverName}${version ? `@${version}` : ''}...`));
          progressTracker.updateProgress(
            operationId,
            3,
            'Installing server',
            `Installing ${serverName}${version ? `@${version}` : ''}`,
          );

          // Perform installation
          const result = await installationService.installServer(registryServerId, version, {
            force: shouldForce,
            verbose,
            localServerName: serverName,
            registryServerId: registryServerId, // Pass the registry ID for tagging
            tags: wizardResult.tags,
            env: wizardResult.env,
            args: wizardResult.args,
          });

          // Update progress: Finalizing
          console.log(chalk.cyan('⏳ Finalizing...'));
          progressTracker.updateProgress(operationId, 4, 'Finalizing', 'Saving configuration');

          // Save the configuration returned by the installation service
          if (result.config) {
            const { setServer } = await import('./utils/configUtils.js');
            setServer(serverName, result.config);
            if (verbose) {
              logger.info(`Configuration saved for server '${serverName}'`);
            }
          }

          // Update progress: Reloading
          console.log(chalk.cyan('⏳ Reloading configuration...'));
          progressTracker.updateProgress(operationId, 5, 'Reloading configuration', 'Applying changes');

          // Reload MCP configuration
          reloadMcpConfig();

          // Complete the operation
          const duration = result.installedAt ? Date.now() - result.installedAt.getTime() : 0;
          progressTracker.completeOperation(operationId, {
            success: true,
            operationId,
            duration,
            message: `Successfully installed ${serverName}`,
          });

          // Show completed step indicator with all steps marked as done (don't clear logs)
          console.log('');
          showStepIndicator(6, true); // 6 means all steps are completed, true = skip clear

          // Report success
          console.log(
            chalk.green.bold(`✅ Successfully installed server '${serverName}'${version ? ` version ${version}` : ''}`),
          );
          if (backupPath) {
            console.log(chalk.gray(`📁 Backup created: ${backupPath}`));
          }
          if (result.warnings.length > 0) {
            console.log(chalk.yellow('\n⚠️  Warnings:'));
            result.warnings.forEach((warning) => console.log(chalk.yellow(`   • ${warning}`)));
          }
        } catch (error) {
          progressTracker.failOperation(operationId, error as Error);
          throw error;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Enhanced error guidance for registry-related failures in interactive mode
        if (
          errorMessage.includes('Failed to fetch server with ID') ||
          errorMessage.includes('not found in registry') ||
          (errorMessage.includes('Server') && errorMessage.includes('not found'))
        ) {
          console.error(`\n❌ Server '${wizardResult.serverId}' not found in registry.\n`);
          console.error(`💡 Suggestions:\n`);
          console.error(`   • Try searching for the server first:`);
          console.error(`     1mcp registry search ${wizardResult.serverId}\n`);
          console.error(`   • Use the exact Registry ID from search results\n`);
          console.error(`   • Try searching with different keywords\n`);
          console.error(`   • Or continue to search for another server\n`);
        } else {
          console.error(`\n❌ Installation failed: ${errorMessage}\n`);
        }

        if (error instanceof Error && error.stack) {
          logger.error('Installation error stack:', error.stack);
        }

        if (wizardResult.installAnother) {
          const continueAfterError = await wizard.run(undefined, getExistingNames());
          if (continueAfterError.cancelled) {
            wizard.cleanup();
            process.exit(1);
          }
          currentServerId = undefined;
          continue;
        }

        wizard.cleanup();
        process.exit(1);
      }

      // Check if user wants to install another
      if (wizardResult.installAnother) {
        currentServerId = undefined;
        continueInstalling = true;
      } else {
        continueInstalling = false;
      }
    }
  } finally {
    // Always cleanup wizard resources
    wizard.cleanup();
  }

  // Explicitly exit after successful completion to prevent hanging
  // This ensures stdin doesn't keep the process alive
  process.exit(0);
}
