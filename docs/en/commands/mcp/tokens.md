# mcp tokens

Estimate MCP token usage for server capabilities by connecting to servers and analyzing their tools, resources, and prompts.

For a complete overview of server management, see the **[Server Management Guide](../../guide/essentials/server-management)**.

## Synopsis

```bash
npx -y @1mcp/agent mcp tokens [options]
```

## Options

- **`--model, -m <model>`**
  - Model to use for token estimation (default: `gpt-4o`)
  - Supports any valid tiktoken model including `gpt-3.5-turbo`, `gpt-4`, `o1`, etc.

- **`--tag-filter, -f <expression>`**
  - Filter servers by advanced tag expression (and/or/not logic)
  - Examples: `network`, `web+api`, `(filesystem,network)-test`

- **`--format <format>`**
  - Output format: `table`, `json`, `summary` (default: `table`)

- **`--config, -c <path>`**
  - Path to the config file

## Description

The `mcp tokens` command connects to your configured MCP servers and analyzes their capabilities to estimate token usage. This is useful for:

- **Cost Planning**: Estimate token costs when using different language models
- **Performance Analysis**: Understand which servers contribute most to token usage
- **Optimization**: Identify opportunities to reduce token consumption
- **Debugging**: Analyze server connectivity and capability loading

The command uses tiktoken for accurate tokenization based on the specified model, with automatic fallback handling for invalid models.

## Examples

```bash
# Estimate tokens for all MCP servers using default model (gpt-4o)
npx -y @1mcp/agent mcp tokens

# Use a different model for token estimation
npx -y @1mcp/agent mcp tokens --model gpt-3.5-turbo

# Filter servers by tags and show summary format
npx -y @1mcp/agent mcp tokens --tag-filter="network or filesystem" --format=summary

# Export detailed analysis as JSON for programmatic use
npx -y @1mcp/agent mcp tokens --format=json > token-analysis.json

# Complex tag filtering with specific model
npx -y @1mcp/agent mcp tokens --model=o1 --tag-filter="(web+api)-test" --format=table

# Use custom config file
npx -y @1mcp/agent mcp tokens --config ~/my-mcp-config.json
```

## Output Formats

### Table Format (Default)

Shows a hierarchical breakdown by capability type (Tools, Resources, Prompts) with server groupings and token estimates for each item.

### JSON Format

Provides structured data suitable for programmatic analysis:

```json
{
  "summary": {
    "totalServers": 5,
    "connectedServers": 4,
    "totalTools": 25,
    "overallTokens": 8450
  },
  "servers": [
    {
      "serverName": "filesystem",
      "connected": true,
      "breakdown": {
        "tools": [...],
        "totalTokens": 1200
      }
    }
  ]
}
```

### Summary Format

Concise overview with key metrics and top servers by token usage.

## Supported Models

The `--model` option accepts any valid tiktoken model:

- **GPT-4 Family**: `gpt-4o`, `gpt-4`, `gpt-4-turbo`
- **GPT-3.5 Family**: `gpt-3.5-turbo`, `gpt-3.5-turbo-16k`
- **O1 Family**: `o1`, `o1-mini`, `o1-preview`
- **Legacy Models**: `text-davinci-003`, `code-davinci-002`

If an invalid model is specified, the command automatically falls back to `gpt-4o` with a warning.

## Error Handling

- **Server Connection Failures**: Displayed in output with error details
- **Invalid Model Names**: Automatic fallback to `gpt-4o`
- **Configuration Issues**: Clear error messages with suggested fixes
- **Permission Errors**: Helpful guidance for authentication issues

## See Also

- **[Server Management Guide](../../guide/essentials/server-management)**
- **[mcp status](./status)** - Check server connectivity
- **[mcp list](./list)** - List configured servers
