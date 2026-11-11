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

function playwrightEnvironmentValue(base, name) {
  return base[name] ?? base[`npm_config_${name.toLowerCase()}`] ?? base[`npm_package_config_${name.toLowerCase()}`];
}

/** Preserve the installed cache, using the pinned Playwright resolver's path rules. */
export function getTestBrowserCachePath(base, platform = process.platform, cwd = process.cwd()) {
  const configured = playwrightEnvironmentValue(base, 'PLAYWRIGHT_BROWSERS_PATH');
  if (configured === '0') return '0';
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const originalCwd = playwrightEnvironmentValue(base, 'INIT_CWD') || cwd;
  if (configured) return paths.resolve(originalCwd, configured);

  const home = (platform === 'win32' ? base.USERPROFILE : base.HOME) || os.homedir();
  let cache;
  if (platform === 'linux') cache = base.XDG_CACHE_HOME || paths.join(home, '.cache');
  else if (platform === 'darwin') cache = paths.join(home, 'Library', 'Caches');
  else if (platform === 'win32') cache = base.LOCALAPPDATA || paths.join(home, 'AppData', 'Local');
  else throw new Error(`Unsupported Playwright platform: ${platform}`);
  return paths.resolve(originalCwd, cache, 'ms-playwright');
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
      {
        ONE_MCP_CONFIG_DIR: directory,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        PLAYWRIGHT_BROWSERS_PATH: getTestBrowserCachePath(base),
      },
      clean,
    ),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
