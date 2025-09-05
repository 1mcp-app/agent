# MCP Commands

Manage MCP server configurations within your 1MCP instance.

These commands allow you to add, remove, update, and manage the lifecycle of the MCP servers that 1MCP will proxy.

For a detailed guide on server management, including transport types and best practices, please see the **[Server Management Guide](../../guide/essentials/server-management)**.

## Commands

### [add](./add)

Add a new MCP server to the configuration.

```bash
npx -y @1mcp/agent mcp add my-server --type=stdio --command="node server.js"
```

### [remove](./remove)

Remove an MCP server from the configuration.

```bash
npx -y @1mcp/agent mcp remove my-server
```

### [update](./update)

Update an existing MCP server's configuration.

```bash
npx -y @1mcp/agent mcp update my-server --tags=prod
```

### [enable / disable](./enable-disable)

Enable or disable an MCP server without removing it.

```bash
npx -y @1mcp/agent mcp disable my-server
```

### [list](./list)

List all configured MCP servers.

```bash
npx -y @1mcp/agent mcp list --tags=prod
```

### [status](./status)

Check the status and details of configured servers.

```bash
npx -y @1mcp/agent mcp status my-server
```

### [tokens](./tokens)

Estimate MCP token usage for server capabilities by connecting to servers and analyzing their tools, resources, and prompts.

```bash
npx -y @1mcp/agent mcp tokens --model=gpt-3.5-turbo --format=summary
```

## See Also

- **[Server Management Guide](../../guide/essentials/server-management)**
- **[App Consolidation Guide](../../guide/integrations/app-consolidation)**
