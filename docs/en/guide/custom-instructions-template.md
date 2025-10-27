---
title: Custom Instructions Template - Customize LLM Instructions
description: Customize instruction templates for LLM clients in 1MCP. Learn about Handlebars templates, variables, and custom branding.
head:
  - ['meta', { name: 'keywords', content: 'custom instructions template,Handlebars,LLM instructions,branding' }]
  - ['meta', { property: 'og:title', content: '1MCP Custom Instructions Template Guide' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Customize LLM instruction templates in 1MCP. Handlebars templates and variable substitution.',
      },
    ]
---

# Custom Instruction Templates

1MCP allows you to customize the instruction templates that are sent to LLM clients. This enables you to brand your proxy, provide custom documentation, or tailor the educational content to your specific use case.

## Overview

By default, 1MCP generates educational instruction templates that help LLMs understand how to use the proxy effectively. You can override this with your own Handlebars template that includes:

- Custom branding and messaging
- Specific instructions for your use case
- Variable substitution with real-time server data
- Conditional content based on connected servers

## Template Variables

Your custom templates have access to the following variables:

### Server State Variables

| Variable                               | Type    | Description                                                           | Example                                                                                                                           |
| -------------------------------------- | ------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| <span v-pre>`{{serverCount}}`</span>   | number  | Number of connected servers with instructions                         | `3`                                                                                                                               |
| <span v-pre>`{{hasServers}}`</span>    | boolean | Whether any servers are connected                                     | `true`                                                                                                                            |
| <span v-pre>`{{serverList}}`</span>    | string  | Newline-separated list of server names                                | `"api-server\nweb-server"`                                                                                                        |
| <span v-pre>`{{serverNames}}`</span>   | array   | Array of server names for iteration                                   | `["api-server", "web-server"]`                                                                                                    |
| <span v-pre>`{{servers}}`</span>       | array   | Array of server objects for detailed iteration (includes all servers) | `[{name: "api-server", instructions: "...", hasInstructions: true}, {name: "no-docs", instructions: "", hasInstructions: false}]` |
| <span v-pre>`{{pluralServers}}`</span> | string  | "server" or "servers" based on count                                  | `"servers"`                                                                                                                       |
| <span v-pre>`{{isAre}}`</span>         | string  | "is" or "are" based on count                                          | `"are"`                                                                                                                           |

#### Server Objects (<span v-pre>`{{servers}}`</span> array)

Each server object in the <span v-pre>`{{servers}}`</span> array contains:

| Property          | Type    | Description                                                    |
| ----------------- | ------- | -------------------------------------------------------------- |
| `name`            | string  | Server name (e.g., "api-server")                               |
| `instructions`    | string  | Server's instruction content (empty string if no instructions) |
| `hasInstructions` | boolean | Whether this server has instructions                           |

**Note**: All connected servers are included in the array, even if they have no instructions. Servers without instructions will have `hasInstructions: false` and an empty string for `instructions`.

**Important**: The `serverCount` and related variables (`serverList`, `serverNames`) only include servers that have instructions, while the `servers` array includes all connected servers regardless of whether they have instructions.

### Content Variables

| Variable                               | Type   | Description                                                         |
| -------------------------------------- | ------ | ------------------------------------------------------------------- |
| <span v-pre>`{{instructions}}`</span>  | string | All server instructions wrapped in XML-like tags (unescaped output) |
| <span v-pre>`{{filterContext}}`</span> | string | Filter description or empty string                                  |

#### XML-Style Server Instructions

Server instructions are wrapped in XML-like tags to clearly identify their source and scope:

```xml
<server-name>
Server instructions content here
</server-name>
```

This format helps LLMs understand which instructions come from which server and maintain clear boundaries between different server capabilities.

### Configuration Variables

