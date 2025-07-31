# MCP Commands

Manage MCP server configurations within your 1MCP instance.

These commands allow you to add, remove, update, and manage the lifecycle of the MCP servers that 1MCP will proxy.

For a detailed guide on server management, including transport types and best practices, please see the **[Server Management Guide](../../guide/server-management.md)**.

## Commands

### [add](./add.md)

Add a new MCP server to the configuration.

```bash
1mcp mcp add my-server --type=stdio --command="node server.js"
```

### [remove](./remove.md)

Remove an MCP server from the configuration.

```bash
1mcp mcp remove my-server
```

### [update](./update.md)

Update an existing MCP server's configuration.

```bash
1mcp mcp update my-server --tags=prod
```

### [enable](./enable.md) / [disable](./disable.md)

Enable or disable an MCP server without removing it.

```bash
1mcp mcp disable my-server
```

### [list](./list.md)

List all configured MCP servers.

```bash
1mcp mcp list --tags=prod
```

### [status](./status.md)

Check the status and details of configured servers.

```bash
1mcp mcp status my-server
```

## See Also

- **[Server Management Guide](../../guide/server-management.md)**
- **[App Consolidation Guide](../../guide/app-consolidation.md)**
