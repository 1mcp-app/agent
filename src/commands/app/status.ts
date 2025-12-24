import { listAppBackups } from '@src/domains/backup/backupManager.js';
import { checkConsolidationStatus, discoverAppConfigs } from '@src/domains/discovery/appDiscovery.js';
import { getAppPreset, getSupportedApps, isAppConfigurable } from '@src/domains/discovery/appPresets.js';
import { GlobalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

/**
 * Status command - Show current status of application configurations.
 *
 * Displays the current state of MCP configurations for desktop applications,
 * including whether they're consolidated, have backups, etc.
 */

interface StatusOptions extends GlobalOptions {
  'app-name'?: string;
  verbose: boolean;
}

/**
 * Build the status command configuration
 */
export function buildStatusCommand(yargs: Argv) {
  return yargs
    .positional('app-name', {
      describe: 'Desktop app to check (claude-desktop, cursor, vscode, etc.)',
      type: 'string',
    })
    .option('verbose', {
      describe: 'Show detailed configuration information',
      type: 'boolean',
      default: false,
      alias: 'v',
    })
    .example([
      ['$0 app status', 'Show status of all apps'],
      ['$0 app status claude-desktop', 'Show status of specific app'],
      ['$0 app status --verbose', 'Show detailed status information'],
    ]);
}

/**
 * Main status command handler
 */
export async function statusCommand(options: StatusOptions): Promise<void> {
  printer.title('Application MCP Configuration Status');
  printer.blank();

  if (options['app-name']) {
    await showSpecificAppStatus(options['app-name'], options.verbose);
  } else {
    await showAllAppsStatus(options.verbose);
  }
}

/**
 * Show status for specific application
 */
async function showSpecificAppStatus(appName: string, verbose: boolean): Promise<void> {
  const preset = getAppPreset(appName);
  if (!preset) {
    printer.error(`Unsupported application: ${appName}`);
    printer.info('Use "npx @1mcp/agent app list" to see supported applications.');
    process.exit(1);
  }

  printer.subtitle(`${preset.displayName} (${appName})`);

  if (!isAppConfigurable(appName)) {
    printer.info('Status: Manual setup required');
    printer.info('   This application requires manual configuration.');
    printer.info(`   Use: npx @1mcp/agent app consolidate ${appName} --manual-only`);
    return;
  }

  // Discover configurations
  const discovery = await discoverAppConfigs(appName);

  if (discovery.configs.length === 0) {
    printer.info('Status: No configuration found');
    printer.info('   No MCP configuration files detected.');
    return;
  }

  // Check for consolidation status using robust detection
  const consolidationStatus = await checkConsolidationStatus(appName);
  const validConfigs = discovery.configs.filter((c) => c.exists && c.readable && c.valid);
  let serverCount = 0;

  for (const config of validConfigs) {
    serverCount += config.servers.length;
  }

  // Display status
  if (consolidationStatus.isConsolidated) {
    printer.success('Status: Consolidated into 1mcp');
    printer.info(`   Application is configured to use 1mcp proxy: ${consolidationStatus.consolidatedUrl}`);
    if (consolidationStatus.configPath) {
      printer.info(`   Configuration: ${consolidationStatus.configPath}`);
    }
  } else if (serverCount > 0) {
    printer.info(`Status: Direct MCP connections (${serverCount} servers)`);
    printer.info('   Application connects directly to MCP servers.');
  } else {
    printer.warn('Status: Configuration exists but no MCP servers');
    printer.info('   Configuration file found but no MCP servers configured.');
  }

  // Show configuration details
  printer.blank();
  printer.subtitle('Configuration Details:');
  printer.info(`   Files found: ${validConfigs.length}`);

  validConfigs.forEach((config, index) => {
    printer.raw(`   ${index + 1}. ${config.path} (${config.level})`);
    if (verbose) {
      printer.info(`      Servers: ${config.servers.length}`);
      if (config.servers.length > 0) {
        config.servers.forEach((server) => {
          const type = server.url ? 'URL' : 'Command';
          const value = server.url || server.command;
          printer.raw(`        - ${server.name} (${type}: ${value})`);
        });
      }
    } else {
      printer.info(`      Servers: ${config.servers.map((s) => s.name).join(', ') || 'none'}`);
    }
  });

  // Show backup information
  const backups = listAppBackups(appName);
  if (backups.length > 0) {
    printer.blank();
    printer.info(`Backups Available: ${backups.length}`);
    const latestBackup = backups[0]; // Most recent
    printer.info(`   Latest: ${latestBackup.age} (${latestBackup.operation})`);

    if (verbose) {
      printer.info('   All backups:');
      backups.forEach((backup) => {
        printer.raw(`     - ${backup.age}: ${backup.backupPath}`);
      });
    }
  } else {
    printer.blank();
    printer.info('Backups: None');
  }

  // Recommendations
  printer.blank();
  printer.info('Recommendations:');
  if (consolidationStatus.isConsolidated) {
    printer.success('   Application is already consolidated.');
    if (backups.length > 0) {
      printer.info(`   To restore original config: npx @1mcp/agent app restore ${appName}`);
    }
  } else if (serverCount > 0) {
    printer.info(`   Consolidate into 1mcp: npx @1mcp/agent app consolidate ${appName}`);
    printer.info(`   Preview changes: npx @1mcp/agent app consolidate ${appName} --dry-run`);
  } else {
    printer.info('   Configure MCP servers first, then consolidate.');
  }
}

/**
 * Show status for all applications
 */
async function showAllAppsStatus(verbose: boolean): Promise<void> {
  const supportedApps = getSupportedApps();
  const statusResults = [];

  for (const appName of supportedApps) {
    const preset = getAppPreset(appName)!;

    if (!isAppConfigurable(appName)) {
      statusResults.push({
        app: appName,
        displayName: preset.displayName,
        status: 'manual',
        configCount: 0,
        serverCount: 0,
        isConsolidated: false,
        hasBackups: false,
      });
      continue;
    }

    try {
      const discovery = await discoverAppConfigs(appName);
      const consolidationStatus = await checkConsolidationStatus(appName);
      const validConfigs = discovery.configs.filter((c) => c.exists && c.readable && c.valid);

      let serverCount = 0;

      for (const config of validConfigs) {
        serverCount += config.servers.length;
      }

      const backups = listAppBackups(appName);

      statusResults.push({
        app: appName,
        displayName: preset.displayName,
        status:
          validConfigs.length === 0
            ? 'no-config'
            : consolidationStatus.isConsolidated
              ? 'consolidated'
              : serverCount > 0
                ? 'direct'
                : 'empty',
        configCount: validConfigs.length,
        serverCount,
        isConsolidated: consolidationStatus.isConsolidated,
        hasBackups: backups.length > 0,
      });
    } catch (_error) {
      statusResults.push({
        app: appName,
        displayName: preset.displayName,
        status: 'error',
        configCount: 0,
        serverCount: 0,
        isConsolidated: false,
        hasBackups: false,
      });
    }
  }

  // Display results
  printer.subtitle('Application Status Overview:');

  statusResults.forEach((result) => {
    let statusIcon = '';
    let statusText = '';

    switch (result.status) {
      case 'consolidated':
        statusIcon = '🟢';
        statusText = 'Consolidated into 1mcp';
        break;
      case 'direct':
        statusIcon = '🟡';
        statusText = `Direct connections (${result.serverCount} servers)`;
        break;
      case 'empty':
        statusIcon = '⚪';
        statusText = 'Config exists, no servers';
        break;
      case 'no-config':
        statusIcon = '🔴';
        statusText = 'No configuration found';
        break;
      case 'manual':
        statusIcon = '🔧';
        statusText = 'Manual setup required';
        break;
      case 'error':
        statusIcon = '❌';
        statusText = 'Error reading configuration';
        break;
    }

    printer.raw(`${statusIcon} ${result.displayName.padEnd(20)} ${statusText}`);

    if (verbose && result.status !== 'manual' && result.status !== 'error') {
      printer.info(
        `   Configs: ${result.configCount}, Servers: ${result.serverCount}, Backups: ${result.hasBackups ? 'Yes' : 'No'}`,
      );
    }
  });

  // Summary
  const consolidated = statusResults.filter((r) => r.status === 'consolidated').length;
  const direct = statusResults.filter((r) => r.status === 'direct').length;
  const manual = statusResults.filter((r) => r.status === 'manual').length;
  const noConfig = statusResults.filter((r) => r.status === 'no-config').length;

  printer.blank();
  printer.subtitle(`Summary (${statusResults.length} applications):`);
  printer.success(`   Consolidated: ${consolidated}`);
  printer.warn(`   Direct connections: ${direct}`);
  printer.warn(`   Manual setup: ${manual}`);
  printer.error(`   No configuration: ${noConfig}`);

  if (direct > 0) {
    printer.blank();
    printer.info('Consolidation opportunities:');
    const directApps = statusResults.filter((r) => r.status === 'direct');
    const appNames = directApps.map((r) => r.app).join(' ');
    printer.raw(`   npx @1mcp/agent app consolidate ${appNames}`);
  }
}
