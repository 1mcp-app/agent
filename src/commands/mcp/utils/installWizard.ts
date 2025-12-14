import { MCPRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import { RegistryServer } from '@src/domains/registry/types.js';
import logger from '@src/logger/logger.js';

import boxen from 'boxen';
import chalk from 'chalk';
import prompts from 'prompts';

import { askInstallAnother, collectConfiguration } from '../wizard/configuration.js';
import { showConfirmation, showStepIndicator, showWelcome } from '../wizard/display.js';
import { cleanup } from '../wizard/navigation.js';
import { confirmServerId, searchServers } from '../wizard/search.js';
import { selectFromResults } from '../wizard/selection.js';

/**
 * Configuration result from the interactive wizard
 */
export interface WizardInstallConfig {
  serverId: string;
  version?: string;
  localName?: string;
  tags?: string[];
  env?: Record<string, string>;
  args?: string[];
  installAnother: boolean;
  cancelled: boolean;
  forceOverride?: boolean;
}

/**
 * Interactive installation wizard for MCP servers
 */
export class InstallWizard {
  private registryClient: MCPRegistryClient;

  constructor(registryClient: MCPRegistryClient) {
    this.registryClient = registryClient;
  }

  /**
   * Run the complete interactive installation wizard
   */
  async run(initialServerId?: string, existingServerNames: string[] = []): Promise<WizardInstallConfig> {
    try {
      // Show welcome screen with controls
      showWelcome();

      let serverId = initialServerId;
      let selectedServer: RegistryServer | undefined;

      // Step 1: Get server (search or use provided ID)
      if (!serverId) {
        const searchResult = await searchServers(this.registryClient, showStepIndicator, selectFromResults);
        if (searchResult.cancelled) {
          return this.cancelledResult();
        }
        selectedServer = searchResult.server;
      } else {
        // Confirm provided server ID
        const confirmed = await confirmServerId(serverId);
        if (!confirmed) {
          return this.cancelledResult();
        }
        // Fetch server details
        try {
          selectedServer = await this.registryClient.getServerById(serverId);
        } catch (error) {
          logger.error('Failed to fetch server details', { serverId, error });
          console.log(
            boxen(chalk.red.bold(`❌ Server '${serverId}' not found in registry`), {
              padding: 1,
              borderStyle: 'round',
              borderColor: 'red',
            }),
          );
          return this.cancelledResult();
        }
      }

      if (!selectedServer) {
        return this.cancelledResult();
      }

      // Step 2: Configuration prompts
      let config = await collectConfiguration(selectedServer, existingServerNames);
      if (config.cancelled) {
        return this.cancelledResult();
      }

      // Step 3: Confirmation summary (with back navigation)
      while (true) {
        showConfirmation(selectedServer, config);

        const result = await prompts({
          type: 'toggle',
          name: 'confirmed',
          message: 'Proceed with installation?',
          initial: true,
          active: 'yes',
          inactive: 'go back',
        });

        // If user cancelled (Ctrl+C)
        if (result.confirmed === undefined) {
          return this.cancelledResult();
        }

        // If user selected "go back" (toggled to false)
        if (result.confirmed === false) {
          // Go back to configuration step
          const newConfig = await collectConfiguration(selectedServer, existingServerNames);
          if (newConfig.cancelled) {
            return this.cancelledResult();
          }
          config = newConfig;
          continue; // Show confirmation again with new config
        }

        // Confirmed - proceed to next step
        break;
      }

      // Step 4: Ask to install another
      const installAnother = await askInstallAnother();

      // If not installing another, cleanup now
      if (!installAnother) {
        cleanup();
      }

      return {
        serverId: selectedServer.name,
        version: config.version,
        localName: config.localName,
        tags: config.tags,
        env: config.env,
        args: config.args,
        installAnother,
        cancelled: false,
        forceOverride: config.forceOverride,
      };
    } catch (error) {
      logger.error('Wizard failed', { error });
      console.log(
        boxen(chalk.red.bold('❌ Installation wizard failed - see logs for details'), {
          padding: 1,
          borderStyle: 'round',
          borderColor: 'red',
        }),
      );
      cleanup();
      return this.cancelledResult();
    }
  }

  /**
   * Cleanup wizard resources
   */
  cleanup(): void {
    cleanup();
  }

  /**
   * Create a cancelled result
   */
  private cancelledResult(): WizardInstallConfig {
    return {
      serverId: '',
      cancelled: true,
      installAnother: false,
    };
  }
}
