/**
 * Global logger configuration utility
 * This utility configures the logger for any command using globalOptions
 */
import { GlobalOptions } from '@src/globalOptions.js';
import { configureLogger } from '@src/logger/logger.js';

/**
 * Configure logger for any command using global options
 * @param options Global options that may include log configuration. `maxSize`
 *   and `maxFiles` enable size-based file rotation (set by `serve` from the
 *   structured `logging` config); other commands omit them.
 * @param transport Optional transport type (for backward compatibility with serve command)
 */
export function configureGlobalLogger(
  options: GlobalOptions & { maxSize?: number; maxFiles?: number },
  transport?: string,
): void {
  configureLogger({
    logLevel: options['log-level'],
    logFile: options['log-file'],
    maxSize: options.maxSize,
    maxFiles: options.maxFiles,
    transport,
  });
}
