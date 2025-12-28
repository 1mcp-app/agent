import type { RegistryServer } from '@src/domains/registry/types.js';
import printer from '@src/utils/ui/printer.js';

import boxen from 'boxen';
import chalk from 'chalk';

/**
 * Render search results list with highlighted selection
 */
export function renderResultsList(results: RegistryServer[], currentIndex: number): void {
  const header = boxen(
    chalk.cyan.bold(`📦 Search Results (${results.length} found)\n\n`) +
      chalk.gray('Controls: ↑↓ Navigate  → Details  Enter Select  ← Back  Esc Cancel'),
    {
      padding: 1,
      borderStyle: 'double',
      borderColor: 'cyan',
      title: 'Select Server',
      titleAlignment: 'center',
    },
  );
  printer.raw(header);

  const listContent = results
    .map((server, index) => {
      const isSelected = index === currentIndex;
      const cursor = isSelected ? chalk.yellow.bold('►') : ' ';
      const nameStyle = isSelected ? chalk.bgGray.white.bold : chalk.white;
      const description = server.description?.substring(0, 60) || 'No description';
      const descStyle = isSelected ? chalk.gray : chalk.dim;

      return `${cursor} ${nameStyle(server.name)}\n  ${descStyle(description)}`;
    })
    .join('\n\n');

  printer.raw(
    boxen(listContent, {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'blue',
    }),
  );
}

/**
 * Format server details for display
 */
export function formatServerDetails(server: RegistryServer): string {
  return (
    chalk.blue.bold(`📋 ${server.name}\n\n`) +
    chalk.yellow.bold('Description:\n') +
    chalk.white(`${server.description || 'No description available'}\n\n`) +
    (server.websiteUrl ? chalk.yellow.bold('Website:\n') + chalk.cyan(`${server.websiteUrl}\n\n`) : '') +
    (server.repository?.url ? chalk.yellow.bold('Repository:\n') + chalk.cyan(`${server.repository.url}\n\n`) : '') +
    chalk.gray('Press any key to return...')
  );
}

/**
 * Display detailed information about a server
 */
export function displayServerDetails(server: RegistryServer): void {
  const content = formatServerDetails(server);

  printer.raw(
    boxen(content, {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'blue',
      title: '🔍 Server Details',
      titleAlignment: 'center',
    }),
  );
}
