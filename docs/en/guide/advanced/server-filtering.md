# Server Filtering by Tags

The 1MCP Agent provides advanced tag-based server filtering, allowing you to direct requests to specific backend MCP servers using both simple OR logic and complex boolean expressions. This feature helps organize and control access to different MCP servers by their capabilities.

## How It Works

When connecting to the 1MCP Agent, you can specify tags to filter which backend servers are available. The agent will only connect to and route requests to servers that have the specified tags.

For example, if you have two servers—one with the `filesystem` tag and another with the `search` tag—you can control which servers are available by including the appropriate tags in your connection.

## Configuration

To enable server filtering, you need to assign tags to your backend servers in your `mcp.json` configuration file.

```json
{
  "mcpServers": {
    "file_server": {
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "tags": ["filesystem", "read-only"]
    },
    "search_server": {
      "command": ["uvx", "mcp-server-fetch"],
      "tags": ["search", "web"]
    }
  }
}
```

In this example:

- The `file_server` is tagged with `filesystem` and `read-only`.
- The `search_server` is tagged with `search` and `web`.

## Usage

The 1MCP Agent supports two types of tag filtering: simple OR logic and advanced boolean expressions.

### Simple Tag Filtering (Deprecated)

⚠️ **The `--tags` parameter is deprecated and will be removed in a future version. Use `--tag-filter` instead.**

The `--tags` parameter provides simple OR logic filtering:

```bash
# Only connect to servers with "filesystem" tag
npx -y @1mcp/agent --transport stdio --tags "filesystem"

# Connect to servers with either "filesystem" or "web" tags (OR logic)
npx -y @1mcp/agent --transport stdio --tags "filesystem,web"
```

### Advanced Tag Filtering

The new `--tag-filter` parameter supports complex boolean expressions:

#### Basic Operations

```bash
# Single tag
npx -y @1mcp/agent --transport stdio --tag-filter "filesystem"

# AND operation (both tags required)
npx -y @1mcp/agent --transport stdio --tag-filter "filesystem+web"

# OR operation (either tag)
npx -y @1mcp/agent --transport stdio --tag-filter "filesystem,web"

# NOT operation (exclude servers with this tag)
npx -y @1mcp/agent --transport stdio --tag-filter "!test"
```

#### Complex Expressions

```bash
# Servers with (filesystem OR web) AND prod, but NOT test
npx -y @1mcp/agent --transport stdio --tag-filter "(filesystem,web)+prod-test"

# Servers with api AND (db OR cache), but NOT development
npx -y @1mcp/agent --transport stdio --tag-filter "api+(db,cache)-development"
```

#### Natural Language Syntax

The tag filter also supports natural language boolean operators:

```bash
# Using natural language AND
npx -y @1mcp/agent --transport stdio --tag-filter "web and api"

# Using natural language OR
npx -y @1mcp/agent --transport stdio --tag-filter "filesystem or database"

# Using natural language NOT
npx -y @1mcp/agent --transport stdio --tag-filter "api and not test"

# Complex natural language expression
npx -y @1mcp/agent --transport stdio --tag-filter "(web or api) and production and not development"
```

#### Symbol Reference

| Operator | Symbol   | Natural Language | Example                         |
| -------- | -------- | ---------------- | ------------------------------- |
| AND      | `+`      | `and`            | `web+api` or `web and api`      |
| OR       | `,`      | `or`             | `web,api` or `web or api`       |
| NOT      | `-`, `!` | `not`            | `-test`, `!test`, or `not test` |
| Group    | `()`     | `()`             | `(web,api)+prod`                |

### HTTP/SSE Filtering

For HTTP connections, specify tag filters in query parameters:

```bash
# Simple tag filtering
curl "http://localhost:3050/sse?tags=web,api"

# Advanced tag filtering (URL-encoded)
curl "http://localhost:3050/sse?tag-filter=web%2Bapi"  # web+api
curl "http://localhost:3050/sse?tag-filter=%28web%2Capi%29%2Bprod"  # (web,api)+prod
```

### Migration from --tags to --tag-filter

For simple OR logic filtering, you can easily migrate from `--tags` to `--tag-filter`:

```bash
# Old (deprecated)
--tags "web,api,database"

# New (recommended)
--tag-filter "web,api,database"
```

### Mutual Exclusivity

The `--tags` and `--tag-filter` parameters are mutually exclusive - you cannot use both at the same time. The agent will return an error if both are specified.
