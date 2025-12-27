import { RegistryServer } from '@src/domains/registry/types.js';
import printer from '@src/utils/ui/printer.js';

import boxen from 'boxen';
import chalk from 'chalk';

/**
 * UI display and rendering utilities for the wizard
 */

/**
 * Show welcome screen with key bindings
 */
export function showWelcome(): void {
  const welcomeContent =
    chalk.magenta.bold('🚀 MCP Server Installation Wizard\n\n') +
    chalk.yellow('This wizard will guide you through installing an MCP server.\n\n') +
    chalk.cyan.bold('Navigation Keys:\n') +
    chalk.gray('  ↑/↓     - Navigate options\n') +
    chalk.gray('  ←       - Go back\n') +
    chalk.gray('  →       - View details\n') +
    chalk.gray('  Tab     - Next step\n') +
    chalk.gray('  Enter   - Confirm\n') +
    chalk.gray('  Ctrl+C  - Cancel');

  printer.raw(
    boxen(welcomeContent, {
      padding: 1,
      margin: 1,
      borderStyle: 'double',
      borderColor: 'cyan',
      title: 'Install Wizard',
      titleAlignment: 'center',
    }),
  );
}

/**
 * Show step indicator
 */
export function showStepIndicator(currentStep: number, _totalSteps: number, _stepName: string): void {
  const steps = ['Search', 'Select', 'Configure', 'Confirm', 'Install'];
  const stepBar = steps
    .map((step, index) => {
      const num = index + 1;
      if (num < currentStep) {
        return chalk.green(`✓ ${step}`);
      } else if (num === currentStep) {
        return chalk.cyan.bold(`► ${step}`);
      } else {
        return chalk.gray(`○ ${step}`);
      }
    })
    .join(chalk.gray(' → '));

  printer.raw(
    boxen(stepBar, {
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      borderStyle: 'single',
      borderColor: 'gray',
    }),
  );
  printer.blank();
}

/**
 * Render the results list with highlighted selection
 */
export function renderResultsList(results: RegistryServer[], currentIndex: number): void {
  showStepIndicator(2, 5, 'Select');

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
 * Show detailed information about a server
 */
export async function showServerDetails(server: RegistryServer, getKeyInput: () => Promise<string>): Promise<void> {
  const content =
    chalk.blue.bold(`📋 ${server.name}\n\n`) +
    chalk.yellow.bold('Description:\n') +
    chalk.white(`${server.description || 'No description available'}\n\n`) +
    (server.websiteUrl ? chalk.yellow.bold('Website:\n') + chalk.cyan(`${server.websiteUrl}\n\n`) : '') +
    (server.repository?.url ? chalk.yellow.bold('Repository:\n') + chalk.cyan(`${server.repository.url}\n\n`) : '') +
    chalk.gray('Press any key to return...');

  printer.raw(
    boxen(content, {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'blue',
      title: '🔍 Server Details',
      titleAlignment: 'center',
    }),
  );

  await getKeyInput();
}

/**
 * Show confirmation summary
 */
export function showConfirmation(
  server: RegistryServer,
  config: {
    version?: string;
    localName?: string;
    tags?: string[];
    env?: Record<string, string>;
    args?: string[];
  },
): void {
  console.clear();
  showStepIndicator(4, 5, 'Confirm');

  let content =
    chalk.green.bold('✅ Installation Summary\n\n') +
    chalk.yellow('Server: ') +
    chalk.cyan.bold(server.name) +
    '\n' +
    (config.version ? chalk.yellow('Version: ') + chalk.white(config.version) + '\n' : '') +
    (config.localName ? chalk.yellow('Local Name: ') + chalk.white(config.localName) + '\n' : '') +
    (config.tags && config.tags.length > 0 ? chalk.yellow('Tags: ') + chalk.white(config.tags.join(', ')) + '\n' : '') +
    (config.env && Object.keys(config.env).length > 0
      ? chalk.yellow('Environment: ') + chalk.white(JSON.stringify(config.env, null, 2)) + '\n'
      : '') +
    (config.args && config.args.length > 0
      ? chalk.yellow('Arguments: ') + chalk.white(config.args.join(' ')) + '\n'
      : '');

  printer.raw(
    boxen(content, {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'green',
      title: '📋 Confirm Installation',
      titleAlignment: 'center',
    }),
  );

  printer.raw(chalk.gray('\nPress ← (left arrow) to go back, → (enter) to proceed, Ctrl+C to cancel\n'));
}
