import boxen from 'boxen';
import chalk from 'chalk';

/**
 * Show welcome screen with wizard instructions and key bindings
 */
export function showWelcomeScreen(): void {
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

  console.log(
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
