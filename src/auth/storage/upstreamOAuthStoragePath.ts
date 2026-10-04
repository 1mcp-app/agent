import path from 'node:path';

/** Preserve the upstream layout historically derived from the server session base. */
export function resolveUpstreamOAuthStorageBaseDir(serverSessionStoragePath?: string): string | undefined {
  if (!serverSessionStoragePath) return undefined;
  return path.join(path.dirname(serverSessionStoragePath), 'clientSessions');
}
