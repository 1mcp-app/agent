# Server Instruction Overrides

One of the most powerful features of custom templates is the ability to override, filter, or customize server instructions using Handlebars logic. This gives you complete control over how server instructions are presented to the LLM.

## Basic Server Instruction Override Patterns

### 1. Completely Replace Server Instructions

You can replace the original server instructions with your own custom content:

::: v-pre

```markdown
{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{#if (eq name "problematic-server")}}

# Custom Instructions for {{name}}

This server has been customized with simplified instructions.
Use these tools: tool1, tool2, tool3
{{else}}
{{instructions}}
{{/if}}
</{{name}}>
{{/if}}
{{/each}}
```

:::

### 2. Filter Out Specific Servers

Skip certain servers entirely by adding conditions:

::: v-pre

```markdown
{{#each servers}}
{{#unless (eq name "unwanted-server")}}
{{#if hasInstructions}}
<{{name}}>
{{instructions}}
</{{name}}>
{{/if}}
{{/unless}}
{{/each}}
```

:::

### 3. Add Prefixes or Suffixes to Server Instructions

Enhance server instructions with additional context:

::: v-pre

```markdown
{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
⚠️ **Server: {{name}}** - Use with caution in production

{{instructions}}

📝 **Note**: All {{name}} operations are logged for audit purposes.
</{{name}}>
{{/if}}
{{/each}}
```

:::

### 4. Conditional Instructions Based on Server Names

Different handling based on server type or naming patterns:

::: v-pre

```markdown
{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{#if (startsWith name "test-")}}

# Test Environment Server: {{name}}

⚠️ This is a test server. Results may not be reliable.

{{instructions}}
{{else if (startsWith name "prod-")}}

# Production Server: {{name}}

✅ This is a production server. All operations are monitored.

{{instructions}}
{{else}}
{{instructions}}
{{/if}}
</{{name}}>
{{/if}}
{{/each}}
```

:::

## Advanced Override Techniques

### 1. Server Instruction Transformation

Transform instructions using custom logic:

::: v-pre

```markdown
{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{#if (eq name "verbose-server")}}

# Simplified {{name}} Instructions

{{! Replace verbose instructions with simplified version }}
This server provides file operations. Key tools:

- read_file: Read file contents
- write_file: Write file contents
- list_files: List directory contents
  {{else}}
  {{instructions}}
  {{/if}}
  </{{name}}>
  {{/if}}
  {{/each}}
```

:::

### 2. Merge Multiple Servers

Combine instructions from multiple servers into unified sections:

::: v-pre

```markdown
## File Operations

{{#each servers}}
{{#if (or (eq name "filesystem") (eq name "storage"))}}
{{#if hasInstructions}}

### {{name}} Capabilities

{{instructions}}
{{/if}}
{{/if}}
{{/each}}

## Database Operations

{{#each servers}}
{{#if (or (eq name "database") (eq name "sql"))}}
{{#if hasInstructions}}

### {{name}} Capabilities

{{instructions}}
{{/if}}
{{/if}}
{{/each}}

## Other Services

{{#each servers}}
{{#unless (or (eq name "filesystem") (eq name "storage") (eq name "database") (eq name "sql"))}}
{{#if hasInstructions}}
<{{name}}>
{{instructions}}
</{{name}}>
{{/if}}
{{/unless}}
{{/each}}
```

:::

### 3. Priority-Based Server Ordering

Reorder servers by importance or preference:

::: v-pre

```markdown
## High Priority Servers

{{#each servers}}
{{#if (or (eq name "critical-server") (eq name "primary-db"))}}
{{#if hasInstructions}}
<{{name}}>
🔥 **HIGH PRIORITY SERVER**

{{instructions}}
</{{name}}>
{{/if}}
{{/if}}
{{/each}}

## Standard Servers

{{#each servers}}
{{#unless (or (eq name "critical-server") (eq name "primary-db"))}}
{{#if hasInstructions}}
<{{name}}>
{{instructions}}
</{{name}}>
{{/if}}
{{/unless}}
{{/each}}
```

:::

## Handlebars Helper Functions for Server Overrides

You can use these built-in Handlebars helpers for complex logic:

| Helper       | Description          | Example Usage                                                       |
| ------------ | -------------------- | ------------------------------------------------------------------- |
| `eq`         | Equality comparison  | <span v-pre>`{{#if (eq name "server1")}}`</span>                    |
| `ne`         | Not equal comparison | <span v-pre>`{{#if (ne name "server1")}}`</span>                    |
| `or`         | Logical OR           | <span v-pre>`{{#if (or (eq name "a") (eq name "b"))}}`</span>       |
| `and`        | Logical AND          | <span v-pre>`{{#if (and hasInstructions (ne name "skip"))}}`</span> |
| `startsWith` | String starts with   | <span v-pre>`{{#if (startsWith name "test-")}}`</span>              |
| `endsWith`   | String ends with     | <span v-pre>`{{#if (endsWith name "-dev")}}`</span>                 |
| `contains`   | String contains      | <span v-pre>`{{#if (contains instructions "deprecated")}}`</span>   |

