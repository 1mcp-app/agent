# preset list

Display all available presets in a formatted table.

For a complete overview of preset management, see the **[Preset Commands Overview](./index)**.

## Synopsis

```bash
npx -y @1mcp/agent preset list
```

## Description

The `preset list` command displays all configured presets in a compact, organized table format. This provides a quick overview of your preset configurations, including names, strategies, query summaries, and usage information.

### Output Format

The command shows:

- **Header**: Total number of presets found
- **Table**: Organized columns with preset information
- **Quick Reference**: Available commands for preset management

### Table Columns

- **Name**: Preset identifier (truncated if longer than 16 characters)
- **Strategy**: Filtering approach (OR logic, AND logic, Advanced)
- **Query**: Tag query summary (truncated if longer than 33 characters)
- **Last Used**: Date when preset was last accessed (or "never")

## Examples

### Basic Usage

```bash
# List all presets
npx -y @1mcp/agent preset list
```

### Example Output

```
┌─────────────────────────────────────────────┐
│  📋 Available Presets                      │
│  Found 3 presets in your configuration     │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Name              Strategy   Query                               Last Used  │
│  ────────────────  ─────────  ──────────────────────────────────  ─────────  │
│  dev              OR logic   {"$or":[...                        never      │
│  production       Advanced  {"$and":[...                       never      │
│  staging          OR logic   {"tag":"staging"}                 9/6/2025   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Available Commands:                        │
│                                             │
│  • 1mcp preset show <name>         Show details   │
│  • 1mcp preset url <name>          Generate URL   │
│  • 1mcp preset edit <name>        Edit preset   │
│  • 1mcp preset test <name>         Test preset    │
│  • 1mcp preset delete <name>       Delete preset  │
└─────────────────────────────────────────────┘
```

## Understanding the Output

### Empty Configuration

If no presets exist, the command shows helpful guidance:

```
┌──── No Presets Available ─────┐
│   ⚠️  No presets found        │
└───────────────────────────────┘

Create your first preset with:
  1mcp preset create <name> --filter "web,api,database"
  1mcp preset
```

### Strategy Types

- **OR logic**: Matches servers with ANY selected tags
- **AND logic**: Matches servers with ALL selected tags
- **Advanced**: Uses custom JSON queries for complex filtering

### Query Truncation

Long queries are truncated with "..." to maintain table formatting. Use `preset show <name>` to see the complete query.

### Last Used Tracking

- **Date format**: MM/DD/YYYY when preset was last accessed
- **"never"**: Preset has not been used since creation

## Workflow Integration

The list command works well with other preset commands:

```bash
# 1. List all presets to see what's available
npx -y @1mcp/agent preset list

# 2. Show details for a specific preset
npx -y @1mcp/agent preset show production

# 3. Test a preset to see matching servers
npx -y @1mcp/agent preset test production

# 4. Generate URL for client configuration
npx -y @1mcp/agent preset url production
```

## Usage Tips

- **Regular review**: Use `preset list` to periodically review your preset configurations
- **Cleanup old presets**: Look for unused presets (showing "never" in Last Used column)
- **Quick scanning**: The table format makes it easy to compare strategies and identify presets
- **Follow up with details**: Use `preset show <name>` when you need complete information

## See Also

- **[preset show](./show)** - Show detailed preset information (full queries, matching servers)
- **[preset create](./create)** - Create new presets from command line
- **[Smart Interactive Mode](./)** - Create presets with interactive TUI
- **[preset delete](./delete)** - Remove unused presets
