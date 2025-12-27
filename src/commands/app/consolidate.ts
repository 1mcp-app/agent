import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { initializeConfigContext, setServer } from '@src/commands/shared/baseConfigUtils.js';
import ConfigContext from '@src/config/configContext.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { getAppBackupDir } from '@src/constants.js';
import { MCPServerParams } from '@src/core/types/index.js';
import { createBackup, withFileLock } from '@src/domains/backup/backupManager.js';
import {
  checkConsolidationStatus,
  discoverAppConfigs,
  extractAndFilterServers,
  generateAppConfig,
  handleMultipleConfigs,
  type MCPServerConfig,
} from '@src/domains/discovery/appDiscovery.js';
import {
  generateManualInstructions,
  getAppPreset,
  isAppConfigurable,
  isAppSupported,
  showPlatformWarningIfNeeded,
} from '@src/domains/discovery/appPresets.js';
import { generateSupportedAppsHelp } from '@src/domains/discovery/appPresets.js';
import { GlobalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';
import { getServer1mcpUrl, validateServer1mcpUrl } from '@src/utils/validation/urlDetection.js';
import { generateOperationPreview, validateOperation } from '@src/utils/validation/validationHelpers.js';

import type { Argv } from 'yargs';

/**
 * Consolidate command - Main consolidation logic for MCP servers.
 *
 * Extracts MCP servers from desktop applications and consolidates
 * them into 1mcp with safe backup and validation.
 */

interface ConsolidateOptions extends GlobalOptions {
  'app-name': string[];
  url?: string;
  'dry-run': boolean;
  yes: boolean;
  'manual-only': boolean;
  'backup-only': boolean;
  force: boolean;
}

interface ConsolidationResult {
  app: string;
  status: 'success' | 'manual' | 'skipped' | 'failed';
  message: string;
  serversImported?: number;
  backupPath?: string;
  manualInstructions?: string;
}

/**
 * Build the consolidate command configuration
 */
export function buildConsolidateCommand(yargs: Argv) {
  return yargs
    .positional('app-name', {
      describe: 'Desktop app(s) to consolidate (claude-desktop, cursor, vscode, etc.)',
      type: 'string',
      array: true,
      default: [],
    })
    .option('url', {
      describe: 'Override auto-detected 1mcp server URL',
      type: 'string',
      alias: 'u',
    })
    .option('dry-run', {
      describe: 'Preview changes without making them',
      type: 'boolean',
      default: false,
    })
    .option('yes', {
      describe: 'Skip confirmation prompts (for automation)',
      type: 'boolean',
      default: false,
      alias: 'y',
    })
    .option('manual-only', {
      describe: 'Show manual setup instructions only',
      type: 'boolean',
      default: false,
    })
    .option('backup-only', {
      describe: 'Create backup without replacing config',
      type: 'boolean',
      default: false,
    })
    .option('force', {
      describe: 'Skip validation warnings',
      type: 'boolean',
      default: false,
      alias: 'f',
    })
    .example([
      ['$0 app consolidate claude-desktop', 'Consolidate Claude Desktop MCP servers into 1mcp'],
      ['$0 app consolidate cursor --dry-run', 'Preview consolidation for Cursor'],
      ['$0 app consolidate vscode --url=http://localhost:3051/mcp', 'Use custom 1mcp URL'],
      ['$0 app consolidate claude-desktop cursor vscode', 'Consolidate multiple apps at once'],
    ]).epilogue(`
WHAT IT DOES:
  1. Extracts MCP server configurations from app config files
  2. Imports those servers into your 1mcp configuration
  3. Replaces app config with single 1mcp connection
  4. Creates backup of original app configuration

EXAMPLE WORKFLOW:
  Before: Claude Desktop → [filesystem, postgres, sequential] servers directly
  After:  Claude Desktop → 1mcp → [filesystem, postgres, sequential] servers

${generateSupportedAppsHelp()}
    `);
}

/**
 * Main consolidate command handler
 */
export async function consolidateCommand(options: ConsolidateOptions): Promise<void> {
  const appNames = options['app-name'];

  // Check if app names were provided
  if (!appNames || appNames.length === 0) {
    printer.error('Error: No application names provided.');
    printer.info('Please specify at least one application to consolidate.');
    printer.info('Example: npx @1mcp/agent app consolidate claude-desktop');
    printer.info('Use "npx @1mcp/agent app list" to see supported applications.');
    process.exit(1);
  }

  // Show platform warning if needed
  showPlatformWarningIfNeeded();

  printer.title('Starting MCP server consolidation');
  printer.blank();

  // Validate all app names first
  const invalidApps = appNames.filter((app) => !isAppSupported(app));
  if (invalidApps.length > 0) {
    printer.error(`Unsupported applications: ${invalidApps.join(', ')}`);
    printer.info('Use "npx @1mcp/agent app list" to see supported applications.');
    process.exit(1);
  }

  // Get 1mcp server URL
  const serverUrl = await getServer1mcpUrl(options.url);
  printer.info(`Using 1mcp server: ${serverUrl}`);

  // Validate server connectivity (unless force mode)
  if (!options.force) {
    const connectivityCheck = await validateServer1mcpUrl(serverUrl);
    if (!connectivityCheck.valid) {
      printer.error(`Cannot connect to 1mcp server: Server connectivity issue`);
      printer.info('Make sure the 1mcp server is running or use --force to skip validation.');
      process.exit(1);
    }
    printer.success('1mcp server connectivity verified');
    printer.blank();
  }

  const results: ConsolidationResult[] = [];

  // Process each app
  for (const appName of appNames) {
    printer.blank();
    printer.info(`Processing ${getAppPreset(appName)?.displayName || appName}...`);

    try {
      const result = await consolidateApp(appName, serverUrl, options);
      results.push(result);

      // Display result
      if (result.status === 'success') {
        printer.success(`${result.message}`);
        if (result.serversImported !== undefined) {
          printer.info(`Imported ${result.serversImported} MCP servers`);
        }
        if (result.backupPath) {
          printer.info(`Backup created: ${result.backupPath}`);
        }
      } else if (result.status === 'manual') {
        printer.info(`${result.message}`);
        if (result.manualInstructions) {
          printer.raw(result.manualInstructions);
        }
      } else if (result.status === 'skipped') {
        printer.info(`${result.message}`);
      } else {
        printer.error(`${result.message}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorResult: ConsolidationResult = {
        app: appName,
        status: 'failed',
        message: `Failed to consolidate ${appName}: ${errorMessage}`,
      };
      results.push(errorResult);
      printer.error(`${errorResult.message}`);
    }
  }

  // Final summary
  printer.blank();
  printer.raw('='.repeat(60));
  printer.subtitle('Consolidation Summary:');

  const successful = results.filter((r) => r.status === 'success');
  const manual = results.filter((r) => r.status === 'manual');
  const failed = results.filter((r) => r.status === 'failed');
  const skipped = results.filter((r) => r.status === 'skipped');

  printer.success(`Successful: ${successful.length}`);
  printer.warn(`Manual setup required: ${manual.length}`);
  printer.info(`Skipped: ${skipped.length}`);
  printer.error(`Failed: ${failed.length}`);

  if (successful.length > 0) {
    printer.blank();
    printer.info('Restart the following applications to use consolidated configuration:');
    successful.forEach((result) => {
      printer.raw(`   - ${getAppPreset(result.app)?.displayName || result.app}`);
    });

    printer.blank();
    printer.info('To undo consolidation, use:');
    printer.info('   npx @1mcp/agent app restore <app-name>');
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

/**
 * Consolidate a single application
 */
async function consolidateApp(
  appName: string,
  serverUrl: string,
  options: ConsolidateOptions,
): Promise<ConsolidationResult> {
  // Initialize ConfigContext with CLI options
  initializeConfigContext(options.config, options['config-dir']);
  // Check if app is already consolidated (unless force mode)
  if (!options.force) {
    const consolidationStatus = await checkConsolidationStatus(appName);
    if (consolidationStatus.isConsolidated) {
      return {
        app: appName,
        status: 'skipped',
        message: `Already consolidated to ${consolidationStatus.consolidatedUrl}`,
        serversImported: 0,
      };
    }
  }

  // Check if app is configurable
  if (!isAppConfigurable(appName)) {
    // Manual setup required
    const instructions = generateManualInstructions(appName, serverUrl);
    return {
      app: appName,
      status: 'manual',
      message: `${getAppPreset(appName)?.displayName || appName} requires manual configuration`,
      manualInstructions: instructions,
    };
  }

  // Manual-only mode
  if (options['manual-only']) {
    const instructions = generateManualInstructions(appName, serverUrl);
    return {
      app: appName,
      status: 'manual',
      message: `Manual setup instructions for ${getAppPreset(appName)?.displayName || appName}`,
      manualInstructions: instructions,
    };
  }

  // Discover configurations
  const discovery = await discoverAppConfigs(appName);

  if (discovery.configs.length === 0) {
    return {
      app: appName,
      status: 'skipped',
      message: `No configuration files found for ${getAppPreset(appName)?.displayName || appName}`,
    };
  }

  // Handle multiple configs
  const strategy = handleMultipleConfigs(discovery);

  if (strategy.action === 'none') {
    return {
      app: appName,
      status: 'skipped',
      message: `No valid configuration found for ${getAppPreset(appName)?.displayName || appName}`,
    };
  }

  let targetConfig = strategy.target!;

  // If multiple configs and not in yes mode, ask user to choose
  if (strategy.action === 'choose' && !options.yes && !options['dry-run']) {
    targetConfig = await promptUserChoice(strategy.options!);
  }

  // Extract servers
  const servers = extractAndFilterServers(targetConfig.content, getAppPreset(appName)?.configFormat);

  if (servers.length === 0 && !options.force) {
    return {
      app: appName,
      status: 'skipped',
      message: `No MCP servers found in ${getAppPreset(appName)?.displayName || appName} configuration`,
    };
  }

  // Validate operation
  if (!options.force) {
    const validation = await validateOperation(targetConfig.path, targetConfig.content, serverUrl);

    if (!validation.canProceed) {
      const errors = [
        ...validation.configValidation.errors,
        ...validation.permissionValidation.errors,
        ...validation.connectivityValidation.errors,
      ];
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }
  }

  // Generate preview with correct backup path
  const timestamp = Date.now();
  const dateStr = new Date(timestamp).toISOString().replace(/[:.-]/g, '').slice(0, 15); // YYYYMMDDTHHMMSS
  const appBackupDir = getAppBackupDir(appName);
  const backupFileName = `${dateStr}_consolidate.backup`;
  const backupPath = path.join(appBackupDir, backupFileName);

  const preview = generateOperationPreview(
    appName,
    targetConfig.path,
    servers.map((s) => s.name),
    serverUrl,
    backupPath,
  );

  // Show preview and get confirmation
  if (!options.yes && !options['dry-run']) {
    const confirmed = await confirmOperation(preview);
    if (!confirmed) {
      return {
        app: appName,
        status: 'skipped',
        message: `Consolidation cancelled by user for ${getAppPreset(appName)?.displayName || appName}`,
      };
    }
  }

  // Dry run mode - just show what would happen
  if (options['dry-run']) {
    printer.blank();
    printer.subtitle('Dry Run Preview:');
    printer.info(`App: ${getAppPreset(appName)?.displayName || appName}`);
    printer.info(`Config: ${targetConfig.path}`);
    printer.info(`Servers to import: ${servers.map((s) => s.name).join(', ') || 'none'}`);
    printer.info(`Replacement URL: ${serverUrl}`);
    printer.info(`Backup would be created: ${backupPath}`);

    return {
      app: appName,
      status: 'success',
      message: `Dry run completed for ${getAppPreset(appName)?.displayName || appName}`,
      serversImported: servers.length,
    };
  }

  // Create backup
  const backup = createBackup(targetConfig.path, appName, 'consolidate', servers.length);

  // Backup-only mode
  if (options['backup-only']) {
    return {
      app: appName,
      status: 'success',
      message: `Backup created for ${getAppPreset(appName)?.displayName || appName}`,
      backupPath: backup.backupPath,
    };
  }

  // Perform consolidation with file locking
  await withFileLock(targetConfig.path, async () => {
    try {
      // Import servers to 1mcp
      if (servers.length > 0) {
        await importServersTo1mcp(servers);
      }

      // Generate new config
      const newConfig = generateAppConfig(appName, serverUrl);

      // Write new configuration
      fs.writeFileSync(targetConfig.path, JSON.stringify(newConfig, null, 2));
    } catch (error) {
      // Rollback on failure
      fs.copyFileSync(backup.backupPath, backup.originalPath);
      throw error;
    }
  });

  return {
    app: appName,
    status: 'success',
    message: `Successfully consolidated ${getAppPreset(appName)?.displayName || appName}`,
    serversImported: servers.length,
    backupPath: backup.backupPath,
  };
}

/**
 * Convert MCPServerConfig to MCPServerParams format
 */
function convertToMCPServerParams(server: MCPServerConfig): MCPServerParams {
  const params: MCPServerParams = {
    disabled: false,
  };

  // Determine transport type and set appropriate parameters
  if (server.command) {
    // Stdio transport
    params.type = 'stdio';
    params.command = server.command;
    if (server.args && server.args.length > 0) {
      params.args = server.args;
    }
    if (server.env) {
      params.env = server.env;
    }
  } else if (server.url) {
    // HTTP transport - determine if SSE or regular HTTP
    if (server.url.includes('/sse') || server.url.includes('text/event-stream')) {
      params.type = 'sse';
    } else {
      params.type = 'http';
    }
    params.url = server.url;
  } else {
    throw new Error(`Invalid server configuration: ${server.name} has neither command nor url`);
  }

  // Ensure type is set for type safety
  if (!params.type) {
    throw new Error(`Failed to determine transport type for server: ${server.name}`);
  }

  return params;
}

/**
 * Import MCP servers to 1mcp configuration
 */
async function importServersTo1mcp(servers: MCPServerConfig[]): Promise<void> {
  // Use resolved config path from ConfigContext
  const configContext = ConfigContext.getInstance();
  const filePath = configContext.getResolvedConfigPath();

  const mcpConfig = McpConfigManager.getInstance(filePath);

  // Get current transport config
  const currentConfig = mcpConfig.getTransportConfig();

  for (const server of servers) {
    // Check if server already exists
    if (currentConfig[server.name]) {
      printer.warn(`Server "${server.name}" already exists in 1mcp config - skipping`);
      continue;
    }

    try {
      // Convert to proper MCPServerParams format
      const serverParams = convertToMCPServerParams(server);

      // Add server to configuration
      setServer(server.name, serverParams);

      printer.success(`Imported server: ${server.name}`);

      // Log what was imported
      if (serverParams.type === 'stdio') {
        printer.info(`   Type: stdio`);
        printer.info(`   Command: ${serverParams.command}`);
        if (serverParams.args) printer.info(`   Args: ${serverParams.args.join(' ')}`);
      } else if (serverParams.type === 'http' || serverParams.type === 'sse') {
        printer.info(`   Type: ${serverParams.type}`);
        printer.info(`   URL: ${serverParams.url}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      printer.error(`Failed to import server "${server.name}": ${errorMessage}`);
    }
  }
}

/**
 * Interface for configuration choices
 */
interface ConfigurationChoice {
  path: string;
  level: 'project' | 'user' | 'system';
  servers: MCPServerConfig[];
  priority: number;
  exists: boolean;
  readable: boolean;
  valid: boolean;
  content?: unknown;
  error?: string;
}

/**
 * Prompt user to choose from multiple configurations
 */
async function promptUserChoice(configs: ConfigurationChoice[]): Promise<ConfigurationChoice> {
  printer.blank();
  printer.info('Multiple configurations found:');

  configs.forEach((config, index) => {
    printer.raw(`${index + 1}. ${config.path} (${config.level}, ${config.servers.length} servers)`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('\nWhich configuration would you like to use? (number): ', (answer) => {
      rl.close();

      const choice = parseInt(answer, 10);
      if (choice >= 1 && choice <= configs.length) {
        resolve(configs[choice - 1]);
      } else {
        printer.warn('Invalid choice, using first option.');
        resolve(configs[0]);
      }
    });
  });
}

/**
 * Interface for operation preview
 */
interface OperationPreview {
  app: string;
  configPath: string;
  serversToImport: string[];
  replacementUrl: string;
  backupPath: string;
  risks: string[];
}

/**
 * Confirm operation with user
 */
async function confirmOperation(preview: OperationPreview): Promise<boolean> {
  printer.blank();
  printer.subtitle('Operation Preview:');
  printer.info(`App: ${preview.app}`);
  printer.info(`Config: ${preview.configPath}`);
  printer.info(`Servers to import: ${preview.serversToImport.join(', ') || 'none'}`);
  printer.info(`Replacement URL: ${preview.replacementUrl}`);
  printer.info(`Backup will be created: ${preview.backupPath}`);

  if (preview.risks.length > 0) {
    printer.blank();
    printer.warn('Potential Issues:');
    preview.risks.forEach((risk: string) => printer.raw(`  - ${risk}`));
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('\nAre you sure you want to proceed? (y/n): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
