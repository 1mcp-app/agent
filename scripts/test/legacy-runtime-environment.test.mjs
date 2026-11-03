import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestProcessEnvironment } from '../test-process-environment.mjs';
import { createLegacyRuntimeEnvironment } from './legacy-runtime-environment.mjs';

const directories = [];
function fixture(version = '0.38.0') {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'legacy-environment-'));
  directories.push(directory);
  mkdirSync(path.join(directory, 'build'));
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: '@1mcp/agent', version }));
  return path.join(directory, 'build/index.js');
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('pinned pre-producer legacy runtime environment', () => {
  it('removes strict-parser-unknown options and ambient locators while selecting only the fixture scope', () => {
    const env = createLegacyRuntimeEnvironment(fixture(), '/fixture/scope', {
      PATH: '/fixture/bin',
      HOME: '/fixture/home',
      ONE_MCP_CONFIG_DIR: '/operator',
      ONE_MCP_URL: 'https://operator',
      ONE_MCP_PROJECT_OWNER: '/operator/owner',
      ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED: 'true',
      CODEX_SESSION_ID: 'operator',
      CODEX_THREAD_ID: 'operator',
    });
    expect(Object.keys(env).filter((key) => key.startsWith('ONE_MCP_'))).toEqual(['ONE_MCP_CONFIG_DIR']);
    expect(env.ONE_MCP_CONFIG_DIR).toBe('/fixture/scope');
    expect(env).not.toHaveProperty('CODEX_SESSION_ID');
    expect(env).not.toHaveProperty('CODEX_THREAD_ID');
    expect(env.HOME).toBe('/fixture/home');
    expect(createTestProcessEnvironment({}, env).ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED).toBe('true');
  });
  it.each(['0.38.1', '0.39.2'])('refuses the exemption for an unverified version %s', (version) => {
    expect(() => createLegacyRuntimeEnvironment(fixture(version), '/fixture/scope', {})).toThrow(
      'pinned @1mcp/agent@0.38.0',
    );
  });
});
