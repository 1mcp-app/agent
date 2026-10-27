import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Apply last, including after custom overrides and ONE_MCP_* cleanup. */
export function createTestProcessEnvironment(overrides = {}, base = process.env) {
  return Object.fromEntries(
    Object.entries({
      ...base,
      ...overrides,
      ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED: 'true',
      ONE_MCP_PROJECT_OWNER: '',
      CODEX_SESSION_ID: '',
      CODEX_THREAD_ID: '',
    }).filter(([, value]) => value !== undefined),
  );
}

/** A default scope for bespoke launches that do not select their own fixture scope. */
export function isolatedTestEnvironment(base = process.env) {
  const directory = mkdtempSync(path.join(os.tmpdir(), '1mcp-test-scope-'));
  const home = path.join(directory, 'home');
  mkdirSync(home);
  writeFileSync(path.join(directory, 'mcp.json'), '{"mcpServers":{}}\n', { mode: 0o600 });
  const clean = Object.fromEntries(Object.entries(base).filter(([key]) => !key.startsWith('ONE_MCP_')));
  if (base.ONE_MCP_TEST_BINARY) clean.ONE_MCP_TEST_BINARY = base.ONE_MCP_TEST_BINARY;
  return {
    env: createTestProcessEnvironment(
      { ONE_MCP_CONFIG_DIR: directory, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') },
      clean,
    ),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
