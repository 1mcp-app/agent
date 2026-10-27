import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Only the pinned pre-producer fixture may omit the current suppression option. */
export function createLegacyRuntimeEnvironment(legacyCli, runtimeScope, base) {
  const metadata = JSON.parse(readFileSync(path.resolve(path.dirname(legacyCli), '../package.json'), 'utf8'));
  if (metadata.name !== '@1mcp/agent' || metadata.version !== '0.38.0') {
    throw new Error('Legacy environment requires the pinned @1mcp/agent@0.38.0 fixture');
  }
  const clean = Object.fromEntries(
    Object.entries(base).filter(([key, value]) => {
      if (value === undefined) return false;
      if (key.startsWith('ONE_MCP_')) return false;
      return key !== 'CODEX_SESSION_ID' && key !== 'CODEX_THREAD_ID';
    }),
  );
  return { ...clean, ONE_MCP_CONFIG_DIR: runtimeScope };
}
