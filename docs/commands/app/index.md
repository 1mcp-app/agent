# App Commands

The `app` command group helps you consolidate MCP server configurations from various desktop applications into a unified 1MCP proxy.

For a complete overview of the consolidation workflow, supported applications, and best practices, please see the **[App Consolidation Guide](../../guide/app-consolidation.md)**.

## Commands

### [consolidate](./consolidate.md)

Consolidates MCP servers from desktop applications into 1MCP.

```bash
1mcp app consolidate claude-desktop cursor vscode
```

### [restore](./restore.md)

Restores desktop applications to their pre-consolidation state.

```bash
1mcp app restore claude-desktop
```

### [list](./list.md)

Lists supported desktop applications and their configuration status.

```bash
1mcp app list
```

### [discover](./discover.md)

Discovers installed applications with MCP configurations.

```bash
1mcp app discover
```

### [status](./status.md)

Shows the current consolidation status of your applications.

```bash
1mcp app status
```

### [backups](./backups.md)

Lists and manages configuration backups.

```bash
1mcp app backups --cleanup=30
```
