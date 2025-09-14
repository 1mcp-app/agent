import type { Argv } from 'yargs';
import {
  APP_PRESETS,
  getConfigurableApps,
  getManualOnlyApps,
  showPlatformWarningIfNeeded,
} from '../../utils/appPresets.js';
import { GlobalOptions } from '../../globalOptions.js';

/**
 * List command - Display supported desktop applications.
 *
 * Shows all supported applications with their consolidation status
 * (automatic vs manual setup required).
 */

interface ListOptions extends GlobalOptions {
  'configurable-only': boolean;
  'manual-only': boolean;
}

/**
 * Build the list command configuration
 */
export function buildListCommand(yargs: Argv) {
  return yargs
    .option('configurable-only', {
      describe: 'Show only apps that support automatic consolidation',
      type: 'boolean',
      default: false,
    })
    .option('manual-only', {
      describe: 'Show only apps that require manual setup',
      type: 'boolean',
      default: false,
    })
    .example([
      ['$0 app list', 'List all supported applications'],
      ['$0 app list --configurable-only', 'List only auto-configurable apps'],
      ['$0 app list --manual-only', 'List only manual setup apps'],
    ]);
}

/**
 * Main list command handler
 */
export async function listCommand(options: ListOptions): Promise<void> {
  // Show platform warning if needed
  showPlatformWarningIfNeeded();

  console.log('📱 Supported Desktop Applications for MCP Consolidation\n');

  if (options['configurable-only']) {
    showConfigurableApps();
  } else if (options['manual-only']) {
    showManualOnlyApps();
  } else {
    showAllApps();
  }

  console.log('\n💡 Usage:');
  console.log('   npx @1mcp/agent app consolidate <app-name>');
  console.log('   npx @1mcp/agent app discover  # Find installed apps');
}

/**
 * Show all supported applications
 */
function showAllApps(): void {
  const configurableApps = getConfigurableApps();
  const manualApps = getManualOnlyApps();

  if (configurableApps.length > 0) {
    console.log('✅ Auto-Configurable Applications (Automatic Consolidation):');
    configurableApps.forEach((appName) => {
      const preset = APP_PRESETS[appName];
      console.log(`   ${preset.name.padEnd(15)} - ${preset.displayName}`);
    });
  }

  if (manualApps.length > 0) {
    console.log('\n🔧 Manual Setup Applications (Instructions Provided):');
    manualApps.forEach((appName) => {
      const preset = APP_PRESETS[appName];
      console.log(`   ${preset.name.padEnd(15)} - ${preset.displayName}`);
    });
  }

  console.log(`\n📊 Total: ${configurableApps.length + manualApps.length} applications supported`);
  console.log(`   ✅ Auto-configurable: ${configurableApps.length}`);
  console.log(`   🔧 Manual setup: ${manualApps.length}`);
}

/**
 * Show only configurable applications
 */
function showConfigurableApps(): void {
  const configurableApps = getConfigurableApps();

  console.log('✅ Auto-Configurable Applications:\n');
  console.log('These applications support automatic MCP server consolidation.\n');

  if (configurableApps.length === 0) {
    console.log('No auto-configurable applications found.');
    return;
  }

  configurableApps.forEach((appName) => {
    const preset = APP_PRESETS[appName];
    console.log(`📱 ${preset.displayName} (${preset.name})`);

    // Show configuration locations
    const locations = preset.locations
      .filter((loc) => loc.platform === 'all' || loc.platform === process.platform)
      .sort((a, b) => b.priority - a.priority);

    if (locations.length > 0) {
      console.log('   Configuration locations:');
      locations.forEach((loc) => {
        console.log(`     ${loc.level}: ${loc.path}`);
      });
    }
    console.log();
  });

  console.log(`📊 ${configurableApps.length} auto-configurable applications available.`);
}

/**
 * Show only manual setup applications
 */
function showManualOnlyApps(): void {
  const manualApps = getManualOnlyApps();

  console.log('🔧 Manual Setup Applications:\n');
  console.log('These applications require manual configuration with provided instructions.\n');

  if (manualApps.length === 0) {
    console.log('No manual setup applications found.');
    return;
  }

  manualApps.forEach((appName) => {
    const preset = APP_PRESETS[appName];
    console.log(`📱 ${preset.displayName} (${preset.name})`);
    console.log('   Requires manual setup - instructions will be provided during consolidation.');
    console.log();
  });

  console.log(`📊 ${manualApps.length} manual setup applications available.`);
  console.log('\n💡 To get setup instructions for a manual app:');
  console.log('   npx @1mcp/agent app consolidate <app-name> --manual-only');
}
