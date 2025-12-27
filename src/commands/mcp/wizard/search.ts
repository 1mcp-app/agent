import { MCPRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import { RegistryServer } from '@src/domains/registry/types.js';
import logger from '@src/logger/logger.js';
import printer from '@src/utils/ui/printer.js';

import boxen from 'boxen';
import chalk from 'chalk';
import prompts from 'prompts';

/**
 * Search result from server search
 */
export interface SearchResult {
  serverId: string;
  server?: RegistryServer;
  cancelled: boolean;
}

/**
 * Search for servers interactively
 */
export async function searchServers(
  registryClient: MCPRegistryClient,
  showStepIndicator: (step: number, total: number, name: string) => void,
  selectFromResults: (results: RegistryServer[]) => Promise<{
    server?: RegistryServer;
    goBack: boolean;
    cancelled: boolean;
  }>,
): Promise<SearchResult> {
  let searchTerm = '';
  let searchResults: RegistryServer[] = [];

  while (true) {
    // Show step indicator
    console.clear();
    showStepIndicator(1, 5, 'Search');

    // Get search term
    const searchInput = await prompts({
      type: 'text',
      name: 'query',
      message: 'Enter server name to search:',
      initial: searchTerm,
      validate: (value: string) => {
        if (!value || typeof value !== 'string' || value.trim().length === 0) {
          return 'Search term cannot be empty';
        }
        return true;
      },
    });

    if (!searchInput.query || searchInput.query === '') {
      return { serverId: '', cancelled: true };
    }

    searchTerm = String(searchInput.query).trim();

    // Perform search
    printer.raw(chalk.cyan(`\n🔍 Searching for "${searchTerm}"...\n`));

    try {
      searchResults = await registryClient.searchServers({
        query: searchTerm,
        limit: 20,
      });

      if (searchResults.length === 0) {
        printer.raw(
          boxen(chalk.yellow.bold('⚠️  No servers found matching your search'), {
            padding: 1,
            borderStyle: 'round',
            borderColor: 'yellow',
          }),
        );

        const retry = await prompts({
          type: 'confirm',
          name: 'continue',
          message: 'Try another search?',
          initial: true,
        });

        if (!retry.continue) {
          return { serverId: '', cancelled: true };
        }
        continue;
      }

      // Show results and let user select
      const selection = await selectFromResults(searchResults);
      if (selection.cancelled) {
        return { serverId: '', cancelled: true };
      }
      if (selection.goBack) {
        continue; // Refine search
      }

      return {
        serverId: selection.server!.name,
        server: selection.server,
        cancelled: false,
      };
    } catch (error) {
      logger.error('Search failed', { searchTerm, error });
      printer.raw(
        boxen(chalk.red.bold('❌ Search failed - please try again'), {
          padding: 1,
          borderStyle: 'round',
          borderColor: 'red',
        }),
      );

      const retry = await prompts({
        type: 'confirm',
        name: 'continue',
        message: 'Try again?',
        initial: true,
      });

      if (!retry.continue) {
        return { serverId: '', cancelled: true };
      }
    }
  }
}

/**
 * Confirm a provided server ID
 */
export async function confirmServerId(serverId: string): Promise<boolean> {
  const result = await prompts({
    type: 'confirm',
    name: 'confirmed',
    message: `Install server '${chalk.cyan(serverId)}'?`,
    initial: true,
  });

  return Boolean(result.confirmed);
}
