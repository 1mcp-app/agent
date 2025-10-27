import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

import enConfig from './en';
import zhConfig from './zh';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf-8'));
const version = `v${packageJson.version}`;

export default withMermaid(
  defineConfig({
    title: '1MCP Agent',

    lastUpdated: true,
    cleanUrls: true,
    metaChunk: true,

    rewrites: {
      'en/:rest*': ':rest*',
    },

    locales: {
      root: { label: 'English', ...enConfig(version) },
      zh: { label: '简体中文', ...zhConfig(version) },
    },

    head: [
      // Favicon and theme
      ['link', { rel: 'icon', href: '/images/logo.png', type: 'image/png' }],
      ['link', { rel: 'apple-touch-icon', href: '/images/logo.png', sizes: '180x180' }],
      ['link', { rel: 'icon', href: '/images/logo.png', sizes: '32x32', type: 'image/png' }],
      ['link', { rel: 'icon', href: '/images/logo.png', sizes: '16x16', type: 'image/png' }],
      ['meta', { name: 'theme-color', content: '#3eaf7c' }],
      ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
      ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black' }],

      // SEO Meta Tags
      [
        'meta',
        {
          name: 'description',
          content:
            '1MCP Agent - One unified Model Context Protocol server that aggregates multiple MCP servers for Claude Desktop, Cursor, and other AI assistants.',
        },
      ],
      [
        'meta',
        {
          name: 'keywords',
          content:
            'MCP,Model Context Protocol,AI proxy,AI aggregator,Claude Desktop,LLM integration,mcp-server,agent,ai assistant',
        },
      ],
      ['meta', { name: 'author', content: '1MCP Team' }],

      // Open Graph / Facebook
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:title', content: '1MCP Agent - Unified MCP Server' }],
      [
        'meta',
        {
          property: 'og:description',
          content: 'One unified Model Context Protocol server that aggregates multiple MCP servers for AI assistants.',
        },
      ],
      ['meta', { property: 'og:image', content: 'https://docs.1mcp.app/images/logo.png' }],
      ['meta', { property: 'og:url', content: 'https://docs.1mcp.app/' }],
      ['meta', { property: 'og:site_name', content: '1MCP Agent Docs' }],

      // Twitter Card
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: '1MCP Agent - Unified MCP Server' }],
      [
        'meta',
        {
          name: 'twitter:description',
          content: 'One unified Model Context Protocol server that aggregates multiple MCP servers.',
        },
      ],
      ['meta', { name: 'twitter:image', content: 'https://docs.1mcp.app/images/logo.png' }],

      // Canonical and alternate languages will be added dynamically per page

      // Structured Data - JSON-LD
      [
        'script',
        { type: 'application/ld+json' },
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: '1MCP Agent',
          description:
            'Unified Model Context Protocol server that aggregates multiple MCP servers for Claude Desktop, Cursor, and other AI assistants.',
          applicationCategory: 'DeveloperApplication',
          operatingSystem: ['Linux', 'macOS', 'Windows'],
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
          },
          url: 'https://docs.1mcp.app',
          author: {
            '@type': 'Organization',
            name: '1MCP',
            url: 'https://github.com/1mcp-app',
          },
          datePublished: '2024-01-01',
          inLanguage: ['en', 'zh'],
          keywords:
            'MCP,Model Context Protocol,AI proxy,AI aggregator,Claude Desktop,Cursor,LLM integration,mcp-server,agent,AI assistant',
          license: 'Apache-2.0',
          downloadUrl: 'https://www.npmjs.com/package/@1mcp/agent',
          screenshot: 'https://docs.1mcp.app/images/logo.png',
        }),
      ],

      // Google Analytics
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

      socialLinks: [{ icon: 'github', link: 'https://github.com/1mcp-app/agent' }],

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
      './../README',
      './../CONTRIBUTING',
    ],

    // Transform hook to add canonical URLs dynamically
    transformHead: ({ pageData }) => {
      const currentPath = pageData.relativePath.replace(/\.md$/, '');
      const isZh = pageData.frontmatter?.lang === 'zh' || currentPath.startsWith('zh/');
      const canonicalPath = isZh ? currentPath : currentPath.replace(/^en\//, '');
      const url = `https://docs.1mcp.app${canonicalPath === 'index' ? '' : `/${canonicalPath}`}`;

      const head: Array<[string, Record<string, string>]> = [];

      // Add canonical link
      head.push(['link', { rel: 'canonical', href: url }]);

      // Add alternate language links
      if (isZh) {
        const enPath = currentPath.replace(/^zh\//, '');
        head.push([
          'link',
          { rel: 'alternate', hreflang: 'en', href: `https://docs.1mcp.app${enPath === 'index' ? '' : `/${enPath}`}` },
        ]);
      } else {
        head.push([
          'link',
          {
            rel: 'alternate',
            hreflang: 'zh',
            href: `https://docs.1mcp.app/zh${currentPath === 'index' ? '' : `/${currentPath}`}`,
          },
        ]);
      }

      return head;
    },

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
