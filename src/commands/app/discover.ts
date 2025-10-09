import { GlobalOptions } from '@src/globalOptions.js';
import { discoverInstalledApps } from '@src/utils/discovery/appDiscovery.js';
import { getAppPreset, showPlatformWarningIfNeeded } from '@src/utils/discovery/appPresets.js';

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

  console.log('🔍 Discovering installed desktop applications with MCP configurations...\n');

  try {
    const discovery = await discoverInstalledApps();

    // Filter based on options
    let configurableApps = discovery.configurable;
    if (!options['show-empty']) {
      configurableApps = configurableApps.filter((app) => app.hasConfig && app.serverCount > 0);
    }

    // Show configurable apps
    if (configurableApps.length > 0) {
      console.log('✅ Found Applications with MCP Configurations:\n');

      configurableApps.forEach((app) => {
        const preset = getAppPreset(app.name);
        const statusIcon = app.hasConfig ? (app.serverCount > 0 ? '🟢' : '🟡') : '🔴';

        console.log(`${statusIcon} ${preset?.displayName || app.name} (${app.name})`);

        if (app.hasConfig) {
          console.log(`   📋 Configurations found: ${app.configCount}`);
          console.log(`   🔧 MCP servers: ${app.serverCount}`);

          if (options['show-paths'] && app.paths.length > 0) {
            console.log('   📁 Configuration paths:');
            app.paths.forEach((path) => {
              console.log(`      ${path}`);
            });
          }
        } else {
          console.log('   ⚪ No configuration files found');
        }

        console.log();
      });
    } else {
      console.log('ℹ️ No applications with MCP configurations found.');

      if (!options['show-empty']) {
        console.log(
          '\nTip: Use --show-empty to see all supported applications, including those without configurations.',
        );
      }
    }

    // Show manual-only apps
    if (discovery.manualOnly.length > 0) {
      console.log('🔧 Manual Setup Applications (Configuration not accessible):');
      discovery.manualOnly.forEach((appName) => {
        const preset = getAppPreset(appName);
        console.log(`   📱 ${preset?.displayName || appName} (${appName})`);
      });
      console.log();
    }

    // Summary
    const totalWithServers = configurableApps.filter((app) => app.serverCount > 0).length;
    const totalServers = configurableApps.reduce((sum, app) => sum + app.serverCount, 0);

    console.log('📊 Discovery Summary:');
    console.log(`   🎯 Apps with MCP servers: ${totalWithServers}`);
    console.log(`   🔧 Total MCP servers found: ${totalServers}`);
    console.log(`   📱 Manual setup apps: ${discovery.manualOnly.length}`);

    if (totalWithServers > 0) {
      console.log('\n💡 Next steps:');
      console.log('   1. Review the applications and their MCP servers above');
      console.log('   2. Consolidate into 1mcp: npx @1mcp/agent app consolidate <app-name>');
      console.log('   3. Start 1mcp server to proxy all your MCP servers');

      console.log('\n🚀 Quick consolidation (all apps):');
      const appsWithServers = configurableApps.filter((app) => app.serverCount > 0).map((app) => app.name);

      if (appsWithServers.length > 0) {
        console.log(`   npx @1mcp/agent app consolidate ${appsWithServers.join(' ')}`);
      }
    }
  } catch (error: any) {
    console.error(`❌ Discovery failed: ${error.message}`);
    process.exit(1);
  }
}
