import type { GlobalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

import { selectSetupExample, setupKnownServer } from './knownServerSetup.js';
import { initializeConfigContext } from './utils/mcpServerConfig.js';

export interface SetupCommandArgs extends GlobalOptions {
  known?: string;
  executable?: string;
  checkout?: string;
  name?: string;
  force?: boolean;
  dryRun?: boolean;
  interactive?: boolean;
}

export function buildSetupCommand(yargs: Argv) {
  return yargs
    .option('known', {
      describe: 'Maintained example: codegraph, code-review-graph, or serena',
      type: 'string',
    })
    .option('executable', {
      describe: 'Installed backend executable path (otherwise discover on PATH)',
      type: 'string',
    })
    .option('checkout', {
      describe: 'Explicit checkout for a static target (default: reusable checkout-bound template)',
      type: 'string',
    })
    .option('name', {
      describe: 'Local target name (default: example ID)',
      type: 'string',
    })
    .option('force', {
      describe: 'Explicitly reconfigure an existing target',
      type: 'boolean',
      default: false,
    })
    .option('dry-run', {
      describe: 'Preview configuration without saving changes',
      type: 'boolean',
      default: false,
    })
    .option('interactive', {
      describe: 'Prompt for missing prerequisites and confirm configuration',
      type: 'boolean',
      default: false,
      alias: 'i',
    })
    .strict()
    .example([
      ['$0 mcp setup', 'Choose an installed backend to configure'],
      ['$0 mcp setup --known codegraph', 'Configure a reusable checkout-bound template'],
      ['$0 mcp setup --known serena --checkout /absolute/project', 'Configure a static target'],
      ['$0 mcp setup --known codegraph --dry-run', 'Preview configuration without saving'],
    ]);
}

export async function setupCommand(argv: SetupCommandArgs): Promise<void> {
  initializeConfigContext(argv.config, argv['config-dir']);
  if (argv.known !== undefined) {
    await setupKnownServer(argv);
    return;
  }
  const known = await selectSetupExample();
  if (known === undefined) return;
  await setupKnownServer({ ...argv, known, interactive: true });
}
