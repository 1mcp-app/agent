import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('admin cloud deployment docs', () => {
  it('documents the blessed Caddy deployment path and links it from the docs navigation', () => {
    const enGuide = readRepoFile('docs/en/guide/advanced/cloud-deployment.md');
    const zhGuide = readRepoFile('docs/zh/guide/advanced/cloud-deployment.md');
    const enConfig = readRepoFile('docs/.vitepress/config/en.ts');
    const zhConfig = readRepoFile('docs/.vitepress/config/zh.ts');
    const enReverseProxy = readRepoFile('docs/en/guide/advanced/reverse-proxy.md');
    const zhReverseProxy = readRepoFile('docs/zh/guide/advanced/reverse-proxy.md');
    const enGettingStarted = readRepoFile('docs/en/guide/getting-started.md');
    const zhGettingStarted = readRepoFile('docs/zh/guide/getting-started.md');
    const enServe = readRepoFile('docs/en/commands/serve.md');
    const zhServe = readRepoFile('docs/zh/commands/serve.md');
    const enRuntimeConfig = readRepoFile('docs/en/guide/essentials/configuration.md');
    const zhRuntimeConfig = readRepoFile('docs/zh/guide/essentials/configuration.md');
    const enTrustProxy = readRepoFile('docs/en/reference/trust-proxy.md');
    const zhTrustProxy = readRepoFile('docs/zh/reference/trust-proxy.md');

    expect(enGuide).toContain('Caddy');
    expect(enGuide).toContain('reverse_proxy 127.0.0.1:3050');
    expect(enGuide).toContain('public traffic reaches 1MCP through HTTPS');
    expect(enGuide).toContain('1mcp serve does not terminate TLS');
    expect(enGuide).toContain('config.toml');
    expect(enGuide).toContain('[admin]');
    expect(enGuide).toContain('enabled = true');
    expect(enGuide).toContain('externalUrl');
    expect(enGuide).toContain('trustProxy');
    expect(enGuide).toContain('Secure');
    expect(enGuide).toContain('127.0.0.1');
    expect(enGuide).toContain('ONE_MCP_ADMIN_USERNAME');
    expect(enGuide).toContain('ONE_MCP_ADMIN_PASSWORD');
    expect(enGuide).toContain('1mcp admin bootstrap');
    expect(enGuide).toContain('Admin Session');
    expect(enGuide).toContain('OAuth');
    expect(enGuide).toContain('1mcp target add prod');
    expect(enGuide).toContain('1mcp target verify prod');
    expect(enGuide).toContain('TLS trust');

    expect(zhGuide).toContain('Caddy');
    expect(zhGuide).toContain('reverse_proxy 127.0.0.1:3050');
    expect(zhGuide).toContain('HTTPS');
    expect(zhGuide).toContain('1mcp serve 不在第一版设计中终止 TLS');
    expect(zhGuide).toContain('config.toml');
    expect(zhGuide).toContain('[admin]');
    expect(zhGuide).toContain('enabled = true');
    expect(zhGuide).toContain('externalUrl');
    expect(zhGuide).toContain('trustProxy');
    expect(zhGuide).toContain('Secure');
    expect(zhGuide).toContain('ONE_MCP_ADMIN_USERNAME');
    expect(zhGuide).toContain('ONE_MCP_ADMIN_PASSWORD');
    expect(zhGuide).toContain('1mcp admin bootstrap');
    expect(zhGuide).toContain('Admin Session');
    expect(zhGuide).toContain('OAuth');
    expect(zhGuide).toContain('1mcp target add prod');
    expect(zhGuide).toContain('1mcp target verify prod');

    expect(enConfig).toContain("{ text: 'Cloud Deployment', link: '/guide/advanced/cloud-deployment' }");
    expect(zhConfig).toContain("{ text: '云端部署', link: '/zh/guide/advanced/cloud-deployment' }");
    expect(enReverseProxy).toContain('/guide/advanced/cloud-deployment');
    expect(zhReverseProxy).toContain('/zh/guide/advanced/cloud-deployment');
    expect(enGettingStarted).toContain('/guide/advanced/cloud-deployment');
    expect(zhGettingStarted).toContain('/zh/guide/advanced/cloud-deployment');
    expect(enServe).toContain('/guide/advanced/cloud-deployment');
    expect(zhServe).toContain('/zh/guide/advanced/cloud-deployment');
    expect(enRuntimeConfig).toContain('/guide/advanced/cloud-deployment');
    expect(zhRuntimeConfig).toContain('/zh/guide/advanced/cloud-deployment');
    expect(enTrustProxy).toContain('/guide/advanced/cloud-deployment');
    expect(zhTrustProxy).toContain('/zh/guide/advanced/cloud-deployment');
  });
});
