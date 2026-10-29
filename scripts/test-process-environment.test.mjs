import { describe, expect, it } from 'vitest';

import { createTestProcessEnvironment, isolatedTestEnvironment } from './test-process-environment.mjs';

describe('test-owned process environment', () => {
  it('enforces suppression and clears owner locators after custom overrides', () => {
    const env = createTestProcessEnvironment({
      ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED: 'false',
      CODEX_THREAD_ID: 'operator',
      ONE_MCP_PROJECT_OWNER: '/operator',
    });
    expect(env.ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED).toBe('true');
    expect(env.CODEX_THREAD_ID).toBe('');
    expect(env.CODEX_SESSION_ID).toBe('');
    expect(env.ONE_MCP_PROJECT_OWNER).toBe('');
  });

  it('isolates the default scope from ambient configuration and remote targets', () => {
    const isolated = isolatedTestEnvironment({
      HOME: '/operator-home',
      USERPROFILE: '/operator-home',
      ONE_MCP_CONFIG_DIR: '/operator',
      ONE_MCP_CONFIG: '/operator/mcp.json',
      ONE_MCP_URL: 'https://operator',
      ONE_MCP_CONTEXT: 'operator',
      ONE_MCP_TEST_BINARY: '/fixture/sea',
    });
    try {
      expect(isolated.env.ONE_MCP_CONFIG_DIR).not.toBe('/operator');
      expect(isolated.env.HOME).not.toBe('/operator-home');
      expect(isolated.env.USERPROFILE).toBe(isolated.env.HOME);
      expect(isolated.env).not.toHaveProperty('ONE_MCP_CONFIG');
      expect(isolated.env).not.toHaveProperty('ONE_MCP_URL');
      expect(isolated.env).not.toHaveProperty('ONE_MCP_CONTEXT');
      expect(isolated.env.ONE_MCP_TEST_BINARY).toBe('/fixture/sea');
      expect(isolated.env.ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED).toBe('true');
    } finally {
      isolated.cleanup();
    }
  });
  it('does not restore ambient targets after a launcher has scrubbed its base', () => {
    const env = createTestProcessEnvironment({}, { PATH: '/fixture/bin' });
    expect(env).not.toHaveProperty('ONE_MCP_CONFIG_DIR');
    expect(env).not.toHaveProperty('ONE_MCP_URL');
    expect(env).not.toHaveProperty('ONE_MCP_CONTEXT');
    expect(env.ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED).toBe('true');
  });
});
