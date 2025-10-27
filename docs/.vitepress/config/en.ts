import { DefaultTheme, defineConfig } from 'vitepress';

export default function createConfig(version: string) {
  return defineConfig({
    lang: 'en-US',
    description:
      '1MCP Agent - The unified Model Context Protocol server that aggregates multiple MCP servers. Simplify AI assistant integration with one secure proxy. Complete documentation and setup guide.',

    head: [
      // SEO Meta Tags (English)
      [
        'meta',
        {
          name: 'keywords',
          content:
            'MCP,Model Context Protocol,AI proxy,AI aggregator,Claude Desktop,Cursor,LLM integration,mcp-server,agent,AI assistant,OAuth 2.1,server management,proxy server,multiplexer,AI tools,automation,documentation,setup guide,tutorial',
        },
      ],

      // Open Graph tags for better social sharing
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:title', content: '1MCP Agent - Unified MCP Server' }],
      [
        'meta',
        {
          property: 'og:description',
          content:
            '1MCP Agent simplifies AI assistant integration with one unified MCP server. Aggregate multiple MCP servers behind a single secure proxy with OAuth 2.1 authentication.',
        },
      ],
      ['meta', { property: 'og:image', content: 'https://docs.1mcp.app/images/logo.png' }],

      // WeChat and international specific tags
      ['meta', { property: 'og:locale', content: 'en_US' }],
      ['meta', { property: 'og:locale:alternate', content: 'zh_CN' }],

      // Twitter Card
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: '1MCP Agent - Unified MCP Server' }],
      [
        'meta',
        {
          name: 'twitter:description',
          content:
            '1MCP Agent - Unified MCP server for AI assistants. Simplify integration with one secure proxy for multiple MCP servers.',
        },
      ],
    ],

    themeConfig: {
      nav: nav(version),

      sidebar: sidebar(),

      footer: {
        message: 'Released under the Apache 2.0 License.',
        copyright: 'Copyright © 2025-present 1MCP',
      },

      editLink: {
        pattern: 'https://github.com/1mcp-app/agent/edit/main/docs/:path',
        text: 'Edit this page on GitHub',
      },
    },
  });
}

function nav(version: string): DefaultTheme.NavItem[] {
  return [
    { text: 'Guide', link: '/guide/getting-started' },
    { text: 'Commands', link: '/commands/' },
    { text: 'Reference', link: '/reference/architecture' },
    {
      text: version,
      items: [
        { text: 'Changelog', link: 'https://github.com/1mcp-app/agent/blob/main/CHANGELOG.md' },
        { text: 'Contributing', link: 'https://github.com/1mcp-app/agent/blob/main/CONTRIBUTING.md' },
      ],
    },
  ];
}

function sidebar(): DefaultTheme.Sidebar {
  return {
    '/guide/': [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/guide/getting-started' },
          { text: 'Quick Start', link: '/guide/quick-start' },
          { text: 'Installation', link: '/guide/installation' },
        ],
      },
      {
        text: 'Essential Concepts',
        items: [
          { text: 'Core Features', link: '/guide/essentials/core-features' },
          { text: 'Configuration', link: '/guide/essentials/configuration' },
          { text: 'Server Management', link: '/guide/essentials/server-management' },
        ],
      },
      {
        text: 'Integrations',
        items: [
          { text: 'Claude Desktop Integration', link: '/guide/integrations/claude-desktop' },
          { text: 'Codex Integration', link: '/guide/integrations/codex' },
          { text: 'App Consolidation', link: '/guide/integrations/app-consolidation' },
          { text: 'Developer Tools', link: '/guide/integrations/developer-tools' },
        ],
      },
      {
        text: 'Advanced Features',
        items: [
          { text: 'Authentication', link: '/guide/advanced/authentication' },
          { text: 'Security', link: '/guide/advanced/security' },
          { text: 'Performance', link: '/guide/advanced/performance' },
          { text: 'Enterprise', link: '/guide/advanced/enterprise' },
          { text: 'Fast Startup', link: '/guide/advanced/fast-startup' },
          { text: 'Reverse Proxy', link: '/guide/advanced/reverse-proxy' },
          { text: 'Server Filtering', link: '/guide/advanced/server-filtering' },
        ],
      },
      {
        text: 'Customization',
        items: [
          { text: 'Instructions Template', link: '/guide/custom-instructions-template' },
          { text: 'Server Instructions Overrides', link: '/guide/server-instructions-overrides' },
        ],
      },
      {
        text: 'Feature Overview',
        items: [{ text: 'All Features', link: '/guide/features' }],
      },
      {
        text: 'Development',
        items: [{ text: 'Development Guide', link: '/guide/development' }],
      },
    ],
    '/commands/': [
      {
        text: 'Overview',
        items: [{ text: 'Command Reference', link: '/commands/' }],
      },
      {
        text: 'Server Management',
        items: [
          { text: 'serve', link: '/commands/serve' },
          { text: 'proxy', link: '/commands/proxy' },
          {
            text: 'mcp',
            link: '/commands/mcp/',
            items: [
              { text: 'add', link: '/commands/mcp/add' },
              { text: 'remove', link: '/commands/mcp/remove' },
              { text: 'update', link: '/commands/mcp/update' },
              { text: 'enable/disable', link: '/commands/mcp/enable-disable' },
              { text: 'list', link: '/commands/mcp/list' },
              { text: 'status', link: '/commands/mcp/status' },
              { text: 'tokens', link: '/commands/mcp/tokens' },
            ],
          },
          {
            text: 'preset',
            link: '/commands/preset/',
            items: [
              { text: 'create', link: '/commands/preset/create' },
              { text: 'edit', link: '/commands/preset/edit' },
              { text: 'list', link: '/commands/preset/list' },
              { text: 'show', link: '/commands/preset/show' },
              { text: 'url', link: '/commands/preset/url' },
              { text: 'test', link: '/commands/preset/test' },
              { text: 'delete', link: '/commands/preset/delete' },
            ],
          },
        ],
      },
      {
        text: 'App Integration',
        items: [
          {
            text: 'app',
            link: '/commands/app/',
            items: [
              { text: 'consolidate', link: '/commands/app/consolidate' },
              { text: 'restore', link: '/commands/app/restore' },
              { text: 'list', link: '/commands/app/list' },
              { text: 'discover', link: '/commands/app/discover' },
              { text: 'status', link: '/commands/app/status' },
              { text: 'backups', link: '/commands/app/backups' },
            ],
          },
        ],
      },
    ],
    '/reference/': [
      {
        text: 'Architecture',
        items: [
          { text: 'System Architecture', link: '/reference/architecture' },
          { text: 'Security Model', link: '/reference/security' },
          { text: 'Feature Comparison', link: '/reference/feature-comparison' },
        ],
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Health Check API', link: '/reference/health-check' },
          { text: 'Pagination', link: '/reference/pagination' },
        ],
      },
      {
        text: 'Configuration',
        items: [
          { text: 'MCP Servers', link: '/reference/mcp-servers' },
          { text: 'Trust Proxy', link: '/reference/trust-proxy' },
        ],
      },
      {
        text: 'Instructions Templates',
        items: [
          { text: 'Variables', link: '/reference/instructions-template/variables' },
          { text: 'Examples', link: '/reference/instructions-template/examples' },
        ],
      },
    ],
  };
}
