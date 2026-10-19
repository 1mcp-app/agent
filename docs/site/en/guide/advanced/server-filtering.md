---
title: Server Filtering - Runtime and Client Selection
description: Use 1MCP filtering to control which backend servers are exposed by the runtime or selected by client-facing commands.
head:
  - ['meta', { name: 'keywords', content: 'server filtering,tag filtering,access control,boolean expressions' }]
  - ['meta', { property: 'og:title', content: '1MCP Server Filtering Guide' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Control MCP server access with tag-based filtering in 1MCP. Boolean expressions and filtering.',
      },
    ]
---

# Server Filtering

1MCP supports filtering at two different layers:

- **Runtime filtering** with `1mcp serve --filter ...` or `1mcp --filter ...`
- **Client-side narrowing** with `instructions`, `inspect`, `run`, or `proxy`

## How It Works

At runtime level, `serve` uses `--filter` to decide which backend servers are exposed at all. After the runtime is running, client-facing commands can further narrow selection without changing the runtime process.

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

### Runtime Filtering with `serve`

Use `--filter` on `serve` or the default command when you want the runtime itself to expose only a subset of servers:

```bash
# Only expose servers with the "filesystem" tag
npx -y @1mcp/agent --filter "filesystem"

# Expose servers with either "filesystem" or "web" tags (OR logic)
npx -y @1mcp/agent --filter "filesystem,web"

# Expose servers that match a complex expression
npx -y @1mcp/agent --filter "(filesystem,web)+prod-test"
npx -y @1mcp/agent --filter "api and not test"
```

#### Symbol Reference

| Operator | Symbol   | Natural Language | Example                         |
| -------- | -------- | ---------------- | ------------------------------- |
| AND      | `+`      | `and`            | `web+api` or `web and api`      |
| OR       | `,`      | `or`             | `web,api` or `web or api`       |
| NOT      | `-`, `!` | `not`            | `-test`, `!test`, or `not test` |
| Group    | `()`     | `()`             | `(web,api)+prod`                |

### Client-Side Narrowing

After the runtime is already running, use the client-facing selectors that match the command surface:

```bash
# Narrow CLI mode output without restarting the runtime
1mcp instructions --tags backend
1mcp inspect --tag-filter "web+api"
1mcp run myserver/mytool --tag-filter "web+api" --args '{"q":"test"}'

# Narrow the maximum-compatibility stdio path
1mcp proxy --filter "web AND api"
1mcp proxy --tags "web,api"
```

`--filter` is the preferred unified syntax for client-side narrowing. `--tags` and `--tag-filter` remain available as legacy compatibility aliases for CLI and HTTP query styles, but they are mutually exclusive with each other and with `--filter`.

### HTTP/SSE Filtering

For HTTP connections, specify tag filters in query parameters:

```bash
# Simple tag filtering
curl "http://localhost:3050/sse?tags=web,api"

# Advanced tag filtering (URL-encoded)
curl "http://localhost:3050/sse?tag-filter=web%2Bapi"  # web+api
curl "http://localhost:3050/sse?tag-filter=%28web%2Capi%29%2Bprod"  # (web,api)+prod
```

For HTTP/SSE entrypoints that accept both query parameters, `tags` and `tag-filter` remain mutually exclusive. Use `tag-filter` for advanced expressions, or prefer `--filter` on CLI-facing commands when available.

## Tag Character Handling

The 1MCP Agent provides robust handling of special characters in tags with automatic validation and user warnings.

### Supported Characters

Tags can contain:

- **Alphanumeric characters**: `a-z`, `A-Z`, `0-9`
- **Hyphens and underscores**: `web-api`, `file_system`
- **Dots**: `v1.0`, `api.core`
- **International characters**: `wëb`, `ăpi`, `мобильный` (with warnings)

### Problematic Characters

The agent will warn about characters that may cause issues:

| Character       | Warning                | Reason                                |
| --------------- | ---------------------- | ------------------------------------- |
| `,`             | Comma interference     | Can interfere with tag list parsing   |
| `&`             | URL parameter conflict | Can interfere with URL parameters     |
| `=`             | URL parameter conflict | Can interfere with URL parameters     |
| `?` `#`         | URL parsing issues     | Can interfere with URL parsing        |
| `/` `\`         | Path conflicts         | Can cause parsing issues              |
| `<` `>`         | HTML injection         | Can cause HTML injection issues       |
| `"` `'` `` ` `` | Quote issues           | Can cause parsing issues              |
| Control chars   | Formatting issues      | Newlines, tabs, etc. can cause issues |

### URL Encoding

Tags are automatically decoded when URL-encoded:

- `web%20api` → `web api` (with warning about URL decoding)
- `mobile%2Dapp` → `mobile-app`

### Validation Limits

- **Maximum tag length**: 100 characters
- **Maximum tags per request**: 50 tags
- **Case handling**: Tags are normalized to lowercase for matching
- **Whitespace**: Leading/trailing whitespace is automatically trimmed

### Error Responses

When invalid tags are provided, the API returns detailed error information:

```json
{
  "error": {
    "code": "INVALID_PARAMS",
    "message": "Invalid tags: Tag 1 \"very-long-tag...\": Tag length cannot exceed 100 characters",
    "details": {
      "errors": ["Tag 1 \"very-long-tag...\": Tag length cannot exceed 100 characters"],
      "warnings": ["Tag \"web&api\": Contains '&' - ampersands can interfere with URL parameters"],
      "invalidTags": ["very-long-tag..."]
    }
  }
}
```

### Best Practices

1. **Use simple tags**: Stick to alphanumeric characters, hyphens, and underscores
2. **Avoid special characters**: Use `web-api` instead of `web&api`
3. **Keep tags short**: Aim for under 20 characters per tag
4. **Use consistent naming**: Establish naming conventions for your tags
5. **Test with URL encoding**: If using HTTP endpoints, ensure tags work when URL-encoded

### Examples

```bash
# Good tag examples
--tag-filter "web-api+production"
--tag-filter "database,cache,redis"
--tag-filter "v1.2+stable"

# Tags with warnings (will work but generate warnings)
--tag-filter "web&api"           # Warning: ampersand
--tag-filter "mobile,responsive" # Warning: comma in tag name
--tag-filter "test<prod"         # Warning: HTML character

# Invalid tags (will be rejected)
--tag-filter "$(very-long-tag-name-that-exceeds-100-characters...)"  # Too long
--tag-filter ""                  # Empty tag
```
