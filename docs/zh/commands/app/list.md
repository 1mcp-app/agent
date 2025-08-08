# app list

列出应用程序整合功能支持的所有桌面应用程序。

有关应用程序及其状态的完整列表，请参阅 **[应用程序整合指南](../../guide/app-consolidation#supported-applications)**。

## 摘要

```bash
npx -y @1mcp/agent app list [options]
```

## 选项

- **`--configurable-only`**
  - 仅显示支持自动整合的应用程序。

- **`--manual-only`**
  - 仅显示需要手动设置的应用程序。

## 示例

```bash
# 列出所有支持的应用程序
npx -y @1mcp/agent app list

# 仅列出可以自动配置的应用程序
npx -y @1mcp/agent app list --configurable-only
```

## 另请参阅

- **[应用程序整合指南](../../guide/app-consolidation)**
