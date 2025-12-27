import {
  APP_PRESETS,
  getConfigurableApps,
  getManualOnlyApps,
  showPlatformWarningIfNeeded,
} from '@src/domains/discovery/appPresets.js';
import { GlobalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

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

  printer.title('Supported Desktop Applications for MCP Consolidation');

  if (options['configurable-only']) {
    showConfigurableApps();
  } else if (options['manual-only']) {
    showManualOnlyApps();
  } else {
    showAllApps();
  }

  printer.blank();
  printer.info('Usage:');
  printer.info('   npx @1mcp/agent app consolidate <app-name>');
  printer.info('   npx @1mcp/agent app discover  # Find installed apps');
}

/**
 * Show all supported applications
 */
function showAllApps(): void {
  const configurableApps = getConfigurableApps();
  const manualApps = getManualOnlyApps();

  if (configurableApps.length > 0) {
    printer.subtitle('Auto-Configurable Applications (Automatic Consolidation):');
    configurableApps.forEach((appName) => {
      const preset = APP_PRESETS[appName];
      printer.raw(`   ${preset.name.padEnd(15)} - ${preset.displayName}`);
    });
  }

  if (manualApps.length > 0) {
    printer.blank();
    printer.subtitle('Manual Setup Applications (Instructions Provided):');
    manualApps.forEach((appName) => {
      const preset = APP_PRESETS[appName];
      printer.raw(`   ${preset.name.padEnd(15)} - ${preset.displayName}`);
    });
  }

  printer.blank();
  printer.info(`Total: ${configurableApps.length + manualApps.length} applications supported`);
  printer.success(`   Auto-configurable: ${configurableApps.length}`);
  printer.warn(`   Manual setup: ${manualApps.length}`);
}

/**
 * Show only configurable applications
 */
function showConfigurableApps(): void {
  const configurableApps = getConfigurableApps();

  printer.subtitle('Auto-Configurable Applications:');
  printer.info('These applications support automatic MCP server consolidation.');
  printer.blank();

  if (configurableApps.length === 0) {
    printer.info('No auto-configurable applications found.');
    return;
  }

  configurableApps.forEach((appName) => {
    const preset = APP_PRESETS[appName];
    printer.raw(`📱 ${preset.displayName} (${preset.name})`);

    // Show configuration locations
    const locations = preset.locations
      .filter((loc) => loc.platform === 'all' || loc.platform === process.platform)
      .sort((a, b) => b.priority - a.priority);

    if (locations.length > 0) {
      printer.info('   Configuration locations:');
      locations.forEach((loc) => {
        printer.raw(`     ${loc.level}: ${loc.path}`);
      });
    }
    printer.blank();
  });

  printer.info(`${configurableApps.length} auto-configurable applications available.`);
}

/**
 * Show only manual setup applications
 */
function showManualOnlyApps(): void {
  const manualApps = getManualOnlyApps();

  printer.subtitle('Manual Setup Applications:');
  printer.info('These applications require manual configuration with provided instructions.');
  printer.blank();

  if (manualApps.length === 0) {
    printer.info('No manual setup applications found.');
    return;
  }

  manualApps.forEach((appName) => {
    const preset = APP_PRESETS[appName];
    printer.raw(`📱 ${preset.displayName} (${preset.name})`);
    printer.info('   Requires manual setup - instructions will be provided during consolidation.');
    printer.blank();
  });

  printer.info(`${manualApps.length} manual setup applications available.`);
  printer.blank();
  printer.info('To get setup instructions for a manual app:');
  printer.info('   npx @1mcp/agent app consolidate <app-name> --manual-only');
}
