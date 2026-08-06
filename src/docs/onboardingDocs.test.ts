import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const nodeContract = '^20.19.0 || ^22.12.0 || >=24.0.0';

function readRepoFile(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('onboarding documentation', () => {
  it('keeps the first-run installation, runtime, OAuth, and Codex contracts aligned', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as { engines?: { node?: string } };
    const enGettingStarted = readRepoFile('docs/en/guide/getting-started.md');
    const zhGettingStarted = readRepoFile('docs/zh/guide/getting-started.md');
    const enQuickStart = readRepoFile('docs/en/guide/quick-start.md');
    const zhQuickStart = readRepoFile('docs/zh/guide/quick-start.md');
    const enInstallation = readRepoFile('docs/en/guide/installation.md');
    const zhInstallation = readRepoFile('docs/zh/guide/installation.md');
    const enCodex = readRepoFile('docs/en/guide/integrations/codex.md');
    const zhCodex = readRepoFile('docs/zh/guide/integrations/codex.md');
    const enDevelopment = readRepoFile('docs/en/guide/development.md');
    const zhDevelopment = readRepoFile('docs/zh/guide/development.md');
    const enHome = readRepoFile('docs/en/index.md');
    const zhHome = readRepoFile('docs/zh/index.md');

    expect(packageJson.engines?.node).toBe(nodeContract);

    for (const page of [
      enGettingStarted,
      zhGettingStarted,
      enQuickStart,
      zhQuickStart,
      enInstallation,
      zhInstallation,
      enDevelopment,
      zhDevelopment,
    ]) {
      expect(page).toContain(nodeContract);
    }

    for (const page of [enGettingStarted, zhGettingStarted]) {
      expect(page).toContain('1mcp-linux-x64.tar.gz');
      expect(page).toContain('1mcp-darwin-arm64.tar.gz');
      expect(page).toContain('1mcp-win32-x64.zip');
      expect(page).toContain('tar -xzf');
      expect(page).toContain('Expand-Archive');
      expect(page).not.toContain('client_credentials');
      expect(page).toContain('PKCE');
    }

    for (const page of [enInstallation, zhInstallation]) {
      expect(page).toContain('ONE_MCP_CONFIG=/usr/src/app/mcp.json');
      expect(page).toContain('/usr/src/app/mcp.json:ro');
    }

    for (const page of [enQuickStart, enCodex, enHome]) {
      expect(page).toContain('config.toml');
      expect(page).toContain('does not');
    }

    for (const page of [zhQuickStart, zhCodex, zhHome]) {
      expect(page).toContain('config.toml');
      expect(page).toContain('不会');
    }

    expect(enCodex).toContain("trusted project's `.codex/config.toml`");
    expect(enCodex).toContain('[mcp_servers.1mcp]');
    expect(enCodex).toContain('Choose exactly one agent-facing 1MCP mode');
    expect(enCodex).not.toContain('0.44.0');
    expect(enCodex).not.toContain('HTTP transport support is experimental');
    expect(enCodex).not.toContain('No per-project configuration');

    expect(zhCodex).toContain('受信任项目的 `.codex/config.toml`');
    expect(zhCodex).toContain('[mcp_servers.1mcp]');
    expect(zhCodex).toContain('每个 Codex 项目只能选择一种面向 agent 的 1MCP 模式');
    expect(zhCodex).not.toContain('0.44.0');
    expect(zhCodex).not.toContain('HTTP 传输支持是实验性的');
    expect(zhCodex).not.toContain('无项目特定配置');

    for (const page of [enDevelopment, zhDevelopment]) {
      expect(page).toContain('ONE_MCP_CONFIG=./mcp.json');
      expect(page).toContain('serve --transport stdio --filter filesystem');
      expect(page).not.toContain('--tag-filter filesystem');
    }

    expect(enHome).toContain('<a href="/commands/proxy" class="vp-feature-box">');
    expect(zhHome).toContain('<a href="/zh/commands/proxy" class="vp-feature-box">');
  });
});
