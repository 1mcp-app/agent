import { runCliCommand } from '@src/commands/shared/commandRunner.js';
import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

export function setupInspectCommand(yargs: Argv): Argv {
  return yargs.command(
    'inspect [target]',
    'Inspect servers or tools from a running 1MCP serve instance',
    (commandYargs) =>
      commandYargs
        .options(globalOptions || {})
        .positional('target', {
          describe: 'Inspect target: <server>, <server>/<tool>, or omit to list all servers',
          type: 'string',
        })
        .option('url', {
          alias: 'u',
          describe: 'Override auto-detected 1MCP server URL',
          type: 'string',
        })
        .option('preset', {
          alias: 'p',
          describe: 'Use a preset when querying the running 1MCP server',
          type: 'string',
        })
        .option('tag-filter', {
          alias: 'f',
          describe: 'Apply an advanced tag filter expression',
          type: 'string',
        })
        .option('tags', {
          describe: 'Apply simple comma-separated tags',
          type: 'array',
          string: true,
        })
        .option('format', {
          describe: 'Output format',
          type: 'string',
          choices: ['toon', 'text', 'json'],
        })
        .option('all', {
          describe: 'Fetch all tools without pagination (server target only)',
          type: 'boolean',
          default: false,
        })
        .option('limit', {
          describe: 'Page size for tool listing (server target only)',
          type: 'number',
          default: 20,
        })
        .option('cursor', {
          describe: 'Pagination cursor from a previous response',
          type: 'string',
        })
        .example('$0 inspect', 'List all servers exposed by the running 1MCP instance')
        .example('$0 inspect filesystem', 'List the exposed tools for a server')
        .example('$0 inspect filesystem/read_file', 'Show a readable summary of a tool schema')
        .example('$0 inspect filesystem --format json', 'Output normalized server tool list JSON for scripting')
        .example('$0 inspect filesystem --format text', 'Human-readable chalk output')
        .example('$0 inspect filesystem --all', 'List all tools without pagination')
        .epilogue('This command requires a running `1mcp serve` instance. Errors are written to stderr only.'),
    async (argv) => {
      const { inspectCommand } = await import('./inspect.js');
      await runCliCommand(argv as Parameters<typeof inspectCommand>[0], inspectCommand);
    },
  );
}