## Real-World Override Examples

### Example 1: Environment-Specific Instructions

::: v-pre

```markdown
{{#each servers}}
{{#if hasInstructions}}
<{{name}}>
{{#if (endsWith name "-dev")}}

# Development Environment: {{name}}

⚠️ **DEV MODE**: This server is for development only.

{{instructions}}

**Development Notes:**

- Debugging is enabled
- All operations are logged verbosely
- Data may be reset daily
  {{else if (endsWith name "-prod")}}

# Production Environment: {{name}}

✅ **PRODUCTION**: This server handles live data.

{{instructions}}

**Production Guidelines:**

- All operations are audited
- Rate limiting is enforced
- Follow security protocols
  {{else}}
  {{instructions}}
  {{/if}}
  </{{name}}>
  {{/if}}
  {{/each}}
```

:::

### Example 2: Server Capability Grouping

::: v-pre

```markdown
# Server Capabilities by Category

## Data Storage & Retrieval

{{#each servers}}
{{#if (or (contains name "db") (contains name "storage") (contains name "file"))}}
{{#if hasInstructions}}

### {{name}}

{{instructions}}
{{/if}}
{{/if}}
{{/each}}

## Communication & Networking

{{#each servers}}
{{#if (or (contains name "web") (contains name "api") (contains name "http"))}}
{{#if hasInstructions}}

### {{name}}

{{instructions}}
{{/if}}
{{/if}}
{{/each}}

## Processing & Computation

{{#each servers}}
{{#unless (or (contains name "db") (contains name "storage") (contains name "file") (contains name "web") (contains name "api") (contains name "http"))}}
{{#if hasInstructions}}

### {{name}}

{{instructions}}
{{/if}}
{{/unless}}
{{/each}}
```

:::

## Testing Your Template Overrides

To test your template overrides and ensure they work correctly:

### 1. Create a Test Template

Create a simple test template to verify your override logic:

::: v-pre

```markdown
# Template Test

{{#if hasServers}}
Found {{serverCount}} servers with instructions.

{{#each servers}}
Server: {{name}} (has instructions: {{hasInstructions}})
{{#if hasInstructions}}
Instructions length: {{instructions.length}} characters
{{/if}}

{{/each}}
{{else}}
No servers found.
{{/if}}
```

:::

### 2. Test with the CLI

Save your template to a file and test it:

```bash
# Create a test template
echo "{{#each servers}}{{name}}: {{hasInstructions}}{{/each}}" > test-template.md

# Test with your template
1mcp serve --instructions-template test-template.md

# Connect a client to see the rendered output
```

### 3. Validation Steps

1. **Syntax Check**: Ensure Handlebars syntax is valid
2. **Logic Verification**: Test conditional logic with different server configurations
3. **Edge Cases**: Test with no servers, single server, servers without instructions
4. **Performance**: Monitor rendering time with many servers

### 4. Common Testing Scenarios

Test your templates against these common scenarios:

- **No servers connected**: Template should handle empty state gracefully
- **Mixed server types**: Some with instructions, some without
- **Long instructions**: Ensure formatting remains readable
- **Special characters**: Test with server names containing special characters
- **Multiple environments**: Test with dev/staging/prod server naming patterns

## Tips for Server Instruction Overrides

1. **Test Your Logic**: Use simple conditions first, then build complexity
2. **Preserve Original Content**: Consider keeping original instructions available with modifications
3. **Use Comments**: Handlebars comments <span v-pre>`{{! comment }}`</span> help document your logic
4. **Validate Server Names**: Check server names match your expected patterns
5. **Handle Edge Cases**: Account for servers without instructions or unexpected names
6. **Performance**: Complex logic in templates can slow rendering with many servers
7. **Documentation**: Document your override logic for team members
8. **Version Control**: Keep templates in version control to track changes

## Troubleshooting Template Issues

### Common Problems and Solutions

1. **Template not loading**: Check file path and permissions
2. **Syntax errors**: Validate Handlebars syntax with a validator
3. **Logic not working**: Test individual conditions step by step
4. **Performance issues**: Simplify complex nested loops
5. **Output formatting**: Check for extra whitespace or missing line breaks

### Debug Template Variables

Use this debug template to inspect available variables:

::: v-pre

```markdown
# Debug Template

## Available Variables

- serverCount: {{serverCount}}
- hasServers: {{hasServers}}
- serverList: {{serverList}}
- toolPattern: {{toolPattern}}
- title: {{title}}

## Server Details

{{#each servers}}

### Server {{@index}}: {{name}}

- Has Instructions: {{hasInstructions}}
- Instructions Length: {{instructions.length}}
  {{#if hasInstructions}}
- First 100 chars: {{substring instructions 0 100}}...
  {{/if}}

{{/each}}
```

:::

This template will help you understand what data is available and how it's structured.
