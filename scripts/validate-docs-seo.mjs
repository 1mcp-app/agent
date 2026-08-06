import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const restoredPages = [
  {
    path: 'docs/.vitepress/dist/commands/registry/index.html',
    description: 'Reference for the 1MCP registry discovery commands.',
    keywords: '1MCP registry,MCP registry commands,registry search,registry status',
    ogTitle: '1MCP Registry Commands',
    ogDescription: 'Query a configured MCP registry with the 1MCP search, status, show, and versions commands.',
  },
  {
    path: 'docs/.vitepress/dist/commands/registry/search.html',
    description: 'Search entries in the configured MCP registry.',
    keywords: '1MCP registry search,MCP server discovery,registry filters,registry pagination',
    ogTitle: '1MCP registry search',
    ogDescription: 'Search a configured MCP registry by text, status, package type, or transport with the 1MCP CLI.',
  },
  {
    path: 'docs/.vitepress/dist/guide/advanced/performance.html',
    description: 'Configure bounded stdio backend recovery and use 1MCP operational signals accurately.',
    keywords: '1MCP stdio recovery,restartOnExit,maxRestarts,health checks',
    ogTitle: '1MCP Performance and Recovery',
    ogDescription: 'Configure bounded stdio backend recovery and use 1MCP logs and health routes for operations.',
  },
  {
    path: 'docs/.vitepress/dist/guide/integrations/app-consolidation.html',
    description:
      'Consolidate supported application MCP configurations into 1MCP and restore them from centralized backups.',
    keywords: '1MCP app consolidation,MCP configuration backup,Claude Desktop,Cursor',
    ogTitle: '1MCP App Consolidation Guide',
    ogDescription:
      'Consolidate supported application MCP configurations into 1MCP with dry runs, backups, and restoration.',
  },
  {
    path: 'docs/.vitepress/dist/guide/integrations/codex.html',
    description: 'Choose one 1MCP workflow for Codex: CLI mode, direct HTTP, or the stdio proxy.',
    keywords: '1MCP Codex integration,Codex MCP,config.toml,stdio proxy',
    ogTitle: '1MCP Codex Integration',
    ogDescription: 'Choose one 1MCP workflow for Codex: CLI mode, direct HTTP, or the stdio proxy.',
  },
  {
    path: 'docs/.vitepress/dist/reference/internal-tools.html',
    description: 'The Internal Tools reference moved to its canonical route.',
    keywords: '1MCP internal tools,MCP management tools,internal tools reference',
    ogTitle: '1MCP Internal Tools Reference',
    ogDescription: 'Continue to the canonical 1MCP Internal Tools reference for programmatic MCP server management.',
  },
  {
    path: 'docs/.vitepress/dist/reference/internal-tools/index.html',
    description: 'MCP protocol reference for 1MCP internal management tools.',
    keywords: '1MCP internal tools,MCP management tools,tools call,server management',
    ogTitle: '1MCP Internal Tools',
    ogDescription: 'MCP protocol reference for optional 1MCP discovery, installation, and management tools.',
  },
  {
    path: 'docs/.vitepress/dist/reference/internal-tools/installation.html',
    description: 'Input and output lookup for the internal MCP installation tools.',
    keywords: '1MCP installation tools,mcp_install,mcp_uninstall,mcp_update,MCP tool schema',
    ogTitle: '1MCP Internal Installation Tools',
    ogDescription: 'Input and output reference for the 1MCP mcp_install, mcp_uninstall, and mcp_update tools.',
  },
  {
    path: 'docs/.vitepress/dist/zh/commands/registry/index.html',
    description: '1MCP 注册表发现命令参考。',
    keywords: '1MCP 注册表,MCP 注册表命令,注册表搜索,注册表状态',
    ogTitle: '1MCP 注册表命令',
    ogDescription: '使用 1MCP 的 search、status、show 和 versions 命令查询已配置的 MCP 注册表。',
  },
  {
    path: 'docs/.vitepress/dist/zh/commands/registry/search.html',
    description: '在已配置的 MCP 注册表中搜索条目。',
    keywords: '1MCP 注册表搜索,MCP 服务器发现,注册表筛选,注册表分页',
    ogTitle: '1MCP registry search',
    ogDescription: '使用 1MCP CLI 按文本、状态、包类型或传输方式搜索已配置的 MCP 注册表。',
  },
  {
    path: 'docs/.vitepress/dist/zh/guide/advanced/performance.html',
    description: '准确配置有界 stdio 后端恢复并使用 1MCP 运维信号。',
    keywords: '1MCP stdio 恢复,restartOnExit,maxRestarts,健康检查',
    ogTitle: '1MCP 性能与恢复',
    ogDescription: '配置有界 stdio 后端恢复，并使用 1MCP 日志和健康检查路由进行运维。',
  },
  {
    path: 'docs/.vitepress/dist/zh/guide/integrations/app-consolidation.html',
    description: '将受支持应用的 MCP 配置整合到 1MCP，并从集中备份中恢复。',
    keywords: '1MCP 应用整合,MCP 配置备份,Claude Desktop,Cursor',
    ogTitle: '1MCP 应用整合指南',
    ogDescription: '通过预览、备份和恢复，将受支持应用的 MCP 配置整合到 1MCP。',
  },
  {
    path: 'docs/.vitepress/dist/zh/reference/internal-tools.html',
    description: '内部工具参考已迁移至规范路由。',
    keywords: '1MCP 内部工具,MCP 管理工具,内部工具参考',
    ogTitle: '1MCP 内部工具参考',
    ogDescription: '前往规范的 1MCP 内部工具参考，了解如何通过程序管理 MCP 服务器。',
  },
  {
    path: 'docs/.vitepress/dist/zh/reference/internal-tools/index.html',
    description: '1MCP 内部管理工具的 MCP 协议参考。',
    keywords: '1MCP 内部工具,MCP 管理工具,tools call,服务器管理',
    ogTitle: '1MCP 内部工具',
    ogDescription: '1MCP 可选发现、安装和管理工具的 MCP 协议参考。',
  },
  {
    path: 'docs/.vitepress/dist/zh/reference/internal-tools/installation.html',
    description: '内部 MCP 安装工具的输入和输出查询参考。',
    keywords: '1MCP 安装工具,mcp_install,mcp_uninstall,mcp_update,MCP 工具 schema',
    ogTitle: '1MCP 内部安装工具',
    ogDescription: '1MCP mcp_install、mcp_uninstall 和 mcp_update 工具的输入与输出参考。',
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

function readElements(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\s+([^>]+)>`, 'g'))].map((match) =>
    Object.fromEntries(
      [...match[1].matchAll(/([:\w-]+)="([^"]*)"/g)].map((attribute) => [attribute[1], decodeHtml(attribute[2])]),
    ),
  );
}

function select(entries, selector) {
  return entries.filter((entry) => Object.entries(selector).every(([name, value]) => entry[name] === value));
}

function assertSingleMeta(meta, selector, expected, pagePath) {
  const matches = select(meta, selector);
  assert.equal(matches.length, 1, `${pagePath} must render exactly one ${JSON.stringify(selector)} meta tag`);
  assert.equal(matches[0].content, expected, `${pagePath} must render the expected metadata`);
}

function htmlFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    return entry.isDirectory() ? htmlFiles(entryPath) : entry.name.endsWith('.html') ? [entryPath] : [];
  });
}

assert.equal(restoredPages.length, 15, 'the restored SEO manifest must cover all 15 historical pages');
for (const page of restoredPages) {
  const html = readFileSync(join(root, page.path), 'utf8');
  const meta = readElements(html, 'meta');

  assertSingleMeta(meta, { name: 'description' }, page.description, page.path);
  assertSingleMeta(meta, { name: 'keywords' }, page.keywords, page.path);
  assertSingleMeta(meta, { property: 'og:title' }, page.ogTitle, page.path);
  assertSingleMeta(meta, { property: 'og:description' }, page.ogDescription, page.path);
}

const dist = join(root, 'docs/.vitepress/dist');
const generatedPages = htmlFiles(dist);
for (const path of generatedPages) {
  const html = readFileSync(path, 'utf8');
  const meta = readElements(html, 'meta');
  const links = readElements(html, 'link');
  const pagePath = relative(dist, path).replaceAll('\\', '/');
  const route = pagePath === 'index.html' ? '' : `/${pagePath.slice(0, -'.html'.length)}`;
  const expectedUrl = `https://docs.1mcp.app${route}`;
  const isChinese = pagePath.startsWith('zh/');

  for (const selector of [
    { name: 'description' },
    { property: 'og:title' },
    { property: 'og:description' },
    { name: 'twitter:title' },
    { name: 'twitter:description' },
  ]) {
    const matches = select(meta, selector);
    assert.equal(matches.length, 1, `${pagePath} must render exactly one ${JSON.stringify(selector)} meta tag`);
    assert.ok(matches[0].content, `${pagePath} ${JSON.stringify(selector)} must not be empty`);
  }

  assertSingleMeta(meta, { property: 'og:url' }, expectedUrl, pagePath);
  assertSingleMeta(meta, { property: 'og:locale' }, isChinese ? 'zh_CN' : 'en_US', pagePath);
  assertSingleMeta(meta, { property: 'og:locale:alternate' }, isChinese ? 'en_US' : 'zh_CN', pagePath);

  const canonical = select(links, { rel: 'canonical' });
  assert.equal(canonical.length, 1, `${pagePath} must render exactly one canonical link`);
  assert.equal(canonical[0].href, expectedUrl, `${pagePath} canonical must match its public route`);
}

console.log(`Validated page-specific SEO metadata in ${restoredPages.length} restored pages.`);
console.log(`Validated canonical and social metadata in ${generatedPages.length} generated pages.`);
