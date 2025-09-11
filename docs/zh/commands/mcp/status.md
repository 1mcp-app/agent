# mcp status

检查已配置的 MCP 服务器的状态和详细信息。

有关服务器管理的完整概述，请参阅 **[服务器管理指南](../../guide/essentials/server-management)**。

## 摘要

```bash
npx -y @1mcp/agent mcp status [name] [options]
```

## 参数

- **`[name]`**
  - 要检查的特定服务器的名称。如果省略，则检查所有服务器。

## 全局选项

此命令支持所有全局选项：

- **`--config, -c <path>`** - 指定配置文件路径
- **`--config-dir, -d <path>`** - 配置目录路径

## 命令特定选项

- **环境变量 `ONE_MCP_LOG_LEVEL=debug`**
  - 设置 `ONE_MCP_LOG_LEVEL=debug` 以显示详细的配置信息。

## 描述

此命令提供您的 MCP 服务器的快速概览。对于 `stdio` 服务器，它会检查进程是否正在运行。对于 `http` 服务器，它会尝试连接到健康检查端点。

## 示例

```bash
# 检查所有服务器的状态
npx -y @1mcp/agent mcp status

# 检查特定服务器的状态
npx -y @1mcp/agent mcp status my-server

# 获取详细的状态信息
ONE_MCP_LOG_LEVEL=debug npx -y @1mcp/agent mcp status
```

## 另请参阅

- **[服务器管理指南](../../guide/essentials/server-management)**
