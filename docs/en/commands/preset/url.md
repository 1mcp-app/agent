# preset url

Generate the client URL for a preset.

For a complete overview of preset management, see the **[Preset Commands Overview](./index)**.

## Synopsis

```bash
npx -y @1mcp/agent preset url <name>
```

## Arguments

- **`<name>`**
  - The name of the preset to generate URL for.
  - **Required**: Yes

## Description

The `preset url` command generates the client URL for a specific preset. This URL can be used directly in MCP client configurations to access the filtered server subset defined by the preset.

### URL Format

```
http://host:port/?preset=name
```

- **host:port**: Your 1MCP server address (default: `127.0.0.1:3050`)
- **preset=name**: Query parameter that activates the preset

## Examples

### Basic Usage

```bash
# Generate URL for development preset
npx -y @1mcp/agent preset url development
# Output: http://127.0.0.1:3050/?preset=development

# Generate URL for production preset
npx -y @1mcp/agent preset url production
# Output: http://127.0.0.1:3050/?preset=production
```

### Integration with Client Configuration

#### Claude Desktop

```json
{
  "mcpServers": {
    "1mcp-development": {
      "command": "npx",
      "args": ["-y", "@1mcp/agent", "serve"],
      "env": {
        "ONE_MCP_PRESET_URL": "http://127.0.0.1:3050/?preset=development"
      }
    }
  }
}
```

#### Cursor/VS Code

```json
{
  "mcp.servers": {
    "1mcp-production": {
      "url": "http://127.0.0.1:3050/?preset=production"
    }
  }
}
```

## Use Cases

### Development Environment Setup

```bash
# Get development preset URL
DEV_URL=$(npx -y @1mcp/agent preset url development)
echo "Configure your development client with: $DEV_URL"
```

### Team Configuration Sharing

```bash
# Share preset URLs with team members
echo "Development: $(npx -y @1mcp/agent preset url team-dev)"
echo "Staging: $(npx -y @1mcp/agent preset url team-staging)"
echo "Production: $(npx -y @1mcp/agent preset url team-prod)"
```

### Automation Scripts

```bash
#!/bin/bash
# Update client configurations with current preset URLs

DEV_URL=$(npx -y @1mcp/agent preset url development)
PROD_URL=$(npx -y @1mcp/agent preset url production)

# Update configuration files
sed -i "s|preset=development|${DEV_URL}|g" config/dev.json
sed -i "s|preset=production|${PROD_URL}|g" config/prod.json
```

## Dynamic Server Selection

When a client uses a preset URL:

1. **Request Processing**: 1MCP server receives request with `?preset=name`
2. **Preset Resolution**: Server looks up the preset configuration
3. **Server Filtering**: Applies preset's tag query to available servers
4. **Dynamic Response**: Returns only matching servers to the client
5. **Fallback**: If preset not found, returns all servers (safe default)

### Context Switching

Clients can switch server contexts by changing the preset parameter:

```bash
# Development context
http://127.0.0.1:3050/?preset=development

# Production context
http://127.0.0.1:3050/?preset=production

# All servers (no filtering)
http://127.0.0.1:3050/
```

## Error Handling

### Preset Not Found

```bash
npx -y @1mcp/agent preset url nonexistent
# Error: Preset 'nonexistent' not found
```

### Server Configuration Issues

If there are issues with the server configuration, the URL is still generated but may not work as expected. Use `preset test <name>` to validate server matching.

## URL Validation

The generated URLs are validated to ensure:

- **Preset exists**: The named preset is in your configuration
- **Valid format**: URL follows proper HTTP format
- **Server accessibility**: Based on current server configuration

## Workflow Integration

Common usage patterns:

```bash
# 1. Create or verify preset exists
npx -y @1mcp/agent preset list

# 2. Generate URL for client configuration
npx -y @1mcp/agent preset url development

# 3. Test preset to verify server matching
npx -y @1mcp/agent preset test development

# 4. Configure your MCP client with the generated URL
```

## Advanced Usage

### Custom Server Configuration

If your 1MCP server runs on a different host/port:

```bash
# The URL will reflect your server's actual configuration
# For example, if running on port 3052:
npx -y @1mcp/agent preset url development
# Output: http://127.0.0.1:3052/?preset=development
```

### Multiple Environments

```bash
# Generate URLs for different environments
for env in development staging production; do
  echo "$env: $(npx -y @1mcp/agent preset url $env)"
done
```

## See Also

- **[preset show](./show)** - Show complete preset details including URL
- **[preset test](./test)** - Test preset server matching
- **[preset create](./create)** - Create new presets for URL generation
- **[preset list](./list)** - List all available presets
