import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BACKUP_DIR_NAME, getAppBackupDir, getGlobalBackupDir, getGlobalConfigDir } from '@src/constants/paths.js';
import { applicationConfigSchema, mcpServerConfigSchema } from '@src/core/types/transport.js';

import { parse as parseToml } from 'smol-toml';

const root = process.cwd();

function readDoc(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function extractCodeBlock(page: string, language: string, requiredContent: string): string {
  const openingDelimiter = `\`\`\`${language}\n`;
  const closingDelimiter = '\n```';
  let start = 0;

  while (start < page.length) {
    const openingIndex = page.indexOf(openingDelimiter, start);
    if (openingIndex === -1) {
      break;
    }

    const contentStart = openingIndex + openingDelimiter.length;
    const closingIndex = page.indexOf(closingDelimiter, contentStart);
    if (closingIndex === -1) {
      break;
    }

    const block = page.slice(contentStart, closingIndex);
    if (block.includes(requiredContent)) {
      return block;
    }

    start = closingIndex + closingDelimiter.length;
  }

  throw new Error(`Missing ${language} example containing ${requiredContent}`);
}

describe('configuration and operations documentation', () => {
  it('keeps configuration schemas, recovery, and integration modes aligned', () => {
    const enConfiguration = readDoc('docs/en/guide/essentials/configuration.md');
    const zhConfiguration = readDoc('docs/zh/guide/essentials/configuration.md');
    const enReference = readDoc('docs/en/reference/mcp-servers.md');
    const zhReference = readDoc('docs/zh/reference/mcp-servers.md');
    const enAuth = readDoc('docs/en/guide/advanced/authentication.md');
    const zhAuth = readDoc('docs/zh/guide/advanced/authentication.md');
    const enPerformance = readDoc('docs/en/guide/advanced/performance.md');
    const zhPerformance = readDoc('docs/zh/guide/advanced/performance.md');
    const enFastStartup = readDoc('docs/en/guide/advanced/fast-startup.md');
    const zhFastStartup = readDoc('docs/zh/guide/advanced/fast-startup.md');
    const enApps = readDoc('docs/en/guide/integrations/app-consolidation.md');
    const zhApps = readDoc('docs/zh/guide/integrations/app-consolidation.md');
    const enCodex = readDoc('docs/en/guide/integrations/codex.md');
    const zhCodex = readDoc('docs/zh/guide/integrations/codex.md');
    const enServerManagement = readDoc('docs/en/guide/essentials/server-management.md');
    const zhServerManagement = readDoc('docs/zh/guide/essentials/server-management.md');
    const enSecurity = readDoc('docs/en/guide/advanced/security.md');
    const zhSecurity = readDoc('docs/zh/guide/advanced/security.md');
    const enReverseProxy = readDoc('docs/en/guide/advanced/reverse-proxy.md');
    const zhReverseProxy = readDoc('docs/zh/guide/advanced/reverse-proxy.md');
    const enTemplates = readDoc('docs/en/guide/mcp-server-templates.md');
    const zhTemplates = readDoc('docs/zh/guide/mcp-server-templates.md');

    for (const page of [enConfiguration, zhConfiguration]) {
      const inventory = mcpServerConfigSchema.parse(JSON.parse(extractCodeBlock(page, 'json', '"mcpServers"')));
      const runtime = applicationConfigSchema.parse(parseToml(extractCodeBlock(page, 'toml', '[asyncLoading]')));

      expect(inventory.mcpServers.filesystem).toMatchObject({ type: 'stdio' });
      expect(inventory.mcpServers['remote-api']).toMatchObject({ type: 'http', disabled: false });
      expect(runtime.auth).toMatchObject({ enabled: true });
      expect(runtime.asyncLoading).toMatchObject({
        enabled: true,
        batchNotifications: true,
        batchDelay: 250,
      });
    }

    for (const page of [enReference, zhReference]) {
      expect(page).toContain('`type`');
      expect(page).toContain('`disabled`');
      expect(page).not.toContain('"transport":');
      expect(page).not.toContain('`enabled` (');
    }

    expect(enAuth).toContain('MCP');
    expect(enAuth).toContain('Admin');
    expect(enAuth).toContain('health routes');
    expect(zhAuth).toContain('MCP');
    expect(zhAuth).toContain('Admin');
    expect(zhAuth).toContain('健康检查路由');

    for (const page of [enPerformance, zhPerformance]) {
      expect(page).toContain('restartOnExit');
      expect(page).toContain('maxRestarts');
      expect(page).not.toContain('Circuit Breaker');
      expect(page).not.toContain('Load Balancing');
      expect(page).not.toContain('Connection Pooling');
      expect(page).not.toContain('99.9%');
    }

    for (const page of [enFastStartup, zhFastStartup]) {
      expect(page).toContain('[asyncLoading]');
      expect(page).toContain('batchDelay = 250');
      expect(page).not.toContain('loading` section of your JSON');
      expect(page).not.toContain('loading` 部分');
    }

    for (const page of [enApps, zhApps]) {
      expect(page).toContain('APP_PRESETS');
      expect(page).toContain('gemini-code');
      expect(page).toContain('augment-code');
      expect(page).toContain('<global-config-dir>/backups/<app-name>/');
      expect(page).not.toContain('backups/apps/');
      expect(page).toContain('Copilot');
    }
    const appName = 'claude-desktop';
    expect(getGlobalBackupDir()).toBe(`${getGlobalConfigDir()}/${BACKUP_DIR_NAME}`);
    expect(getAppBackupDir(appName)).toBe(`${getGlobalBackupDir()}/${appName}`);
    expect(getAppBackupDir(appName)).not.toContain('/apps/');
    expect(enApps).toContain('not an `APP_PRESETS` target');
    expect(zhApps).toContain('不是 `APP_PRESETS` 目标');
    expect(enApps).toContain('supported application MCP configurations');
    expect(enApps).not.toContain('supported desktop MCP configurations');
    expect(zhApps).toContain('受支持应用的 MCP 配置');
    expect(zhApps).not.toContain('受支持桌面客户端的 MCP 配置');
    expect(enApps).toContain('%APPDATA%\\1mcp\\backups\\<app-name>\\');
    expect(zhApps).toContain('%APPDATA%\\1mcp\\backups\\<app-name>\\');
    expect(enApps).not.toContain('%APPDATA%\\\\1mcp\\\\backups\\\\<app-name>\\\\');
    expect(zhApps).not.toContain('%APPDATA%\\\\1mcp\\\\backups\\\\<app-name>\\\\');

    for (const page of [enCodex, zhCodex]) {
      expect(page).toContain('`.codex/config.toml`');
      expect(page).toContain('[mcp_servers.1mcp]');
      expect(page).toContain('http://localhost:3050/mcp');
      expect(page).toContain('CLI');
      expect(page).toContain('proxy');
      expect(page).not.toContain('3051');
      expect(page).not.toContain('0.44.0');
      expect(page).not.toContain('(no auth)');
    }

    for (const page of [enServerManagement, zhServerManagement]) {
      expect(page).toContain('registry search filesystem --type=npm --transport=stdio');
      expect(page).toContain('mcp install --interactive');
      expect(page).not.toContain('registry search --category');
      expect(page).not.toContain('registry search --updates');
      expect(page).not.toContain('mcp wizard');
    }

    for (const page of [enConfiguration, zhConfiguration]) {
      expect(page).toContain('[asyncLoading.backgroundRetry]');
      expect(page).toContain('[admin.rateLimit.login]');
      expect(page).toContain('[health.rateLimit]');
      expect(page).toContain('[admin.audit]');
      expect(page).toContain('[templateSettings.pool]');
      expect(page).toContain('maxTotalInstances = 100');
      expect(page).toContain('ONE_MCP_ASYNC_MAX_CONCURRENT_LOADS');
    }
    for (const page of [enSecurity, zhSecurity]) {
      expect(page).toContain('state_unknown');
      expect(page).toContain('24');
      expect(page).toContain('30');
    }
    expect(enReverseProxy).toContain('req.ip');
    expect(enReverseProxy).toContain('process-local');
    expect(zhReverseProxy).toContain('req.ip');
    expect(zhReverseProxy).toContain('进程内');
    for (const page of [enTemplates, zhTemplates]) {
      expect(page).toContain('[templateSettings.pool]');
      expect(page).toContain('maxInstancesPerTemplate');
      expect(page).toContain('maxTotalInstances');
    }
  });
});
