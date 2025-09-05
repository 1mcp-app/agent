# MCP 命令

在您的 1MCP 实例中管理 MCP 服务器配置。

这些命令允许您添加、删除、更新和管理 1MCP 将代理的 MCP 服务器的生命周期。

有关服务器管理的详细指南，包括传输类型和最佳实践，请参阅 **[服务器管理指南](../../guide/essentials/server-management)**。

## 命令

### [add](./add)

向配置中添加一个新的 MCP 服务器。

```bash
npx -y @1mcp/agent mcp add my-server --type=stdio --command="node server.js"
```

### [remove](./remove)

从配置中删除一个 MCP 服务器。

```bash
npx -y @1mcp/agent mcp remove my-server
```

### [update](./update)

更新现有 MCP 服务器的配置。

```bash
npx -y @1mcp/agent mcp update my-server --tags=prod
```

### [enable / disable](./enable-disable)

启用或禁用 MCP 服务器而不删除它。

```bash
npx -y @1mcp/agent mcp disable my-server
```

### [list](./list)

列出所有已配置的 MCP 服务器。

```bash
npx -y @1mcp/agent mcp list --tags=prod
```

### [status](./status)

检查已配置服务器的状态和详细信息。

```bash
npx -y @1mcp/agent mcp status my-server
```

### [tokens](./tokens)

通过连接到服务器并分析其工具、资源和提示来估算 MCP 令牌使用量。

```bash
npx -y @1mcp/agent mcp tokens --model=gpt-3.5-turbo --format=summary
```

## 另请参阅

- **[服务器管理指南](../../guide/essentials/server-management)**
- **[应用程序整合指南](../../guide/integrations/app-consolidation)**
