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
