import { runCliCommand } from '@src/commands/shared/commandRunner.js';
import { getProductCollectionPolicy } from '@src/config/productTelemetryBootstrap.js';
import { withGlobalOptions } from '@src/globalOptions.js';
import { localInstallationStore } from '@src/productTelemetry/index.js';
import { collectionEnabled } from '@src/productTelemetry/policy.js';

import type { Argv } from 'yargs';

export function setupTelemetryCommands(yargs: Argv): Argv {
  return withGlobalOptions(yargs).command(
    'telemetry <action>',
    'Inspect or change local Product Usage Telemetry',
    (command) =>
      command
        .positional('action', {
          choices: ['status', 'enable', 'disable', 'reset'] as const,
          type: 'string',
          demandOption: true,
        })
        .option('json', { type: 'boolean', default: false })
        .option('context', {
          type: 'string',
          describe: 'Accepted for consistency; telemetry controls always affect this OS user locally',
        })
        .option('url', { type: 'string', describe: 'Accepted for consistency; never contacts a remote runtime' }),
    async (argv) =>
      runCliCommand(argv, async () => {
        const store = localInstallationStore();
        const action = argv.action as 'status' | 'enable' | 'disable' | 'reset';
        if (action !== 'status') await store.control(action);
        const status = await store.status();
        const enabled = collectionEnabled({
          ...getProductCollectionPolicy(),
          storedEnabled: status.preference !== 'disabled',
        });
        const result = { ...status, collectionEnabled: enabled };
        if (argv.json) process.stdout.write(`${JSON.stringify(result)}\n`);
        else
          process.stdout.write(
            `Product Usage Telemetry: ${enabled ? 'enabled' : 'disabled'}\nStored preference: ${status.preference}\nLocal identity: ${status.identityPresent ? 'present' : 'absent'}\nQueued summaries: ${status.queuedSummaries}\nCoordination: ${status.coordination}\n`,
          );
      }),
  );
}
