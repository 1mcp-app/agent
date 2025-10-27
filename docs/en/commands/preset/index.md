---
title: Preset Commands Overview - Dynamic Configuration Management
description: Complete overview of preset commands for dynamic server configuration management. Create, switch, and manage named server presets in 1MCP.
head:
  - [
      'meta',
      {
        name: 'keywords',
        content: 'preset commands,configuration management,server presets,dynamic configuration,MCP contexts',
      },
    ]
  - ['meta', { property: 'og:title', content: '1MCP Preset Commands - Dynamic Configuration' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Complete overview of preset commands for dynamic server configuration management.',
      },
    ]
---

# Preset Commands

Preset commands provide a powerful system for managing server configurations dynamically. Create named presets that define server selection criteria, then use them to switch server contexts without reconfiguring your MCP clients.

## Overview

Preset commands allow you to:

- **Create named configurations** for different server contexts (development, production, testing)
- **Switch server contexts dynamically** using URL query parameters
- **Share team configurations** through preset URLs
- **Maintain flexible server selection** with tag-based filtering

## Quick Reference

```bash
# Smart interactive mode (auto-detects existing presets)
1mcp preset                              # Create new or edit existing
1mcp preset edit development              # Edit existing preset

# Command-line preset creation
1mcp preset create dev --filter "web,api,database"
1mcp preset create prod --filter "web AND database AND monitoring"

# Preset management
1mcp preset list                        # List all presets
1mcp preset show development            # Show detailed preset info
1mcp preset url development             # Generate client URL
1mcp preset test development            # Test server matching
1mcp preset delete old-preset           # Remove preset
```

## Core Concepts

### Presets

A preset is a saved configuration that defines which servers should be available in a specific context. Each preset contains:

- **Name**: Unique identifier for the preset
- **Strategy**: How tags should be matched (OR, AND, or Advanced)
- **Tag Query**: The filtering criteria for server selection
- **Description**: Optional human-readable description

### Tag-Based Filtering

Servers can be tagged in your configuration, and presets use these tags to determine which servers to include:

```json
{
  "myserver": {
    "command": "node",
    "args": ["server.js"],
    "tags": ["web", "api", "development"]
  }
}
```

### Dynamic Switching

Once created, presets can be used via URL query parameters:

- `http://localhost:3050/?preset=development` - Use development servers
- `http://localhost:3050/?preset=production` - Use production servers
- `http://localhost:3050/` - Use all servers (no preset)

## Commands

### [Smart Interactive Mode](./) (no subcommand)

Smart interactive mode that auto-detects existing presets and offers options to create new or edit existing ones.

```bash
1mcp preset                              # Auto-detects and offers options
```

### [edit](./edit)

Edit existing preset interactively with visual server selection.

```bash
1mcp preset edit development              # Edit existing preset
```

### [create](./create)

Command-line preset creation using filter expressions.

```bash
1mcp preset create dev --filter "web,api,database"
1mcp preset create prod --filter "web AND database AND monitoring"
```

### [list](./list)

Display all available presets in a formatted table.

```bash
1mcp preset list
```

### [show](./show)

Display detailed information about a specific preset.

```bash
1mcp preset show development
```

### [url](./url)

Generate the client URL for a preset.

```bash
1mcp preset url development
```

### [test](./test)

Test a preset against your current server configuration.

```bash
1mcp preset test development
```

### [delete](./delete)

Remove a preset from your configuration.

```bash
1mcp preset delete old-staging
```

## Usage Workflows

### Interactive Workflow (TUI-based)

Best for users who prefer visual selection and exploration:

1. **Smart interactive mode**: `1mcp preset` - Auto-detects existing presets
2. **Direct editing**: `1mcp preset edit development` - Edit existing presets
3. **Visual server selection** with three-state checkboxes
4. **Choose strategy** (OR/AND/Advanced) with live preview
5. **Save and get URL** for client configuration

### Command-Line Workflow

