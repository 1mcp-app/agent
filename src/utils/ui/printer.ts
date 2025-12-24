/**
 * Centralized printer utility for CLI output
 *
 * Provides consistent, styled output for commands with both imperative
 * and fluent/chainable API support.
 */
import boxen from 'boxen';
import chalk from 'chalk';

import { createSpinner, type Spinner } from './spinner.js';
import { printTable, type TableOptions } from './table.js';

/**
 * Printer class with fluent API support
 */
class Printer {
  /**
   * Print a success message (green with checkmark)
   */
  success(message: string): this {
    console.log(chalk.green('✅'), message);
    return this;
  }

  /**
   * Print an error message (red with crossmark)
   */
  error(message: string): this {
    console.log(chalk.red('❌'), message);
    return this;
  }

  /**
   * Print a warning message (yellow with warning icon)
   */
  warn(message: string): this {
    console.log(chalk.yellow('⚠️'), message);
    return this;
  }

  /**
   * Print an info message (cyan with info icon)
   */
  info(message: string): this {
    console.log(chalk.cyan('💡'), message);
    return this;
  }

  /**
   * Print a debug message (dim with debug icon)
   */
  debug(message: string): this {
    console.log(chalk.dim('🔍'), message);
    return this;
  }

  /**
   * Print a title (bold cyan)
   */
  title(text: string): this {
    console.log();
    console.log(chalk.bold.cyan(text));
    return this;
  }

  /**
   * Print a subtitle (bold white)
   */
  subtitle(text: string): this {
    console.log(chalk.bold(text));
    return this;
  }

  /**
   * Print a blank line
   */
  blank(): this {
    console.log();
    return this;
  }

  /**
   * Print boxed content
   */
  box(content: string, title?: string): this {
    const boxed = boxen(content, {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
      title,
      titleAlignment: 'center',
    });
    console.log(boxed);
    return this;
  }

  /**
   * Print key-value pairs
   */
  keyValue(pairs: Record<string, string | number>): this {
    const maxKeyLength = Math.max(...Object.keys(pairs).map((k) => k.length));
    for (const [key, value] of Object.entries(pairs)) {
      const paddedKey = key.padEnd(maxKeyLength);
      const styledValue = this.colorizeValue(value);
      console.log(`   ${chalk.bold(paddedKey)}: ${styledValue}`);
    }
    return this;
  }

  /**
   * Print a list with optional icon
   */
  list(items: string[], icon: string = '•'): this {
    for (const item of items) {
      console.log(`   ${chalk.dim(icon)} ${item}`);
    }
    return this;
  }

  /**
   * Print raw output without styling
   */
  raw(message: string): this {
    console.log(message);
    return this;
  }

  /**
   * Print a table
   */
  table(options: TableOptions): this {
    printTable(options);
    return this;
  }

  /**
   * Create a spinner for async operations
   */
  spinner(text: string): Spinner {
    return createSpinner(text);
  }

  /**
   * Print server status with enabled/disabled indicator
   */
  serverStatus(name: string, enabled: boolean, details?: string): this {
    const icon = enabled ? chalk.green('🟢') : chalk.red('🔴');
    const status = enabled ? chalk.green('enabled') : chalk.red('disabled');
    console.log(`${icon} ${chalk.bold(name)} [${status}]`);
    if (details) {
      console.log(`   ${chalk.dim(details)}`);
    }
    return this;
  }

  /**
   * Helper method to colorize values based on content
   */
  private colorizeValue(value: string | number): string {
    const str = String(value);

    // Color status-like values
    if (str === 'enabled' || str === 'true' || str === 'connected') {
      return chalk.green(str);
    }
    if (str === 'disabled' || str === 'false' || str === 'disconnected') {
      return chalk.red(str);
    }
    if (str === 'pending' || str === 'loading') {
      return chalk.yellow(str);
    }

    // Color numbers
    if (typeof value === 'number') {
      return chalk.yellow(str);
    }

    // Color URLs
    if (str.startsWith('http://') || str.startsWith('https://')) {
      return chalk.cyan.underline(str);
    }

    return str;
  }
}

// Export default instance for convenience
const printer = new Printer();
export default printer;

// Also export the class for testing/custom instances
export { Printer };
