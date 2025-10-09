/**
 * Global logger configuration utility
 * This utility configures the logger for any command using globalOptions
 */

import { configureLogger } from '@src/logger/logger.js';
import { GlobalOptions } from '@src/globalOptions.js';

/**
 * Configure logger for any command using global options
 * @param options Global options that may include log configuration
 * @param transport Optional transport type (for backward compatibility with serve command)
 */
export function configureGlobalLogger(options: GlobalOptions, transport?: string): void {
  configureLogger({
    logLevel: options['log-level'],
    logFile: options['log-file'],
    transport,
  });
}
