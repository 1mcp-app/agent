---
title: MCP 命令
description: 浏览用于添加、维护和检查 1MCP 后端服务器的命令。
---

# MCP 命令

在您的 1MCP 实例中管理 MCP 服务器配置。

这些命令允许您添加、删除、更新和管理 1MCP 将代理的 MCP 服务器的生命周期。

有关服务器管理的详细指南，包括传输类型和最佳实践，请参阅 **[服务器管理指南](/zh/guide/essentials/server-management)**。

## 配置已安装的后端

### [setup](/zh/commands/mcp/setup)

使用项目维护的示例配置 CodeGraph、Code Review Graph 或 Serena：

```bash
1mcp mcp setup --known codegraph
```

## 注册表命令

### [install](/zh/commands/mcp/install)

从注册表元数据生成后端配置。使用交互模式选择服务器：

```bash
1mcp mcp install --interactive
```

### [uninstall](/zh/commands/mcp/uninstall)

移除服务器配置，默认在写入前创建备份：

```bash
1mcp mcp uninstall filesystem
```

### [search](/zh/commands/mcp/search)

搜索注册表中的服务器：

```bash
1mcp mcp search database
```

## 手动配置命令

### [add](/zh/commands/mcp/add)

向配置中添加一个新的 MCP 服务器。

```bash
1mcp mcp add my-server --type=stdio -- node server.js
```

### [remove](/zh/commands/mcp/remove)

从配置中删除一个 MCP 服务器。

```bash
1mcp mcp remove my-server
```

### [update](/zh/commands/mcp/update)

更新现有 MCP 服务器的配置。

```bash
1mcp mcp update my-server --tags=prod
```

### [enable / disable](/zh/commands/mcp/enable-disable)

启用或禁用 MCP 服务器而不删除它。

```bash
1mcp mcp disable my-server
```

### [list](/zh/commands/mcp/list)

列出所有已配置的 MCP 服务器。

```bash
1mcp mcp list --tags=prod
```

### [status](/zh/commands/mcp/status)

检查已配置服务器的状态和详细信息。

```bash
1mcp mcp status my-server
```

### [tokens](/zh/commands/mcp/tokens)

通过连接到服务器并分析其工具、资源和提示来估算 MCP 词元用量。

```bash
1mcp mcp tokens --model=gpt-3.5-turbo --format=summary
```

### [tools](/zh/commands/mcp/tools)

列出、禁用和重新启用某个已配置服务器上的单个工具，而不禁用整个服务器。

```bash
1mcp mcp tools list filesystem --disabled
1mcp mcp tools disable filesystem write_file
```

## 运行时操作

### [restart](/zh/commands/mcp/restart)

在已启动的聚合运行时中重启静态后端，或重启模板后端的一个或多个活动实例。

```bash
1mcp mcp restart my-server
```

## 另请参阅

- [注册表命令](/zh/commands/registry/) - 发现服务器

- **[服务器管理指南](/zh/guide/essentials/server-management)**
- **[应用程序整合指南](/zh/guide/integrations/app-consolidation)**
