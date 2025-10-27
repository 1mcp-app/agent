---
title: Template Variables Reference - Complete Variable List
description: Complete reference for all Handlebars template variables available in 1MCP custom instruction templates. Server state, capabilities, filtering, and more.
head:
  - [
      'meta',
      { name: 'keywords', content: 'template variables,Handlebars variables,instruction templates,custom templates' },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Template Variables Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Complete list of all template variables for 1MCP custom instruction templates.',
      },
    ]
---

# Template Variables Reference

This page provides a complete reference for all variables available in custom instruction templates.

## HTML Escaping Behavior

**Important**: 1MCP configures Handlebars with `noEscape: true` by default, which means all template variables output unescaped content. This is specifically designed for LLM instruction templates where HTML escaping would interfere with readability and AI parsing.

- **All variables are unescaped**: Use regular <span v-pre>`{{variable}}`</span> syntax for all content
- **XML tags render cleanly**: `<server-name>` outputs as `<server-name>` (not HTML entities)
- **No triple braces needed**: <span v-pre>`{{instructions}}`</span> outputs raw content directly

## Server State Variables

### <span v-pre>`{{serverCount}}`</span>

- **Type**: `number`
- **Description**: Number of connected servers that have instructions (LEGACY - kept for backward compatibility)
- **Example**: `3`
- **Notes**: Only counts servers with non-empty instructions. Use `instructionalServerCount` for new templates.

### <span v-pre>`{{instructionalServerCount}}`</span>

- **Type**: `number`
- **Description**: Number of connected servers that have instructions (clearer name for `serverCount`)
- **Example**: `3`
- **Notes**: Only counts servers with non-empty instructions

### <span v-pre>`{{connectedServerCount}}`</span>

- **Type**: `number`
- **Description**: Total number of connected servers (including those without instructions)
- **Example**: `5`
- **Notes**: Counts all connected servers regardless of whether they have instructions

### <span v-pre>`{{hasServers}}`</span>

- **Type**: `boolean`
- **Description**: Whether any servers with instructions are connected
- **Example**: `true`
- **Usage**: Primary conditional for template logic (same as `hasInstructionalServers`)

### <span v-pre>`{{hasInstructionalServers}}`</span>

- **Type**: `boolean`
- **Description**: Whether any servers with instructions are connected
- **Example**: `true`
- **Usage**: Primary conditional for displaying instruction-based content

### <span v-pre>`{{serverList}}`</span>

- **Type**: `string`
- **Description**: Newline-separated list of server names (alphabetical order)
- **Example**: `"api-server\ndatabase-server\nweb-server"`
- **Usage**: For simple text lists

### <span v-pre>`{{serverNames}}`</span>

- **Type**: `array<string>`
- **Description**: Array of server names for iteration
- **Example**: `["api-server", "database-server", "web-server"]`
- **Usage**: With <span v-pre>`{{#each}}`</span> helper for custom formatting

### <span v-pre>`{{servers}}`</span>

- **Type**: `array<ServerData>`
- **Description**: Array of server objects for detailed iteration and conditional logic
- **Structure**:
  ```typescript
  interface ServerData {
    name: string; // Server name (e.g., "api-server")
    instructions: string; // Server instructions content
    hasInstructions: boolean; // Whether this server has instructions
  }
  ```
- **Usage**: With <span v-pre>`{{#each}}`</span> for maximum template flexibility
- **Example**:

::: v-pre

```text
{{#each servers}}
{{#if hasInstructions}}
### {{name}} Server
<{{name}}>
{{instructions}}
</{{name}}>
{{/if}}
{{/each}}
```

:::

### <span v-pre>`{{pluralServers}}`</span>

- **Type**: `string`
- **Description**: Grammatically correct singular/plural form based on instructional server count
- **Values**: `"server"` (instructionalServerCount = 1) or `"servers"` (instructionalServerCount ≠ 1)
- **Example**: `"servers"`

### <span v-pre>`{{isAre}}`</span>

- **Type**: `string`
- **Description**: Grammatically correct verb form based on instructional server count
- **Values**: `"is"` (instructionalServerCount = 1) or `"are"` (instructionalServerCount ≠ 1)
- **Example**: `"are"`

### <span v-pre>`{{connectedPluralServers}}`</span>

- **Type**: `string`
- **Description**: Grammatically correct singular/plural form based on total connected server count
- **Values**: `"server"` (connectedServerCount = 1) or `"servers"` (connectedServerCount ≠ 1)
- **Example**: `"servers"`

### <span v-pre>`{{connectedIsAre}}`</span>

- **Type**: `string`
- **Description**: Grammatically correct verb form based on total connected server count
- **Values**: `"is"` (connectedServerCount = 1) or `"are"` (connectedServerCount ≠ 1)
- **Example**: `"are"`

## Content Variables

### <span v-pre>`{{instructions}}`</span>

- **Type**: `string` (unescaped)
- **Description**: All server instructions wrapped in XML-like tags
- **Format**: `<server-name>\nInstructions...\n</server-name>`
- **Usage**: Use regular <span v-pre>`{{instructions}}`</span> syntax (unescaped by default)
- **Example**:

  ```xml
  <api-server>
  API server instructions for backend services
  </api-server>

  <web-server>
  Web server instructions for frontend development
  </web-server>
  ```

### <span v-pre>`{{filterContext}}`</span>

