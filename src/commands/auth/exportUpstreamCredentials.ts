import path from 'node:path';

import { UpstreamOAuthStorage } from '@src/auth/storage/upstreamOAuthStorage.js';
import { resolveUpstreamOAuthStorageBaseDir } from '@src/auth/storage/upstreamOAuthStoragePath.js';
import { resolveServeConfigPaths } from '@src/commands/serve/runtimeScope.js';
import { getRuntimeStatusReport } from '@src/commands/serve/serveStatus.js';
import { claimRuntimeScope } from '@src/core/server/runtimeScopeOwnership.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import prompts from 'prompts';

export interface ExportUpstreamCredentialsOptions extends GlobalOptions {
  'session-storage-path'?: string;
  'confirm-plaintext-export'?: boolean;
}

/** Explicit local reverse migration; runtime ownership fences startup during export. */
export async function exportUpstreamCredentialsCommand(options: ExportUpstreamCredentialsOptions): Promise<void> {
  const { runtimeScope } = resolveServeConfigPaths(options);
  const serverBaseDir =
    options['session-storage-path'] ??
    (options.config || options['config-dir'] ? path.join(runtimeScope, 'sessions') : undefined);
  const baseDir = resolveUpstreamOAuthStorageBaseDir(serverBaseDir) ?? runtimeScope;
  const destination = path.resolve(baseDir, 'sessions', 'client');
  process.stdout.write(`Plaintext upstream OAuth destination: ${destination}\n`);

  if (!options['confirm-plaintext-export']) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('Plaintext export requires --confirm-plaintext-export in noninteractive use');
    }
    const response = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: 'Export upstream OAuth secrets to these plaintext files?',
      initial: false,
    });
    if (response.confirmed !== true) {
      process.stdout.write('Export cancelled.\n');
      return;
    }
  }

  const report = await getRuntimeStatusReport(runtimeScope);
  if (report.status !== 'not-running') {
    throw new Error(
      'Stop the selected Runtime Scope before exporting upstream credentials; unresolved runtime state blocks export',
    );
  }
  const ownership = claimRuntimeScope(runtimeScope, { kind: 'foreground-stdio' });
  let storage: UpstreamOAuthStorage | undefined;
  try {
    storage = new UpstreamOAuthStorage({ baseDir, mode: 'native', runtimeScope });
    const result = await storage.exportToFile();
    process.stdout.write(
      `Exported ${result.records} upstream OAuth record(s). Restart with credentialStore = "file".\n`,
    );
  } finally {
    storage?.shutdown();
    ownership.release();
  }
}
