import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pages = [
  {
    path: 'docs/.vitepress/dist/commands/registry/index.html',
    description: 'Reference for the 1MCP registry discovery commands.',
    keywords: '1MCP registry,MCP registry commands,registry search,registry status',
    ogTitle: '1MCP Registry Commands',
    ogDescription: 'Query a configured MCP registry with the 1MCP search, status, show, and versions commands.',
  },
  {
    path: 'docs/.vitepress/dist/guide/advanced/performance.html',
    description: 'Configure bounded stdio backend recovery and use 1MCP operational signals accurately.',
    keywords: '1MCP stdio recovery,restartOnExit,maxRestarts,health checks',
    ogTitle: '1MCP Performance and Recovery',
    ogDescription: 'Configure bounded stdio backend recovery and use 1MCP logs and health routes for operations.',
  },
  {
    path: 'docs/.vitepress/dist/guide/integrations/codex.html',
    description: 'Choose one 1MCP workflow for Codex: CLI mode, direct HTTP, or the stdio proxy.',
    keywords: '1MCP Codex integration,Codex MCP,config.toml,stdio proxy',
    ogTitle: '1MCP Codex Integration',
    ogDescription: 'Choose one 1MCP workflow for Codex: CLI mode, direct HTTP, or the stdio proxy.',
  },
  {
    path: 'docs/.vitepress/dist/zh/guide/integrations/app-consolidation.html',
    description: '将受支持桌面客户端的 MCP 配置整合到 1MCP，并从集中备份中恢复。',
    keywords: '1MCP 应用整合,MCP 配置备份,Claude Desktop,Cursor',
    ogTitle: '1MCP 应用整合指南',
    ogDescription: '通过预览、备份和恢复，将受支持桌面客户端的 MCP 配置整合到 1MCP。',
  },
];

function decodeHtml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function readMeta(html) {
  return [...html.matchAll(/<meta\s+([^>]+)>/g)].map((match) =>
    Object.fromEntries(
      [...match[1].matchAll(/([:\w-]+)="([^"]*)"/g)].map((attribute) => [attribute[1], decodeHtml(attribute[2])]),
    ),
  );
}

function assertSingleMeta(meta, selector, expected, pagePath) {
  const matches = meta.filter((entry) => Object.entries(selector).every(([name, value]) => entry[name] === value));
  assert.equal(matches.length, 1, `${pagePath} must render exactly one ${JSON.stringify(selector)} meta tag`);
  assert.equal(matches[0].content, expected, `${pagePath} must render page-specific metadata`);
}

for (const page of pages) {
  const html = readFileSync(join(root, page.path), 'utf8');
  const meta = readMeta(html);

  assertSingleMeta(meta, { name: 'description' }, page.description, page.path);
  assertSingleMeta(meta, { name: 'keywords' }, page.keywords, page.path);
  assertSingleMeta(meta, { property: 'og:title' }, page.ogTitle, page.path);
  assertSingleMeta(meta, { property: 'og:description' }, page.ogDescription, page.path);
}

console.log(`Validated page-specific SEO metadata in ${pages.length} generated pages.`);
