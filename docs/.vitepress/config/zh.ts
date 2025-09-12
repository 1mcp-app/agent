import { defineConfig, type DefaultTheme } from 'vitepress';

export default function createConfig(version: string) {
  return defineConfig({
    lang: 'zh-CN',
    description: '聚合一切的 MCP 服务器——统一的 Model Context Protocol 服务器实现',

    themeConfig: {
      nav: nav(version),

      sidebar: sidebar(),

      editLink: {
        pattern: 'https://github.com/1mcp-app/agent/edit/main/docs/:path',
        text: '在 GitHub 上编辑此页面',
      },

      footer: {
        message: '基于 Apache 2.0 许可发布',
        copyright: '版权所有 © 2025-present 1MCP',
      },

      docFooter: {
        prev: '上一页',
        next: '下一页',
      },

      outline: {
        label: '页面导航',
      },

      lastUpdated: {
        text: '最后更新于',
        formatOptions: {
          dateStyle: 'short',
          timeStyle: 'medium',
        },
      },

      langMenuLabel: '多语言',
      returnToTopLabel: '回到顶部',
      sidebarMenuLabel: '菜单',
      darkModeSwitchLabel: '主题',
      lightModeSwitchTitle: '切换到浅色模式',
      darkModeSwitchTitle: '切换到深色模式',
      skipToContentLabel: '跳转到内容',
    },
  });
}

function nav(version: string): DefaultTheme.NavItem[] {
  return [
    { text: '指南', link: '/zh/guide/getting-started' },
    { text: '命令', link: '/zh/commands/' },
    { text: '参考', link: '/zh/reference/architecture' },
    {
      text: version,
      items: [
        { text: '更新日志', link: 'https://github.com/1mcp-app/agent/blob/main/CHANGELOG.md' },
        { text: '贡献指南', link: 'https://github.com/1mcp-app/agent/blob/main/CONTRIBUTING.md' },
      ],
    },
  ];
}

function sidebar(): DefaultTheme.Sidebar {
  return {
    '/zh/guide/': [
      {
        text: '快速开始',
        items: [
          { text: '简介', link: '/zh/guide/getting-started' },
          { text: '快速上手', link: '/zh/guide/quick-start' },
          { text: '安装', link: '/zh/guide/installation' },
        ],
      },
      {
        text: '核心概念',
        items: [
          { text: '架构', link: '/zh/reference/architecture' },
          { text: '配置', link: '/zh/guide/essentials/configuration' },
          { text: '身份验证', link: '/zh/guide/advanced/authentication' },
        ],
      },
      {
        text: '集成',
        items: [{ text: 'Claude Desktop 集成', link: '/zh/guide/integrations/claude-desktop' }],
      },
      {
        text: '功能',
        items: [
          { text: '功能概览', link: '/zh/guide/features' },
          { text: '核心功能', link: '/zh/guide/essentials/core-features' },
          { text: '安全与访问控制', link: '/zh/guide/advanced/security' },
          { text: '性能与可靠性', link: '/zh/guide/advanced/performance' },
          { text: '企业与运维', link: '/zh/guide/advanced/enterprise' },
          { text: '开发者与集成', link: '/zh/guide/integrations/developer-tools' },
          { text: '快速启动', link: '/zh/guide/advanced/fast-startup' },
          { text: '分页支持', link: '/zh/reference/pagination' },
          { text: '服务器过滤', link: '/zh/guide/advanced/server-filtering' },
          { text: '代理支持', link: '/zh/guide/advanced/reverse-proxy' },
          { text: '服务器管理', link: '/zh/guide/essentials/server-management' },
          { text: '应用程序整合', link: '/zh/guide/integrations/app-consolidation' },
        ],
      },
    ],
    '/zh/commands/': [
      {
        text: '概览',
        items: [{ text: '命令参考', link: '/zh/commands/' }],
      },
      {
        text: '服务器管理',
        items: [
          { text: 'serve', link: '/zh/commands/serve' },
          {
            text: 'mcp',
            link: '/zh/commands/mcp/',
            items: [
              { text: 'add', link: '/zh/commands/mcp/add' },
              { text: 'remove', link: '/zh/commands/mcp/remove' },
              { text: 'update', link: '/zh/commands/mcp/update' },
              { text: 'enable/disable', link: '/zh/commands/mcp/enable-disable' },
              { text: 'list', link: '/zh/commands/mcp/list' },
              { text: 'status', link: '/zh/commands/mcp/status' },
            ],
          },
          {
            text: 'preset',
            link: '/zh/commands/preset/',
            items: [
              { text: 'create', link: '/zh/commands/preset/create' },
              { text: 'edit', link: '/zh/commands/preset/edit' },
              { text: 'list', link: '/zh/commands/preset/list' },
              { text: 'show', link: '/zh/commands/preset/show' },
              { text: 'url', link: '/zh/commands/preset/url' },
              { text: 'test', link: '/zh/commands/preset/test' },
              { text: 'delete', link: '/zh/commands/preset/delete' },
            ],
          },
        ],
      },
      {
        text: '应用集成',
        items: [
          {
            text: 'app',
            link: '/zh/commands/app/',
            items: [
              { text: 'consolidate', link: '/zh/commands/app/consolidate' },
              { text: 'restore', link: '/zh/commands/app/restore' },
              { text: 'list', link: '/zh/commands/app/list' },
              { text: 'discover', link: '/zh/commands/app/discover' },
              { text: 'status', link: '/zh/commands/app/status' },
              { text: 'backups', link: '/zh/commands/app/backups' },
            ],
          },
        ],
      },
    ],
    '/zh/reference/': [
      {
        text: '架构',
        items: [
          { text: '系统架构', link: '/zh/reference/architecture' },
          { text: '安全模型', link: '/zh/reference/security' },
          { text: '功能对比', link: '/zh/reference/feature-comparison' },
        ],
      },
      {
        text: 'API 参考',
        items: [{ text: '健康检查 API', link: '/zh/reference/health-check' }],
      },
      {
        text: '配置',
        items: [{ text: '可信代理', link: '/zh/reference/trust-proxy' }],
      },
    ],
  };
}

export const search: DefaultTheme.AlgoliaSearchOptions['locales'] = {
  zh: {
    placeholder: '搜索文档',
    translations: {
      button: {
        buttonText: '搜索文档',
        buttonAriaLabel: '搜索文档',
      },
      modal: {
        searchBox: {
          resetButtonTitle: '清除查询条件',
          resetButtonAriaLabel: '清除查询条件',
          cancelButtonText: '取消',
          cancelButtonAriaLabel: '取消',
        },
        startScreen: {
          recentSearchesTitle: '搜索历史',
          noRecentSearchesText: '没有搜索历史',
          saveRecentSearchButtonTitle: '保存至搜索历史',
          removeRecentSearchButtonTitle: '从搜索历史中移除',
          favoriteSearchesTitle: '收藏',
          removeFavoriteSearchButtonTitle: '从收藏中移除',
        },
        errorScreen: {
          titleText: '无法获取结果',
          helpText: '你可能需要检查你的网络连接',
        },
        footer: {
          selectText: '选择',
          navigateText: '切换',
          closeText: '关闭',
          searchByText: '搜索提供者',
        },
        noResultsScreen: {
          noResultsText: '无法找到相关结果',
          suggestedQueryText: '你可以尝试查询',
          reportMissingResultsText: '你认为该查询应该有结果？',
          reportMissingResultsLinkText: '点击反馈',
        },
      },
    },
  },
};
