# Template Variables Reference

This page provides a complete reference for all variables available in custom instruction templates.

## Server State Variables

### <span v-pre>`{{serverCount}}`</span>

- **Type**: `number`
- **Description**: Number of connected servers that have instructions
- **Example**: `3`
- **Notes**: Only counts servers with non-empty instructions

### <span v-pre>`{{hasServers}}`</span>

- **Type**: `boolean`
- **Description**: Whether any servers with instructions are connected
- **Example**: `true`
- **Usage**: Primary conditional for template logic

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
- **Description**: Grammatically correct singular/plural form
- **Values**: `"server"` (count = 1) or `"servers"` (count ≠ 1)
- **Example**: `"servers"`

### <span v-pre>`{{isAre}}`</span>

- **Type**: `string`
- **Description**: Grammatically correct verb form
- **Values**: `"is"` (count = 1) or `"are"` (count ≠ 1)
- **Example**: `"are"`

## Content Variables

### <span v-pre>`{{{instructions}}}`</span>

- **Type**: `string` (HTML/Markdown)
- **Description**: All server instructions wrapped in XML-like tags
- **Format**: `<server-name>\nInstructions...\n</server-name>`
- **Usage**: Use <span v-pre>`{{{instructions}}}`</span> (triple braces) to render HTML/Markdown
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
Connected to {{serverCount}} {{pluralServers}}
```

:::

Output: `Connected to 3 servers`

### Conditional Content

::: v-pre

```text
{{#if hasServers}}
  {{serverCount}} {{pluralServers}} {{isAre}} ready
{{else}}
  No servers connected
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
{{{instructions}}}
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

## Status: {{#if hasServers}}✅ Active{{else}}⏳ Waiting{{/if}}

{{#if hasServers}}
**{{serverCount}} {{pluralServers}} connected**{{filterContext}}

### Servers
{{#each serverNames}}
- 🔧 {{this}}
{{/each}}

### Instructions
{{{instructions}}}

### Example Tools
{{#each examples}}
- `{{name}}` - {{description}}
{{/each}}

*Tools use pattern: `{{toolPattern}}`*
{{else}}
Waiting for server connections...
{{/if}}
```

:::

## Variable Scope and Context

### Filtering Impact

When filtering is active, only variables reflect the filtered subset:

- <span v-pre>`{{serverCount}}`</span> = count of filtered servers
- <span v-pre>`{{serverNames}}`</span> = names of filtered servers only
- <span v-pre>`{{{instructions}}}`</span> = instructions from filtered servers only
- <span v-pre>`{{filterContext}}`</span> = description of active filter

### Alphabetical Ordering

Server-related variables maintain consistent alphabetical ordering:

- <span v-pre>`{{serverList}}`</span> is alphabetically sorted
- <span v-pre>`{{serverNames}}`</span> array is alphabetically sorted
- <span v-pre>`{{{instructions}}}`</span> sections appear in alphabetical order

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

### Safe Rendering

- Use <span v-pre>`{{variable}}`</span> for escaped output
- Use <span v-pre>`{{{variable}}`</span> for raw HTML/Markdown (like instructions)
- Handlebars automatically handles XSS protection for escaped variables
