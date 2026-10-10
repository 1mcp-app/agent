import path from 'node:path';

import type { Argv } from 'yargs';
import { z } from 'zod';

const absolutePath = z.string().min(1).refine(path.isAbsolute, 'An absolute path is required');
export const codeGraphReadonlyOptionsSchema = z.object({
  executable: absolutePath,
  path: absolutePath,
  expectedVersion: z.literal('1.6.2').default('1.6.2'),
});

/** This is an explicitly configured stdio backend, launched by the existing runtime lifecycle owner. */
export async function codegraphReadonlyCommand(
  argv: unknown,
  ports: {
    serve?: (options: { executable: string; checkoutPath: string; expectedVersion: '1.6.2' }) => Promise<void>;
  } = {},
): Promise<void> {
  const options = codeGraphReadonlyOptionsSchema.parse(argv);
  const serve =
    ports.serve ?? (await import('@src/domains/backend-preparation/codegraphReadOnly.js')).runCodeGraphReadOnlyServer;
  await serve({ executable: options.executable, checkoutPath: options.path, expectedVersion: options.expectedVersion });
}

export function setupCodegraphReadonlyCommand(yargs: Argv): Argv {
  return yargs.command(
    'codegraph-readonly',
    'Serve a pinned installed CodeGraph index over stdio without indexing or watching',
    (command) =>
      command
        .env(false)
        .option('executable', {
          type: 'string',
          demandOption: true,
          describe: 'Absolute installed CodeGraph executable (1.6.2)',
        })
        .option('path', { type: 'string', demandOption: true, describe: 'Absolute Project Checkout path' })
        .option('expected-version', {
          type: 'string',
          choices: ['1.6.2'],
          default: '1.6.2',
          describe: 'Required installed native version',
        }),
    async (argv) => {
      try {
        await codegraphReadonlyCommand(argv);
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'CodeGraph read-only startup failed'}\n`);
        process.exitCode = 1;
      }
    },
  );
}
