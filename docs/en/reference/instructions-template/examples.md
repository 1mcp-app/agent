# Template Examples

This page provides complete template examples for different use cases. Copy and customize these templates for your specific needs.

## Template Rendering Behavior

**Important**: 1MCP uses `noEscape: true` in Handlebars configuration, which means:

- All variables output unescaped content by default
- XML tags like `<server-name>` render cleanly without HTML entity escaping
- Use regular `{{variable}}` syntax for all content (no triple braces needed)
- Perfect for LLM consumption where readability and proper formatting are essential

## Basic Template

A simple, clean template that covers the essentials. This example demonstrates the new enhanced server iteration:

```
# My MCP Gateway

## Connected Servers

We have 3 servers connected:
- api-server
- database-server
- web-server

## Server Instructions

Each server provides specific capabilities. Instructions are organized with XML-like tags for clear identification:

### api-server Server
<api-server>
API server instructions for backend services
</api-server>

### database-server Server
<database-server>
Database server instructions for data management
</database-server>

### web-server Server
<web-server>
Web server instructions for frontend development
</web-server>

## Usage

All tools are available using the pattern: `{server}_1mcp_{tool}`

Example tools:
- `filesystem_1mcp_read_file` - Read files through filesystem server
- `web_1mcp_search` - Search the web through web server
- `database_1mcp_query` - Query databases through database server
```

## Enhanced Template Features

### Individual Server Iteration

The new template system provides two ways to display server information:

1. **Simple List**: Use the `serverNames` variable for basic server lists
2. **Detailed Objects**: Use the `servers` array for maximum flexibility and conditional logic

### Template Variables Reference

#### Server Arrays

- `serverNames` - Array of server names for simple iteration
- `servers` - Array of server objects with detailed information

Each server object in the `servers` array contains:

- `name` - Server name (e.g., "api-server")
- `instructions` - Server instructions content
- `hasInstructions` - Whether this server has instructions

#### XML Tag Documentation

Always explain to LLMs what the XML-like tags represent:

- **Purpose**: Tags identify which server provides which instructions
- **Format**: `<server-name>instructions content</server-name>`
- **Benefits**: Clear boundaries between different server capabilities
- **LLM Understanding**: Helps LLMs route requests correctly

### Template Pattern Examples

#### Basic Server List

```
Connected servers:
- api-server
- database-server
- web-server
```

#### Detailed Server Information with Conditionals

```
### api-server Server
Connected and Ready

#### What api-server Can Do
<api-server>
API server instructions for backend services
</api-server>

### database-server Server
Connected and Ready

#### What database-server Can Do
<database-server>
Database server instructions for data management
</database-server>
```

## Usage Tips

1. **Copy and Customize**: Start with basic patterns and customize for your needs
2. **Test Iteratively**: Make small changes and test with different server configurations
3. **Handle Edge Cases**: Always include both connected and no-servers conditions
4. **Use Regular Syntax**: All variables use `{{variable}}` syntax - no triple braces needed due to `noEscape: true`
5. **XML Tags Render Cleanly**: Server instructions with `<server-name>` tags output as-is for perfect LLM readability
6. **Check Logs**: Monitor template rendering logs during development