| Variable                             | Type   | Description            | Default                                                                          |
| ------------------------------------ | ------ | ---------------------- | -------------------------------------------------------------------------------- |
| <span v-pre>`{{title}}`</span>       | string | Title for the template | `"1MCP - Model Context Protocol Proxy"`                                          |
| <span v-pre>`{{toolPattern}}`</span> | string | Tool naming pattern    | `"{server}_1mcp_{tool}"`                                                         |
| <span v-pre>`{{examples}}`</span>    | array  | Array of tool examples | See [examples reference](/en/reference/instructions-template/variables#examples) |

## Using Custom Templates

### Command Line Option

Use the `--instructions-template` option with the serve command:

```bash
# Use a specific template file
1mcp serve --instructions-template ./my-template.md

# Use default template in config directory
1mcp serve  # Looks for instructions-template.md in config dir
```

### Template File Location

By default, 1MCP looks for `instructions-template.md` in your config directory:

- **macOS/Linux**: `~/.config/1mcp/instructions-template.md`
- **Windows**: `%APPDATA%/1mcp/instructions-template.md`

You can also specify a custom path using the CLI option.

### Configuration Override

You can also override template settings per client by extending the configuration system to include template options in your MCP server configurations.

## Template Syntax

1MCP uses [Handlebars](https://handlebarsjs.com/) as the template engine, which provides:

- **Variable substitution**: <span v-pre>`{{variable}}`</span>
- **Conditional content**: <span v-pre>`{{#if condition}}...{{/if}}`</span>
- **Loops**: <span v-pre>`{{#each array}}...{{/each}}`</span>
- **Helpers**: Built-in logical and comparison operators

### HTML Escaping Behavior

**Important**: 1MCP configures Handlebars with `noEscape: true` by default, which means:

- **All variables are unescaped**: <span v-pre>`{{instructions}}`</span> outputs raw content without HTML entity escaping
- **XML tags render cleanly**: `<server-name>` stays as `<server-name>` (not `&lt;server-name&gt;`)
- **No triple braces needed**: Use regular <span v-pre>`{{variable}}`</span> syntax for all content
- **Ready for LLM consumption**: Output is clean and readable for AI processing

This configuration is specifically designed for LLM instruction templates where HTML escaping would make the content less readable and harder for AI models to parse.

### Basic Template Example

::: v-pre

```markdown
# {{title}}

{{#if hasServers}}
You have {{serverCount}} {{pluralServers}} connected:

{{#each serverNames}}

- ✅ {{this}}
  {{/each}}

## Server Instructions

The following sections contain instructions from each connected MCP server. Each server's instructions are wrapped in XML-like tags to clearly identify their source and scope.

{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{instructions}}
</{{name}}>

{{/if}}
{{/each}}

## Tool Usage

Tools follow the pattern: `{{toolPattern}}`
{{else}}
⏳ No servers are currently connected.
{{/if}}
```

:::

### Advanced Template Example

::: v-pre

```markdown
# {{title}}

{{#if hasServers}}
You are interacting with 1MCP, a proxy server that aggregates capabilities from multiple MCP (Model Context Protocol) servers. 1MCP acts as a unified gateway, allowing you to access tools and resources from various specialized MCP servers through a single connection.

## How 1MCP Works

- **Unified Access**: Connect to multiple MCP servers through one proxy
- **Tool Aggregation**: All tools are available with the naming pattern \`{{toolPattern}}\`
- **Resource Sharing**: Access files, data, and capabilities across different servers
- **Intelligent Routing**: Your requests are automatically routed to the appropriate servers

## Currently Connected Servers

{{serverCount}} MCP {{pluralServers}} {{isAre}} currently available{{filterContext}}:

{{serverList}}

## Available Capabilities

All tools from connected servers are accessible using the format: \`{{toolPattern}}\`

Examples:
{{#each examples}}

- \`{{name}}\` - {{description}}
  {{/each}}

## Server-Specific Instructions

The following sections contain instructions from each connected MCP server. Each server's instructions are wrapped in XML-like tags (e.g., \`<server-name>instructions</server-name>\`) to clearly identify their source and scope.

{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{instructions}}
</{{name}}>

{{/if}}
{{/each}}

## Tips for Using 1MCP

- Tools are namespaced by server to avoid conflicts

{{else}}
You are interacting with 1MCP, a proxy server that aggregates capabilities from multiple MCP (Model Context Protocol) servers.

## Current Status

No MCP servers are currently connected. 1MCP is ready to connect to servers and provide unified access to their capabilities once they become available.

## What 1MCP Provides

- **Unified Access**: Connect to multiple MCP servers through one proxy
- **Tool Aggregation**: Access tools using the pattern \`{{toolPattern}}\`
- **Resource Sharing**: Share files, data, and capabilities across servers
- **Intelligent Routing**: Automatic request routing to appropriate servers

1MCP will automatically detect and connect to available MCP servers. Once connected, their tools and capabilities will become available through the unified interface.
{{/if}}`
```

:::

## Template Best Practices

### 1. Use Conditional Content

Always check if servers are available before showing server-specific content:

```text
{{#if hasServers}}
  <!-- Server-specific content -->
{{else}}
  <!-- No servers message -->
{{/if}}
```

### 2. Handle Pluralization

Use the provided helper variables for proper grammar:

```text
{{serverCount}} {{pluralServers}} {{isAre}} available
```

### 3. All Variables are Unescaped

Since 1MCP uses `noEscape: true`, all variables output raw content without HTML escaping:

```text
{{instructions}}    <!-- Outputs raw content (unescaped) -->
{{name}}           <!-- Outputs server name as-is -->
{{title}}          <!-- All variables render without escaping -->
```

This means XML tags like `<server-name>` will render cleanly in the output, making it perfect for LLM consumption.

### 4. Provide Context

Include information about filtering when active:

```text
{{serverCount}} servers available{{filterContext}}
```

### 5. Use Individual Server Iteration

For maximum flexibility, iterate over individual servers instead of using the concatenated instructions:

```text
{{#each servers}}
{{#if hasInstructions}}
### {{name}} Capabilities
<{{name}}>
{{instructions}}
</{{name}}>
{{else}}
### {{name}}
This server is connected but has no instructions available.
{{/if}}
{{/each}}
```

This gives you control over per-server formatting, conditional inclusion, and custom logic. You can handle servers with and without instructions differently.

### 6. Explain XML Tag Format

Help LLMs understand the XML tag structure by providing context:

```text
## Server Instructions

Each server's instructions are wrapped in XML-like tags (e.g., `<server-name>content</server-name>`) to clearly identify their source and scope.
```

### 7. Make It Helpful

Include examples and usage tips to help LLMs understand your specific setup:

```text
{{#each examples}}
- `{{name}}` - {{description}}
{{/each}}
```

## Error Handling

If your custom template has syntax errors or fails to render:

1. **Fallback**: 1MCP automatically falls back to the default template
2. **Logging**: Errors are logged for debugging
3. **Validation**: Template compilation errors are caught and reported

## Testing Templates

You can test your templates by:

1. **Starting the server**: Use your template and check the logs
2. **Connecting a client**: Verify the instructions are rendered correctly
3. **Using different filters**: Test with various server combinations
4. **Checking edge cases**: Test with no servers, single server, etc.

## Server Instruction Overrides

Custom templates allow you to override, filter, or customize server instructions using Handlebars logic. This gives you complete control over how server instructions are presented to the LLM.

For detailed guidance on server instruction overrides including patterns, techniques, and examples, see the dedicated [Server Instruction Overrides](/en/guide/server-instructions-overrides) guide.

## Example Templates

See the [Template Examples](/en/reference/instructions-template/examples) page for complete template examples for different use cases.
