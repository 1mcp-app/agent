import type { GlobalOptions } from '@src/globalOptions.js';

export async function runCliCommand<T extends GlobalOptions>(argv: T, fn: (argv: T) => Promise<void>): Promise<void> {
  const { configureGlobalLogger } = await import('@src/logger/configureGlobalLogger.js');
  configureGlobalLogger(argv, 'stdio');
  try {
    await fn(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