Best for automation and quick preset creation:

1. **Create preset**: `1mcp preset create dev --filter "web,api"`
2. **Generate URL**: `1mcp preset url dev`
3. **Configure client** with generated URL
4. **Test preset**: `1mcp preset test dev`
5. **List presets**: `1mcp preset list`

### Team Sharing Workflow

Share preset configurations across team members:

1. **Create team presets**:

   ```bash
   1mcp preset create team-dev --filter "web,api,database"
   1mcp preset create team-prod --filter "web,database,monitoring"
   ```

2. **Share URLs** with team:

   ```bash
   1mcp preset url team-dev
   # Share: http://localhost:3050/?preset=team-dev
   ```

3. **Team members configure clients** with shared URLs
4. **Switch contexts** by changing URL parameters

## Advanced Usage

### Complex Filter Expressions

Create sophisticated server selection rules:

```bash
# Multi-environment with exclusions
1mcp preset create secure-dev --filter "(web OR api) AND development AND NOT experimental"

# Cross-functional team preset
1mcp preset create fullstack --filter "(frontend AND web) OR (backend AND api) OR (database AND persistence)"

# Environment-specific with monitoring
1mcp preset create prod-monitored --filter "production AND (web OR api) AND monitoring"
```

### Smart Interactive Mode

The most powerful approach for preset management:

```bash
# Smart mode - auto-detects existing presets and offers options
1mcp preset

# When no subcommand is provided:
# 1. Shows config directory path
# 2. Detects existing presets
# 3. Offers menu: Edit existing, Create new, or Cancel
# 4. Loads existing preset for editing or creates new one
# 5. Interactive server selection with TUI
# 6. Automatic saving with generated URL
```

### URL Configuration Examples

Use presets in different MCP client configurations:

**Claude Desktop (`claude_desktop_config.json`):**

```json
{
  "mcpServers": {
    "1mcp-development": {
      "command": "npx",
      "args": ["-y", "@1mcp/agent", "serve"],
      "env": {
        "ONE_MCP_PRESET_URL": "http://localhost:3050/?preset=development"
      }
    }
  }
}
```

**Cursor/VS Code:**

```json
{
  "mcp.servers": {
    "1mcp-production": {
      "url": "http://localhost:3050/?preset=production"
    }
  }
}
```

### Preset Management Best Practices

1. **Use descriptive names**: `web-dev`, `prod-api`, `staging-full`
2. **Add descriptions** for complex presets
3. **Test presets** before sharing: `1mcp preset test <name>`
4. **Regular cleanup**: Remove unused presets
5. **Document team presets** in shared documentation

## Integration

### Server Tagging

Tag your servers for effective preset filtering:

```json
{
  "webserver": {
    "command": "mcp-server-web",
    "tags": ["web", "frontend", "development"]
  },
  "database": {
    "command": "mcp-server-db",
    "tags": ["database", "persistence", "production"]
  },
  "monitoring": {
    "command": "mcp-server-monitor",
    "tags": ["monitoring", "observability", "production"]
  }
}
```

### HTTP Middleware

Presets work through built-in HTTP middleware that:

1. Extracts `?preset=name` from request URLs
2. Resolves preset to tag query using PresetManager
3. Filters available servers based on tag matching
4. Falls back to all servers if preset not found

### Client Configuration

Configure your MCP clients once with preset URLs, then switch contexts by changing the preset parameter without client restart.

## Troubleshooting

### Common Issues

**Preset not found**: Check preset name spelling with `1mcp preset list`

**No servers match**: Use `1mcp preset test <name>` to see matching results

**Invalid filter expression**: Check filter syntax - use quotes for complex expressions

**URL not working**: Verify server is running and preset exists

### Debug Commands

```bash
# List all presets
1mcp preset list

# Show detailed preset info
1mcp preset show <name>

# Test preset matching
1mcp preset test <name>

# Check server configuration
1mcp mcp status
```
