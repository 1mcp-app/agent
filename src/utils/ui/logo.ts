/**
 * Logo utility for displaying startup banner
 */
import { MCP_SERVER_VERSION } from '@src/constants.js';

import boxen from 'boxen';
import chalk from 'chalk';

/**
 * ASCII art logo for 1MCP with gradient effect
 */
const LOGO_ART_LINES = [
  '     ██╗███╗   ███╗  ██████╗ ██████╗ ',
  '    ███║████╗ ████║ ██╔════╝ ██╔══██╗',
  '    ╚██║██╔████╔██║ ██║      ██████╔╝',
  '     ██║██║╚██╔╝██║ ██║      ██╔═══╝ ',
  '     ██║██║ ╚═╝ ██║ ╚██████╗ ██║     ',
  '     ╚═╝╚═╝     ╚═╝  ╚═════╝ ╚═╝     ',
];

/**
 * Runtime configuration options for logo display
 */
export interface LogoDisplayOptions {
  transport?: string; // 'http' | 'stdio'
  port?: number;
  host?: string;
  serverCount?: number;
  authEnabled?: boolean;
  logLevel?: string;
  configDir?: string;
}

/**
 * Apply cyan gradient effect to logo (bright → dim, top to bottom)
 */
function getColorizedLogo(): string {
  return LOGO_ART_LINES.map((line, index) => {
    if (index === 0 || index === 1) {
      return chalk.cyan.bold(line);
    } else if (index === 2 || index === 3) {
      return chalk.cyan(line);
    } else {
      return chalk.cyan.dim(line);
    }
  }).join('\n');
}

/**
 * Build runtime info lines for display
 */
function buildRuntimeInfo(options?: LogoDisplayOptions): string[] {
  const lines: string[] = [];

  // Always show version
  lines.push(chalk.dim(`Version: ${MCP_SERVER_VERSION}`));

  // Show transport and endpoint info
  if (options?.transport) {
    const transport = options.transport.toUpperCase();
    if (transport === 'HTTP' && options.host && options.port) {
      const endpoint = `${options.host}:${options.port}`;
      lines.push(chalk.dim(`Transport: ${chalk.green(transport)} (${endpoint})`));
    } else {
      lines.push(chalk.dim(`Transport: ${chalk.green(transport)}`));
    }
  }

  // Show server count
  if (options?.serverCount !== undefined) {
    const count = chalk.yellow(options.serverCount.toString());
    lines.push(chalk.dim(`Servers: ${count} configured`));
  }

  // Show auth and log level on same line
  const statusParts: string[] = [];
  if (options?.authEnabled !== undefined) {
    const authStatus = options.authEnabled ? chalk.green('Enabled') : chalk.gray('Disabled');
    statusParts.push(`Auth: ${authStatus}`);
  }
  if (options?.logLevel) {
    const logColor = options.logLevel === 'debug' ? chalk.yellow : chalk.gray;
    statusParts.push(`Log: ${logColor(options.logLevel)}`);
  }
  if (statusParts.length > 0) {
    lines.push(chalk.dim(statusParts.join(' | ')));
  }

  // Show config directory if provided
  if (options?.configDir) {
    lines.push(chalk.dim(`Config: ${options.configDir}`));
  }

  return lines;
}

/**
 * Display the startup logo with version, tagline, and runtime info
 */
export function displayLogo(options?: LogoDisplayOptions): void {
  const logo = getColorizedLogo();

  // Calculate logo width (based on the ASCII art, it's approximately 39 characters)
  const logoWidth = LOGO_ART_LINES[0].length;

  // Center the tagline
  const taglineText = 'All your MCPs in one place';
  const taglinePadding = Math.floor((logoWidth - taglineText.length) / 2);
  const centeredTagline = ' '.repeat(taglinePadding) + chalk.bold.white(taglineText);

  const repository = chalk.dim.gray('https://github.com/1mcp-app/agent');

  // Build content sections
  const sections: string[] = [
    logo,
    '', // Empty line after logo
    centeredTagline,
    '', // Empty line after tagline
    ...buildRuntimeInfo(options),
    '', // Empty line before repo
    repository,
  ];

  const content = sections.join('\n');

  // Display in a beautiful bordered box
  const box = boxen(content, {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: 'cyan',
  });

  console.log(box);
}