- **Type**: `string`
- **Description**: Description of active filtering, or empty string if none
- **Examples**:
  - `""` (no filtering)
  - `" (filtered by tags: backend, api)"`
  - `" (filtered by advanced expression)"`
  - `" (filtered by preset)"`

## Configuration Variables

### <span v-pre>`{{title}}`</span>

- **Type**: `string`
- **Description**: Title for the instruction template
- **Default**: `"1MCP - Model Context Protocol Proxy"`
- **Customizable**: Can be overridden in configuration
- **Example**: `"My Custom MCP Gateway"`

### <span v-pre>`{{toolPattern}}`</span>

- **Type**: `string`
- **Description**: Tool naming pattern used by the proxy
- **Default**: `"{server}_1mcp_{tool}"`
- **Customizable**: Can be overridden in configuration
- **Example**: `"{server}::{tool}"`

### <span v-pre>`{{examples}}`</span>

- **Type**: `array<ToolExample>`
- **Description**: Array of tool examples for documentation
- **Structure**:
  ```typescript
  interface ToolExample {
    name: string; // Tool name with pattern applied
    description: string; // What the tool does
  }
  ```

#### Default Examples {#default-examples}

| Tool Name                   | Description                             |
| --------------------------- | --------------------------------------- |
| `filesystem_1mcp_read_file` | Read files through filesystem server    |
| `web_1mcp_search`           | Search the web through web server       |
| `database_1mcp_query`       | Query databases through database server |

#### Custom Examples

You can provide custom examples in configuration:

```json
{
  "examples": [
    {
      "name": "custom_1mcp_analyze",
      "description": "Analyze data through custom server"
    },
    {
      "name": "monitor_1mcp_check",
      "description": "Check system health through monitoring server"
    }
  ]
}
```

## Variable Usage Examples

### Basic Substitution

::: v-pre

```text
Connected to {{connectedServerCount}} {{connectedPluralServers}}
With instructions: {{instructionalServerCount}} {{pluralServers}}
```

:::

Output: `Connected to 5 servers`
Output: `With instructions: 3 servers`

### Conditional Content

::: v-pre

```text
{{#if hasServers}}
  {{instructionalServerCount}} {{pluralServers}} {{isAre}} providing instructions
  {{#if connectedServerCount}}
    ({{connectedServerCount}} total {{connectedPluralServers}} connected)
  {{/if}}
{{else}}
  No servers with instructions available
{{/if}}
```

:::

### Server Iteration (Simple)

::: v-pre

```text
{{#each serverNames}}
- Server: {{this}}
{{/each}}
```

:::

### Server Iteration (Detailed)

::: v-pre

```text
{{#each servers}}
{{#if hasInstructions}}
#### {{name}} Capabilities
<{{name}}>
{{instructions}}
</{{name}}>
{{/if}}
{{/each}}
```

:::

### Tool Examples

::: v-pre

```text
Available tools:
{{#each examples}}
- `{{name}}`: {{description}}
{{/each}}
```

:::

### Complex Template

::: v-pre

```text
# {{title}}

## Status: {{#if hasServers}}✅ Connected{{else}}⏳ Waiting{{/if}}

{{#if hasServers}}
**{{connectedServerCount}} {{connectedPluralServers}} connected**{{filterContext}}

### Servers
{{#each serverNames}}
- 🔧 {{this}}
{{/each}}

{{#if hasInstructionalServers}}
### Instructions
{{instructions}}

### Example Tools
{{#each examples}}
- `{{name}}` - {{description}}
{{/each}}

*Tools use pattern: `{{toolPattern}}`*
{{else}}
*Servers connected but no instructions provided yet*
{{/if}}
{{else}}
Waiting for server connections...
{{/if}}
```

:::

## Variable Scope and Context

### Filtering Impact

When filtering is active, variables reflect the filtered subset:

- <span v-pre>`{{connectedServerCount}}`</span> = count of all filtered servers
- <span v-pre>`{{instructionalServerCount}}`</span> = count of filtered servers with instructions
- <span v-pre>`{{serverNames}}`</span> = names of filtered servers only
- <span v-pre>`{{instructions}}`</span> = instructions from filtered servers only
- <span v-pre>`{{filterContext}}`</span> = description of active filter

### Alphabetical Ordering

Server-related variables maintain consistent alphabetical ordering:

- <span v-pre>`{{serverList}}`</span> is alphabetically sorted
- <span v-pre>`{{serverNames}}`</span> array is alphabetically sorted
- <span v-pre>`{{instructions}}`</span> sections appear in alphabetical order

### Real-time Updates

All variables reflect the current state:

- Server connections/disconnections update counts
- Instruction changes update content
- Filter changes update all relevant variables

## Error Handling

### Missing Variables

- Undefined variables render as empty strings
- Template engine continues processing
- No errors thrown for missing variables

### Invalid Templates

- Syntax errors cause fallback to default template
- Errors are logged but don't crash the server
- Template compilation is cached for performance

### Template Rendering

**Note**: 1MCP uses `noEscape: true` configuration, so all variables are unescaped by default:

- <span v-pre>`{{variable}}`</span> outputs raw content (unescaped)
- No need for triple braces - all content renders as-is
- Perfect for LLM consumption where XML tags and markup should be preserved
- XSS protection is not needed since templates are for LLM instruction purposes, not web display
