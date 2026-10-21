---
title: Preset List Command - Display All Presets
description: Display all available presets in a formatted table. View preset names, descriptions, and server selection criteria at a glance.
head:
  - [
      'meta',
      { name: 'keywords', content: 'preset list,list presets,display presets,preset overview,available presets' },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Preset List Command Reference' }]
  - ['meta', { property: 'og:description', content: 'Display all available presets in a formatted table view.' }]
---

# preset list

Display all available presets in a formatted table.

For a complete overview of preset management, see the **[Preset Commands Overview](/commands/preset/)**.

## Synopsis

```bash
1mcp preset list
```

## Global Options

This command supports all global options:

- **`--config, -c <path>`** - Specify configuration file path
- **`--config-dir, -d <path>`** - Path to the config directory

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

## Examples

### Basic Usage

```bash
# List all presets
1mcp preset list
```

### Example Output

```
┌─────────────────────────────────────────────┐
│  📋 Available Presets                      │
│  Found 3 presets in your configuration     │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Name              Strategy   Query                               │
│  ────────────────  ─────────  ──────────────────────────────────  │
│  dev              OR logic   {"$or":[...                        │
│  production       Advanced  {"$and":[...                       │
│  staging          OR logic   {"tag":"staging"}                 │
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

## Workflow Integration

The list command works well with other preset commands:

```bash
# 1. List all presets to see what's available
1mcp preset list

# 2. Show details for a specific preset
1mcp preset show production

# 3. Test a preset to see matching servers
1mcp preset test production

# 4. Generate URL for client configuration
1mcp preset url production
```

## Usage Tips

- **Regular review**: Use `preset list` to periodically review your preset configurations
- **Quick scanning**: The table format makes it easy to compare strategies and identify presets
- **Follow up with details**: Use `preset show <name>` when you need complete information

## See Also

- **[preset show](/commands/preset/show)** - Show detailed preset information (full queries, matching servers)
- **[preset create](/commands/preset/create)** - Create new presets from command line
- **[Smart Interactive Mode](/commands/preset/)** - Create presets with interactive TUI
- **[preset delete](/commands/preset/delete)** - Remove unused presets
