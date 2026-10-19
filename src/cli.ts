import { MCP_SERVER_VERSION } from '@src/constants.js';
import { GlobalOptions, globalOptions, withGlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import { helpWidth, styleHelp } from '@src/utils/cli/help.js';
import { normalizeCliArgv, normalizedArgv } from '@src/utils/cli/normalizedArgv.js';

import 'source-map-support/register.js';
import yargs, { type Argv } from 'yargs';

import { setupAdminCommands } from './commands/admin/index.js';
import { setupAppCommands } from './commands/app/index.js';
import { setupAuthCommands } from './commands/auth/index.js';
import { setupBootstrapCommand } from './commands/bootstrap/index.js';
import { setupCliSetupCommand } from './commands/cliSetup/index.js';
import { setupInspectCommand } from './commands/inspect/index.js';
import { setupInstructionsCommand } from './commands/instructions/index.js';
import { setupMcpCommands } from './commands/mcp/index.js';
import { setupPreparationCommands } from './commands/preparation/index.js';
import { setupPresetCommands } from './commands/preset/index.js';
import { setupProxyCommand } from './commands/proxy/index.js';
import { setupRegistryCommands } from './commands/registry/index.js';
import { setupRunCommand } from './commands/run/index.js';
import { serverOptions, setupServeCommand } from './commands/serve/index.js';
import { setupTargetCommands } from './commands/target/index.js';
import { setupWaitCommand } from './commands/wait/index.js';
import { configureGlobalLogger } from './logger/configureGlobalLogger.js';

export { normalizeCliArgv, normalizedArgv };

function showCliFailure(msg: string | undefined, err: Error | undefined, parser: Argv): never {
  if (msg) console.error(`❌ Error: ${msg}\n`);
  if (err) console.error(`❌ ${err.message}\n`);
  const errorWidth = helpWidth(process.stderr);
  parser.wrap(errorWidth < 80 ? null : errorWidth);
  parser.showHelp((text) => console.error(styleHelp(text, Boolean(process.stderr.isTTY), errorWidth)));
  process.exit(1);
}

// Parse command line arguments and set up commands
let yargsInstance = withGlobalOptions(yargs(normalizedArgv));
const width = helpWidth(process.stdout);

// Set up base yargs with global options
yargsInstance = yargsInstance
  .scriptName('1mcp')
  .wrap(width < 80 ? null : width)
  .usage('1MCP — One MCP server to aggregate them all\n\nUsage: $0 [command] [options]')
  .example('$0 serve', 'Start the HTTP server')
  .example('$0 mcp list', 'List configured MCP servers')
  .example('$0 inspect', 'Discover servers in a running instance')
  .epilogue(
    'Run 1mcp <command> --help for command details.\nRun 1mcp serve --help for all server options (also accepted at root).',
  )
  .command(
    '$0',
    'Start the 1MCP server (default)',
    (command) => command.options(serverOptions).group(Object.keys(serverOptions), 'Server options:'),
    async (argv) => {
      // Default command - redirect to serve command
      configureGlobalLogger(argv as GlobalOptions, argv.transport);
      const { serveCommand } = await import('./commands/serve/serve.js');
      await serveCommand(argv as Parameters<typeof serveCommand>[0]);
    },
  )
  .version(MCP_SERVER_VERSION)
  .env('ONE_MCP') // Enable environment variable parsing with ONE_MCP prefix
  .help()
  .alias('help', 'h')
  .strict() // Enable strict mode to reject unknown commands
  .fail(showCliFailure);

// Register command groups with global options
yargsInstance = setupAdminCommands(yargsInstance);
yargsInstance = setupAppCommands(yargsInstance);
yargsInstance = setupAuthCommands(yargsInstance);
yargsInstance = setupBootstrapCommand(yargsInstance);
yargsInstance = setupCliSetupCommand(yargsInstance);
yargsInstance = setupInstructionsCommand(yargsInstance);
yargsInstance = setupMcpCommands(yargsInstance);
yargsInstance = setupPresetCommands(yargsInstance);
yargsInstance = setupPreparationCommands(yargsInstance);
yargsInstance = setupServeCommand(yargsInstance);
yargsInstance = setupProxyCommand(yargsInstance);
yargsInstance = setupInspectCommand(yargsInstance);
yargsInstance = setupRunCommand(yargsInstance);
yargsInstance = setupWaitCommand(yargsInstance);
yargsInstance = setupRegistryCommands(yargsInstance);
yargsInstance = setupTargetCommands(yargsInstance);

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
    (arg) =>
      arg === 'app' ||
      arg === 'admin' ||
      arg === 'auth' ||
      arg === 'cli-setup' ||
      arg === 'bootstrap' ||
      arg === 'instructions' ||
      arg === 'mcp' ||
      arg === 'preset' ||
      arg === 'prepare' ||
      arg === 'preparation' ||
      arg === 'serve' ||
      arg === 'proxy' ||
      arg === 'inspect' ||
      arg === 'run' ||
      arg === 'wait' ||
      arg === 'target',
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
  checkGlobalOptionConflicts(['node', 'cli', ...normalizedArgv]);

  // Let yargs handle all command processing
  await yargsInstance.parseAsync(normalizedArgv, {}, (error, argv, output) => {
    // A parse callback disables Yargs' automatic async-handler failure reporting.
    if (error) showCliFailure(undefined, error, yargsInstance);
    if (output) console.log(styleHelp(output));
    // Keep help/version terminal: imported runtime modules may own open handles.
    if (argv.help || argv.version) process.exit(0);
  });
}

main().catch((error) => {
  logger.error('runtime.cli-failed', { error });
  process.exit(1);
});
