import path from 'node:path';

import { InboundOAuthStorage } from '@src/auth/storage/inboundOAuthStorage.js';
import { UpstreamOAuthStorage } from '@src/auth/storage/upstreamOAuthStorage.js';
import { resolveUpstreamOAuthStorageBaseDir } from '@src/auth/storage/upstreamOAuthStoragePath.js';
import { resolveServeConfigPaths } from '@src/commands/serve/runtimeScope.js';
import { getRuntimeStatusReport } from '@src/commands/serve/serveStatus.js';
import { claimRuntimeScope } from '@src/core/server/runtimeScopeOwnership.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import prompts from 'prompts';

export interface ExportOAuthCredentialsOptions extends GlobalOptions {
  'session-storage-path'?: string;
  'confirm-plaintext-export'?: boolean;
}

export async function exportOAuthCredentialsCommand(options: ExportOAuthCredentialsOptions): Promise<void> {
  await exportOAuthCredentialDomains(options, ['inbound', 'upstream']);
}

/** Explicit local reverse migration; runtime ownership fences startup during export. */
export async function exportOAuthCredentialDomains(
  options: ExportOAuthCredentialsOptions,
  domains: readonly ('inbound' | 'upstream')[],
): Promise<void> {
  const { runtimeScope } = resolveServeConfigPaths(options);
  const serverBaseDir =
    options['session-storage-path'] ??
    (options.config || options['config-dir'] ? path.join(runtimeScope, 'sessions') : undefined);
  const baseDir = resolveUpstreamOAuthStorageBaseDir(serverBaseDir) ?? runtimeScope;
  const destination = path.resolve(baseDir, 'sessions', 'client');
  const legacyDestination = path.resolve(baseDir, 'clientSessions');
  const inboundBaseDir = serverBaseDir ?? runtimeScope;
  const inboundDestination = path.resolve(inboundBaseDir, 'sessions', 'server');
  const inboundLegacyDestination = path.resolve(inboundBaseDir, 'sessions');
  for (const domain of domains) {
    if (domain === 'inbound') {
      process.stdout.write(`Plaintext inbound OAuth destination: ${inboundDestination}\n`);
      process.stdout.write(`Legacy inbound records (if any) are restored to: ${inboundLegacyDestination}\n`);
      continue;
    }
    process.stdout.write(`Plaintext upstream OAuth destination: ${destination}\n`);
    process.stdout.write(`Legacy-layout records (if any) are restored to: ${legacyDestination}\n`);
  }

  if (!options['confirm-plaintext-export']) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('Plaintext export requires --confirm-plaintext-export in noninteractive use');
    }
    const response = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: `Export ${domains.join(' and ')} OAuth secrets to these plaintext files?`,
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
      'Stop the selected Runtime Scope before exporting OAuth credentials; unresolved runtime state blocks export',
    );
  }
  const ownership = claimRuntimeScope(runtimeScope, { kind: 'foreground-stdio' });
  try {
    for (const domain of domains) {
      const storage =
        domain === 'inbound'
          ? new InboundOAuthStorage({ baseDir: inboundBaseDir, mode: 'native', runtimeScope })
          : new UpstreamOAuthStorage({ baseDir, mode: 'native', runtimeScope });
      try {
        const result = await storage.exportToFile();
        process.stdout.write(`Exported ${result.records} ${domain} OAuth record(s).\n`);
      } finally {
        storage.shutdown();
      }
    }
    process.stdout.write('Restart with credentialStore = "file".\n');
  } finally {
    ownership.release();
  }
}
