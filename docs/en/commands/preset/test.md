# preset test

Test a preset against your current server configuration.

For a complete overview of preset management, see the **[Preset Commands Overview](./index)**.

## Synopsis

```bash
npx -y @1mcp/agent preset test <name>
```

## Arguments

- **`<name>`**
  - The name of the preset to test.
  - **Required**: Yes

## Global Options

This command supports all global options:

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

## Description

The `preset test` command validates a preset against your current server configuration, showing which servers match the preset's filtering criteria. This is essential for verifying that presets work as expected before using them in client configurations.

### What It Tests

- **Server Matching**: Which servers match the preset's tag query
- **Query Validation**: Whether the preset's tag query is syntactically correct
- **Tag Availability**: What tags are available in your current server configuration
- **Configuration Consistency**: If servers referenced in the preset still exist

## Examples

### Basic Usage

```bash
# Test development preset
npx -y @1mcp/agent preset test development

# Test production preset
npx -y @1mcp/agent preset test production
```

### Example Output

```bash
npx -y @1mcp/agent preset test development

🔍 Testing preset 'development':
   Matching servers: webserver, apiserver, devtools
   Available tags: web, api, database, development, testing, monitoring
```

### No Matching Servers

```bash
npx -y @1mcp/agent preset test strict-production

🔍 Testing preset 'strict-production':
   Matching servers: none
   Available tags: web, api, development, testing

⚠️  No servers match this preset's criteria.
   Consider updating the preset or adding appropriate server tags.
```

## Output Information

### Matching Servers

- **Server List**: Names of servers that match the preset's criteria
- **Count**: Total number of matching servers
- **Empty Result**: Clear indication if no servers match

### Available Tags

- **Current Tags**: All tags found in your server configuration
- **Tag Count**: Total number of unique tags
- **Coverage**: Helps understand which tags are available for filtering

### Validation Status

- **Success**: Preset query is valid and finds matching servers
- **Warning**: Preset is valid but finds no matching servers
- **Error**: Preset query has syntax errors or references non-existent tags

## Use Cases

### Preset Validation

```bash
# Verify a newly created preset works correctly
npx -y @1mcp/agent preset create team-dev --filter "web,api,development"
npx -y @1mcp/agent preset test team-dev
```

### Troubleshooting

```bash
# Debug why a preset isn't working as expected
npx -y @1mcp/agent preset test problematic-preset

# Compare with available tags to identify issues
```

### Server Configuration Changes

```bash
# After adding or modifying servers, test existing presets
npx -y @1mcp/agent preset test development
npx -y @1mcp/agent preset test production

# Ensure presets still match expected servers
```

### Pre-deployment Validation

```bash
# Validate all presets before deploying configuration changes
for preset in $(npx -y @1mcp/agent preset list --format=names); do
  echo "Testing $preset..."
  npx -y @1mcp/agent preset test $preset
done
```

## Integration with Development Workflow

### After Server Changes

```bash
# 1. Modify server configuration (add/remove servers or tags)
npx -y @1mcp/agent mcp add newserver --type=stdio --tags=web,api

# 2. Test existing presets to see impact
npx -y @1mcp/agent preset test web-services

# 3. Update presets if needed
npx -y @1mcp/agent preset edit web-services
```

### Before Client Configuration

```bash
# 1. Test preset to ensure it matches expected servers
npx -y @1mcp/agent preset test production

# 2. Generate URL for client configuration
npx -y @1mcp/agent preset url production

# 3. Configure client with validated preset URL
```

## Error Handling

### Preset Not Found

```bash
npx -y @1mcp/agent preset test nonexistent
# Error: Preset 'nonexistent' not found
```

### Invalid Query Syntax

If a preset has syntax errors in its tag query:

```bash
npx -y @1mcp/agent preset test broken-preset
# Error: Invalid tag query syntax in preset 'broken-preset': unexpected token
```

### Server Configuration Issues

If there are problems with the server configuration:

```bash
npx -y @1mcp/agent preset test development
# Warning: Some servers in configuration have validation errors
# Matching servers: webserver (2 servers skipped due to errors)
```

## Performance Considerations

- **Fast execution**: Testing is performed in-memory against current configuration
- **No server startup**: Tests query validation without starting actual servers
- **Batch testing**: Can be run on multiple presets quickly for validation

## Validation Levels

### Query Syntax

- **Valid JSON**: Tag query must be syntactically correct JSON
- **Supported operators**: Must use supported query operators (`$and`, `$or`, `tag`)
- **Type safety**: Tag values must be strings

### Server Matching

- **Tag presence**: Referenced tags must exist in server configurations
- **Server availability**: Servers must be properly configured
- **Filter logic**: Query logic must produce consistent results

## See Also

- **[preset show](./show)** - Show detailed preset information including server matching
- **[preset create](./create)** - Create presets with specific tag criteria
- **[preset edit](./edit)** - Interactively modify presets based on test results
- **[mcp status](../mcp/status)** - Check overall server configuration health
