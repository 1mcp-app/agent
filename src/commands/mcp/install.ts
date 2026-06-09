import { createServerInstallationWorkflow } from '@src/domains/installation/serverInstallationWorkflow.js';
import { MCPRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import { getProgressTrackingService } from '@src/domains/server-management/index.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import printer from '@src/utils/ui/printer.js';

import boxen from 'boxen';
import chalk from 'chalk';
import type { Argv } from 'yargs';

import {
  createRegistryInstallSource,
  deriveLocalServerName,
  installationWorkflowFailureMessage,
  validateRegistryServerId,
} from './installSource.js';
import { InstallWizard } from './utils/installWizard.js';
import { getAllServers, initializeConfigContext } from './utils/mcpServerConfig.js';
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

    const workflow = createServerInstallationWorkflow();

    // Dry run mode
    if (dryRun) {
      const preview = await workflow.run({
        mode: 'preview',
        force,
        source: createRegistryInstallSource({ registryServerId, version, serverName }),
      });
      if (preview.status !== 'preview') {
        throw new Error(installationWorkflowFailureMessage(preview));
      }

      printer.info('Dry run mode - no changes will be made');
      printer.keyValue({ 'Would install': `${preview.targetName ?? serverName}${version ? `@${version}` : ''}` });
      printer.info('From registry: https://registry.modelcontextprotocol.io');
      printer.info('Use without --dry-run to perform actual installation.');
      return;
    }

    // Create operation ID for tracking
    const operationId = generateOperationId();
    const progressTracker = getProgressTrackingService();

    // Start progress tracking
    progressTracker.startOperation(operationId, 'install', 5);

    try {
      // Update progress: Validating
      progressTracker.updateProgress(operationId, 1, 'Validating server', `Checking registry for ${serverName}`);
      progressTracker.updateProgress(operationId, 2, 'Resolving install', `Preparing configuration for ${serverName}`);

      // Update progress: Installing
      progressTracker.updateProgress(
        operationId,
        3,
        'Installing server',
        `Installing ${serverName}${version ? `@${version}` : ''}`,
      );

      const result = await workflow.run({
        mode: 'apply',
        force,
        source: createRegistryInstallSource({ registryServerId, version, serverName }),
      });
      if (result.status !== 'applied') {
        throw new Error(installationWorkflowFailureMessage(result));
      }

      // Update progress: Finalizing
      progressTracker.updateProgress(operationId, 4, 'Finalizing', 'Saving configuration');

      if (verbose) {
        logger.info(`Configuration saved for server '${serverName}'`);
      }

      // Update progress: Complete pending file-based reload for live serve processes
      progressTracker.updateProgress(operationId, 5, 'Applying changes', 'Saved configuration to disk');

      // Update progress: Complete (completeOperation logs completion)

      // Complete the operation
      progressTracker.completeOperation(operationId, {
        success: true,
        operationId,
        duration: 0,
        message: `Successfully installed ${serverName}`,
      });

      // Report success
      printer.success(`Successfully installed server '${serverName}'${version ? ` version ${version}` : ''}`);
      if (result.configChange?.backup.path) {
        printer.keyValue({ 'Backup created': result.configChange.backup.path });
      }
      if (result.warnings.length > 0) {
        printer.warn('Warnings:');
        result.warnings.forEach((warning) => printer.info(`   • ${warning}`));
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
      printer.error(`Server '${inputServerName}' not found in registry.`);
      printer.blank();
      printer.info('Suggestions:');
      printer.info(`   • Search for available servers: 1mcp registry search ${inputServerName}`);
      printer.info('   • Use interactive mode to browse: 1mcp mcp install --interactive');
      printer.info(
        `   • Try the full registry ID if you know it: 1mcp mcp install io.github.username/${inputServerName}`,
      );
      printer.info('   • View available servers: 1mcp registry search');
    } else {
      printer.error(`Installation failed: ${errorMessage}`);
    }

    if (error instanceof Error && error.stack) {
      logger.error('Installation error stack:', error.stack);
    }
    throw error;
  }
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
        printer.info('\nInstallation cancelled.');
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

        const workflow = createServerInstallationWorkflow();

        // Dry run mode
        if (dryRun) {
          const preview = await workflow.run({
            mode: 'preview',
            force: shouldForce,
            source: createRegistryInstallSource({
              registryServerId,
              version,
              serverName,
              tags: wizardResult.tags,
              env: wizardResult.env,
              args: wizardResult.args,
            }),
          });
          if (preview.status !== 'preview') {
            throw new Error(installationWorkflowFailureMessage(preview));
          }

          printer.info('Dry run mode - no changes will be made');
          printer.keyValue({ 'Would install': `${preview.targetName ?? serverName}${version ? `@${version}` : ''}` });
          printer.info('From registry: https://registry.modelcontextprotocol.io');
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
          printer.raw(boxen(stepBar, { padding: { left: 2, right: 2, top: 0, bottom: 0 }, borderStyle: 'round' }));
          printer.blank();
        };

        // Show Install step indicator (clear screen before starting)
        showStepIndicator(5, false);

        // Start progress tracking
        progressTracker.startOperation(operationId, 'install', 5);

        try {
          // Update progress: Validating
          printer.raw(chalk.cyan('⏳ Validating server...'));
          progressTracker.updateProgress(operationId, 1, 'Validating server', `Checking registry for ${serverName}`);
          progressTracker.updateProgress(
            operationId,
            2,
            'Resolving install',
            `Preparing configuration for ${serverName}`,
          );

          // Update progress: Installing
          printer.raw(chalk.cyan(`⏳ Installing ${serverName}${version ? `@${version}` : ''}...`));
          progressTracker.updateProgress(
            operationId,
            3,
            'Installing server',
            `Installing ${serverName}${version ? `@${version}` : ''}`,
          );

          // Perform installation
          const result = await workflow.run({
            mode: 'apply',
            force: shouldForce,
            source: createRegistryInstallSource({
              registryServerId,
              version,
              serverName,
              tags: wizardResult.tags,
              env: wizardResult.env,
              args: wizardResult.args,
            }),
          });
          if (result.status !== 'applied') {
            throw new Error(installationWorkflowFailureMessage(result));
          }

          // Update progress: Finalizing
          printer.raw(chalk.cyan('⏳ Finalizing...'));
          progressTracker.updateProgress(operationId, 4, 'Finalizing', 'Saving configuration');

          if (verbose) {
            logger.info(`Configuration saved for server '${serverName}'`);
          }

          // Update progress: Applying changes for file-based live reload
          printer.raw(chalk.cyan('⏳ Applying changes...'));
          progressTracker.updateProgress(operationId, 5, 'Applying changes', 'Saved configuration to disk');

          // Complete the operation
          progressTracker.completeOperation(operationId, {
            success: true,
            operationId,
            duration: 0,
            message: `Successfully installed ${serverName}`,
          });

          // Show completed step indicator with all steps marked as done (don't clear logs)
          printer.blank();
          showStepIndicator(6, true); // 6 means all steps are completed, true = skip clear

          // Report success
          printer.raw(
            chalk.green.bold(`✅ Successfully installed server '${serverName}'${version ? ` version ${version}` : ''}`),
          );
          if (result.configChange?.backup.path) {
            printer.raw(chalk.gray(`📁 Backup created: ${result.configChange.backup.path}`));
          }
          if (result.warnings.length > 0) {
            printer.raw(chalk.yellow('\n⚠️  Warnings:'));
            result.warnings.forEach((warning) => printer.raw(chalk.yellow(`   • ${warning}`)));
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
          printer.error(`Server '${wizardResult.serverId}' not found in registry.`);
          printer.blank();
          printer.info('Suggestions:');
          printer.info(`   • Try searching for the server first: 1mcp registry search ${wizardResult.serverId}`);
          printer.info('   • Use the exact Registry ID from search results');
          printer.info('   • Try searching with different keywords');
          printer.info('   • Or continue to search for another server');
        } else {
          printer.error(`Installation failed: ${errorMessage}`);
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
