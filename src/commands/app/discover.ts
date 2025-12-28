import { discoverInstalledApps } from '@src/domains/discovery/appDiscovery.js';
import { getAppPreset, showPlatformWarningIfNeeded } from '@src/domains/discovery/appPresets.js';
import { GlobalOptions } from '@src/globalOptions.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

/**
 * Discover command - Find installed desktop applications with MCP configurations.
 *
 * Scans the system for installed applications and their existing
 * MCP server configurations.
 */

interface DiscoverOptions extends GlobalOptions {
  'show-empty': boolean;
  'show-paths': boolean;
}

/**
 * Build the discover command configuration
 */
export function buildDiscoverCommand(yargs: Argv) {
  return yargs
    .option('show-empty', {
      describe: 'Include apps with no MCP servers configured',
      type: 'boolean',
      default: false,
    })
    .option('show-paths', {
      describe: 'Show configuration file paths',
      type: 'boolean',
      default: false,
    })
    .example([
      ['$0 app discover', 'Find installed apps with MCP configs'],
      ['$0 app discover --show-empty', 'Include apps with no servers'],
      ['$0 app discover --show-paths', 'Show config file locations'],
    ]);
}

/**
 * Main discover command handler
 */
export async function discoverCommand(options: DiscoverOptions): Promise<void> {
  // Show platform warning if needed
  showPlatformWarningIfNeeded();

  printer.title('Discovering installed desktop applications with MCP configurations');
  printer.blank();

  try {
    const discovery = await discoverInstalledApps();

    // Filter based on options
    let configurableApps = discovery.configurable;
    if (!options['show-empty']) {
      configurableApps = configurableApps.filter((app) => app.hasConfig && app.serverCount > 0);
    }

    // Show configurable apps
    if (configurableApps.length > 0) {
      printer.subtitle('Found Applications with MCP Configurations:');

      configurableApps.forEach((app) => {
        const preset = getAppPreset(app.name);
        const statusIcon = app.hasConfig ? (app.serverCount > 0 ? '🟢' : '🟡') : '🔴';

        printer.raw(`${statusIcon} ${preset?.displayName || app.name} (${app.name})`);

        if (app.hasConfig) {
          printer.info(`   Configurations found: ${app.configCount}`);
          printer.info(`   MCP servers: ${app.serverCount}`);

          if (options['show-paths'] && app.paths.length > 0) {
            printer.info('   Configuration paths:');
            app.paths.forEach((path) => {
              printer.raw(`      ${path}`);
            });
          }
        } else {
          printer.info('   No configuration files found');
        }

        printer.blank();
      });
    } else {
      printer.info('No applications with MCP configurations found.');

      if (!options['show-empty']) {
        printer.blank();
        printer.info(
          'Tip: Use --show-empty to see all supported applications, including those without configurations.',
        );
      }
    }

    // Show manual-only apps
    if (discovery.manualOnly.length > 0) {
      printer.blank();
      printer.info('Manual Setup Applications (Configuration not accessible):');
      discovery.manualOnly.forEach((appName) => {
        const preset = getAppPreset(appName);
        printer.raw(`   📱 ${preset?.displayName || appName} (${appName})`);
      });
      printer.blank();
    }

    // Summary
    const totalWithServers = configurableApps.filter((app) => app.serverCount > 0).length;
    const totalServers = configurableApps.reduce((sum, app) => sum + app.serverCount, 0);

    printer.blank();
    printer.subtitle('Discovery Summary:');
    printer.info(`   Apps with MCP servers: ${totalWithServers}`);
    printer.info(`   Total MCP servers found: ${totalServers}`);
    printer.info(`   Manual setup apps: ${discovery.manualOnly.length}`);

    if (totalWithServers > 0) {
      printer.blank();
      printer.info('Next steps:');
      printer.info('   1. Review the applications and their MCP servers above');
      printer.info('   2. Consolidate into 1mcp: npx @1mcp/agent app consolidate <app-name>');
      printer.info('   3. Start 1mcp server to proxy all your MCP servers');

      printer.blank();
      printer.info('Quick consolidation (all apps):');
      const appsWithServers = configurableApps.filter((app) => app.serverCount > 0).map((app) => app.name);

      if (appsWithServers.length > 0) {
        printer.raw(`   npx @1mcp/agent app consolidate ${appsWithServers.join(' ')}`);
      }
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    printer.error(`Discovery failed: ${errorMessage}`);
    process.exit(1);
  }
}
