#!/usr/bin/env node

import 'source-map-support/register.js';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import logger from '@src/logger/logger.js';
import { setupAppCommands } from './commands/app/index.js';
import { setupMcpCommands } from './commands/mcp/index.js';
import { setupPresetCommands } from './commands/preset/index.js';
import { setupServeCommand, serverOptions } from './commands/serve/index.js';
import { setupProxyCommand } from './commands/proxy/index.js';
import { globalOptions, GlobalOptions } from '@src/globalOptions.js';
import { configureGlobalLogger } from './utils/core/configureGlobalLogger.js';
import { MCP_SERVER_VERSION } from '@src/constants.js';

// Parse command line arguments and set up commands
let yargsInstance = yargs(hideBin(process.argv));

// Set up base yargs with global options
yargsInstance = yargsInstance
  .usage('Usage: $0 [command] [options]')
  .options(globalOptions)
  .command('$0', 'Start the 1mcp server (default)', serverOptions, async (argv) => {
    // Default command - redirect to serve command
    configureGlobalLogger(argv as GlobalOptions, argv.transport);
    const { serveCommand } = await import('./commands/serve/serve.js');
    await serveCommand(argv as Parameters<typeof serveCommand>[0]);
  })
  .version(MCP_SERVER_VERSION)
  .env('ONE_MCP') // Enable environment variable parsing with ONE_MCP prefix
  .help()
  .alias('help', 'h')
  .strict() // Enable strict mode to reject unknown commands
  .fail((msg, err, yargs) => {
    // Custom error handler for unknown commands
    if (msg) {
      console.error(`❌ Error: ${msg}\n`);
    }
    if (err) {
      console.error(`❌ ${err.message}\n`);
    }
    yargs.showHelp();
    process.exit(1);
  });

// Register command groups with global options
yargsInstance = setupAppCommands(yargsInstance);
yargsInstance = setupMcpCommands(yargsInstance);
yargsInstance = setupPresetCommands(yargsInstance);
yargsInstance = setupServeCommand(yargsInstance);
yargsInstance = setupProxyCommand(yargsInstance);

/**
 * Check for conflicting global options (options specified both before and after the command)
 */
function checkGlobalOptionConflicts(argv: string[]): void {
  const globalOptionNames = Object.keys(globalOptions).map((key) => (key.startsWith('--') ? key.slice(2) : key));
  const globalOptionAliases = Object.values(globalOptions)
    .map((opt) => ('alias' in opt ? opt.alias : null))
    .filter(Boolean);
  const allGlobalOptions = [...globalOptionNames, ...globalOptionAliases];

  const commandIndex = argv.findIndex(
    (arg) => arg === 'app' || arg === 'mcp' || arg === 'preset' || arg === 'serve' || arg === 'proxy',
  );

  if (commandIndex === -1) return;

  const beforeCommandArgs = argv.slice(0, commandIndex);
  const afterCommandArgs = argv.slice(commandIndex + 1);

  const beforeGlobalOptions = new Set<string>();
  const afterGlobalOptions = new Set<string>();

  // Parse global options before command
  for (let i = 0; i < beforeCommandArgs.length; i++) {
    const arg = beforeCommandArgs[i];
    const optionName = arg.replace(/^--?/, '');

    if (allGlobalOptions.includes(optionName)) {
      beforeGlobalOptions.add(optionName);
    }
  }

  // Parse global options after command
  for (let i = 0; i < afterCommandArgs.length; i++) {
    const arg = afterCommandArgs[i];
    const optionName = arg.replace(/^--?/, '');

    if (allGlobalOptions.includes(optionName)) {
      afterGlobalOptions.add(optionName);
    }
  }

  // Check for conflicts
  const conflicts = Array.from(beforeGlobalOptions).filter((opt) => afterGlobalOptions.has(opt));

  if (conflicts.length > 0) {
    console.error(
      `❌ Error: Cannot specify the following global options both before and after the command: ${conflicts.map((opt) => `--${opt}`).join(', ')}`,
    );
    console.error('   Please specify global options either before OR after the command, not both.');
    console.error('   Example: 1mcp --config test.json mcp list');
    console.error('   OR:      1mcp mcp list --config test.json');
    process.exit(1);
  }
}

/**
 * Main CLI entry point
 */
async function main() {
  // Check for global option conflicts before parsing
  checkGlobalOptionConflicts(process.argv);

  // Let yargs handle all command processing
  await yargsInstance.parse();
}

main().catch((error) => {
  logger.error('CLI error:', error);
  process.exit(1);
});
