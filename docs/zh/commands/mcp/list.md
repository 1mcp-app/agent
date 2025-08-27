# mcp list

列出所有已配置的 MCP 服务器。

有关服务器管理的完整概述，请参阅 **[服务器管理指南](../../guide/essentials/server-management)**。

## 摘要

```bash
npx -y @1mcp/agent mcp list [options]
```

## 选项

- **`--tags <tags>`**
  - 将列表筛选为仅显示具有指定逗号分隔标签的服务器。

- **`--show-disabled`**
  - 在列表中包括禁用的服务器。

- **`--show-secrets`**
  - 显示敏感信息，如命令参数、URL 和环境变量。默认情况下，敏感数据会被隐藏以确保安全。

- **`--verbose`**
  - 显示详细信息，包括请求头和环境变量。

## 示例

```bash
# 列出所有启用的服务器
npx -y @1mcp/agent mcp list

# 列出所有服务器，包括禁用的服务器
npx -y @1mcp/agent mcp list --show-disabled

# 列出所有带有"prod"标签的服务器
npx -y @1mcp/agent mcp list --tags=prod

# 显示所有服务器的详细信息（详细模式）
npx -y @1mcp/agent mcp list --verbose

# 显示包括敏感数据在内的详细信息
npx -y @1mcp/agent mcp list --verbose --show-secrets
```

## 另请参阅

- **[服务器管理指南](../../guide/essentials/server-management)**
