import type { Argv } from 'yargs';
import { discoverAppConfigs, checkConsolidationStatus } from '@src/utils/discovery/appDiscovery.js';
import { getAppPreset, getSupportedApps, isAppConfigurable } from '@src/utils/discovery/appPresets.js';
import { listAppBackups } from '@src/utils/management/backupManager.js';
import { GlobalOptions } from '@src/globalOptions.js';

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
  console.log('📊 Application MCP Configuration Status\n');

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
    console.error(`❌ Unsupported application: ${appName}`);
    console.log('Use "npx @1mcp/agent app list" to see supported applications.');
    process.exit(1);
  }

  console.log(`📱 ${preset.displayName} (${appName})\n`);

  if (!isAppConfigurable(appName)) {
    console.log('🔧 Status: Manual setup required');
    console.log('   This application requires manual configuration.');
    console.log('   Use: npx @1mcp/agent app consolidate ' + appName + ' --manual-only');
    return;
  }

  // Discover configurations
  const discovery = await discoverAppConfigs(appName);

  if (discovery.configs.length === 0) {
    console.log('🔴 Status: No configuration found');
    console.log('   No MCP configuration files detected.');
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
    console.log('🟢 Status: Consolidated into 1mcp');
    console.log(`   Application is configured to use 1mcp proxy: ${consolidationStatus.consolidatedUrl}`);
    if (consolidationStatus.configPath) {
      console.log(`   Configuration: ${consolidationStatus.configPath}`);
    }
  } else if (serverCount > 0) {
    console.log(`🟡 Status: Direct MCP connections (${serverCount} servers)`);
    console.log('   Application connects directly to MCP servers.');
  } else {
    console.log('🟡 Status: Configuration exists but no MCP servers');
    console.log('   Configuration file found but no MCP servers configured.');
  }

  // Show configuration details
  console.log(`\n📋 Configuration Details:`);
  console.log(`   Files found: ${validConfigs.length}`);

  validConfigs.forEach((config, index) => {
    console.log(`   ${index + 1}. ${config.path} (${config.level})`);
    if (verbose) {
      console.log(`      Servers: ${config.servers.length}`);
      if (config.servers.length > 0) {
        config.servers.forEach((server) => {
          const type = server.url ? 'URL' : 'Command';
          const value = server.url || server.command;
          console.log(`        - ${server.name} (${type}: ${value})`);
        });
      }
    } else {
      console.log(`      Servers: ${config.servers.map((s) => s.name).join(', ') || 'none'}`);
    }
  });

  // Show backup information
  const backups = listAppBackups(appName);
  if (backups.length > 0) {
    console.log(`\n💾 Backups Available: ${backups.length}`);
    const latestBackup = backups[0]; // Most recent
    console.log(`   Latest: ${latestBackup.age} (${latestBackup.operation})`);

    if (verbose) {
      console.log('   All backups:');
      backups.forEach((backup) => {
        console.log(`     - ${backup.age}: ${backup.backupPath}`);
      });
    }
  } else {
    console.log('\n💾 Backups: None');
  }

  // Recommendations
  console.log('\n💡 Recommendations:');
  if (consolidationStatus.isConsolidated) {
    console.log('   ✅ Application is already consolidated.');
    if (backups.length > 0) {
      console.log('   🔄 To restore original config: npx @1mcp/agent app restore ' + appName);
    }
  } else if (serverCount > 0) {
    console.log('   📦 Consolidate into 1mcp: npx @1mcp/agent app consolidate ' + appName);
    console.log('   📋 Preview changes: npx @1mcp/agent app consolidate ' + appName + ' --dry-run');
  } else {
    console.log('   🔧 Configure MCP servers first, then consolidate.');
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
  console.log('Application Status Overview:\n');

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

    console.log(`${statusIcon} ${result.displayName.padEnd(20)} ${statusText}`);

    if (verbose && result.status !== 'manual' && result.status !== 'error') {
      console.log(
        `   📁 Configs: ${result.configCount}, 🔧 Servers: ${result.serverCount}, 💾 Backups: ${result.hasBackups ? 'Yes' : 'No'}`,
      );
    }
  });

  // Summary
  const consolidated = statusResults.filter((r) => r.status === 'consolidated').length;
  const direct = statusResults.filter((r) => r.status === 'direct').length;
  const manual = statusResults.filter((r) => r.status === 'manual').length;
  const noConfig = statusResults.filter((r) => r.status === 'no-config').length;

  console.log(`\n📊 Summary (${statusResults.length} applications):`);
  console.log(`   🟢 Consolidated: ${consolidated}`);
  console.log(`   🟡 Direct connections: ${direct}`);
  console.log(`   🔧 Manual setup: ${manual}`);
  console.log(`   🔴 No configuration: ${noConfig}`);

  if (direct > 0) {
    console.log('\n💡 Consolidation opportunities:');
    const directApps = statusResults.filter((r) => r.status === 'direct');
    const appNames = directApps.map((r) => r.app).join(' ');
    console.log(`   npx @1mcp/agent app consolidate ${appNames}`);
  }
}
