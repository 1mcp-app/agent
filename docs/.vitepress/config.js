import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(
  defineConfig({
    title: '1MCP Agent',
    description: 'One MCP server to aggregate them all - A unified Model Context Protocol server implementation',
    lang: 'en-US',

    head: [
      ['link', { rel: 'icon', href: '/favicon.ico' }],
      ['meta', { name: 'theme-color', content: '#3eaf7c' }],
      ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
      ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black' }],
      ['script', { async: '', src: 'https://www.googletagmanager.com/gtag/js?id=G-46LFKQ768B' }],
      [
        'script',
        {},
        `window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-46LFKQ768B');`,
      ],
    ],

    // Vite configuration for proper dependency handling
    vite: {
      optimizeDeps: {
        include: ['mermaid', '@braintree/sanitize-url', 'dayjs', 'debug', 'cytoscape', 'cytoscape-cose-bilkent'],
      },
    },

    themeConfig: {
      logo: '/images/logo.png',

      nav: [
        { text: 'Guide', link: '/guide/getting-started' },
        { text: 'Commands', link: '/commands/' },
        { text: 'Reference', link: '/reference/architecture' },
        {
          text: 'v0.15.0',
          items: [
            { text: 'Changelog', link: 'https://github.com/1mcp-app/agent/blob/main/CHANGELOG.md' },
            { text: 'Contributing', link: 'https://github.com/1mcp-app/agent/blob/main/CONTRIBUTING.md' },
          ],
        },
      ],

      sidebar: {
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
            text: 'Core Concepts',
            items: [
              { text: 'Architecture', link: '/reference/architecture' },
              { text: 'Configuration', link: '/guide/configuration' },
              { text: 'Authentication', link: '/guide/authentication' },
            ],
          },
          {
            text: 'Features',
            items: [
              { text: 'Feature Overview', link: '/guide/features' },
              { text: 'Server Filtering', link: '/guide/server-filtering' },
              { text: 'Proxy Support', link: '/guide/proxy-support' },
              { text: 'Server Management', link: '/guide/server-management' },
              { text: 'App Consolidation', link: '/guide/app-consolidation' },
            ],
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
              {
                text: 'mcp',
                link: '/commands/mcp/',
                items: [
                  { text: 'add', link: '/commands/mcp/add' },
                  { text: 'remove', link: '/commands/mcp/remove' },
                  { text: 'update', link: '/commands/mcp/update' },
                  { text: 'enable/disable', link: '/commands/mcp/enable' },
                  { text: 'list', link: '/commands/mcp/list' },
                  { text: 'status', link: '/commands/mcp/status' },
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
            items: [{ text: 'Health Check API', link: '/reference/health-check' }],
          },
          {
            text: 'Configuration',
            items: [{ text: 'Trust Proxy', link: '/reference/trust-proxy' }],
          },
        ],
      },

      socialLinks: [{ icon: 'github', link: 'https://github.com/1mcp-app/agent' }],

      footer: {
        message: 'Released under the Apache 2.0 License.',
        copyright: 'Copyright © 2025-present 1MCP',
      },

      editLink: {
        pattern: 'https://github.com/1mcp-app/agent/edit/main/docs/:path',
        text: 'Edit this page on GitHub',
      },

      lastUpdated: {
        text: 'Updated at',
        formatOptions: {
          dateStyle: 'full',
          timeStyle: 'medium',
        },
      },

      search: {
        provider: 'local',
      },

      outline: {
        level: [2, 3],
      },
    },

    markdown: {
      theme: {
        light: 'github-light',
        dark: 'github-dark',
      },
      lineNumbers: true,
    },

    sitemap: {
      hostname: 'https://docs.1mcp.app/',
    },

    ignoreDeadLinks: [
      // Ignore localhost and relative links that don't exist yet
      /^https?:\/\/localhost/,
      /^http?:\/\/localhost/,
      /^\.\/[A-Z]/, // Relative links to uppercase files
      /^\.\.\/[A-Z]/, // Parent dir links to uppercase files
      './features/model-routing',
      './../README',
      './../CONTRIBUTING',
    ],

    // Mermaid configuration
    mermaid: {
      theme: 'base',
      themeVariables: {
        primaryColor: '#3eaf7c',
        primaryTextColor: '#213547',
        primaryBorderColor: '#3eaf7c',
        lineColor: '#484c55',
        sectionBkColor: '#f6f8fa',
        altSectionBkColor: '#ffffff',
        gridColor: '#e1e4e8',
        secondaryColor: '#f6f8fa',
        tertiaryColor: '#ffffff',
      },
    },
  }),
);
