import { runCliCommand } from '@src/commands/shared/commandRunner.js';
import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

export function setupRunCommand(yargs: Argv): Argv {
  return yargs.command(
    'run <tool>',
    'Run an MCP tool against a running 1MCP serve instance',
    (commandYargs) =>
      commandYargs
        .options(globalOptions || {})
        .positional('tool', {
          describe: 'Tool reference in the format <server>/<tool>',
          type: 'string',
        })
        .option('url', {
          alias: 'u',
          describe: 'Override auto-detected 1MCP server URL',
          type: 'string',
        })
        .option('preset', {
          alias: 'p',
          describe: 'Use a preset when calling the running 1MCP server',
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
        .option('args', {
          describe: 'Tool arguments as a JSON object',
          type: 'string',
        })
        .option('format', {
          describe: 'Output format',
          type: 'string',
          choices: ['toon', 'json', 'text', 'compact'],
        })
        .option('raw', {
          describe: 'Alias for --format json',
          type: 'boolean',
          default: false,
        })
        .option('max-chars', {
          describe: 'Maximum characters for compact output',
          type: 'number',
          default: 2000,
        })
        .example([
          ['$0 run filesystem/read_file --args \'{"path":"./foo.txt"}\'', 'Call a tool with explicit JSON arguments'],
          ['$0 run summarizer/summarize < README.md', 'Pipe raw stdin into the first required string argument'],
          [
            '$0 run --preset development validator/validate --args \'{"path":"./schema.json"}\'',
            'Call through a preset',
          ],
        ])
        .epilogue(
          'This command requires a running `1mcp serve` instance. For pipe-friendly usage, stdout is reserved for tool output and errors are sent to stderr.',
        ),
    async (argv) => {
      const { runCommand } = await import('./run.js');
      await runCliCommand(argv as Parameters<typeof runCommand>[0], runCommand);
    },
  );
}
