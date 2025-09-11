# preset show

Display detailed information about a specific preset.

For a complete overview of preset management, see the **[Preset Commands Overview](./index)**.

## Synopsis

```bash
npx -y @1mcp/agent preset show <name>
```

## Arguments

- **`<name>`**
  - The name of the preset to display details for.
  - **Required**: Yes

## Description

The `preset show` command provides comprehensive information about a specific preset in a single, organized display. This complements the compact `preset list` table by showing complete details without truncation.

### Information Displayed

- **Basic Information**: Name, strategy, description, creation date, last used
- **Client URL**: Ready-to-use URL for MCP client configuration
- **Tag Query**: Complete JSON query with proper formatting (no truncation)
- **Server Matching**: Which servers match the preset criteria
- **Quick Actions**: Common related commands for the preset

## Examples

### Basic Usage

```bash
# Show details for a specific preset
npx -y @1mcp/agent preset show development

# Show production preset information
npx -y @1mcp/agent preset show production
```

### Example Output

```
┌─────────── Preset Details ────────────┐
│ 📋 development                        │
│ Strategy: OR logic - Match ANY tags   │
│ Description: Development servers      │
│ Created: 9/6/2025                     │
│ Last Used: Never                      │
│                                       │
│ Client URL:                           │
│ http://127.0.0.1:3050/?preset=dev     │
│                                       │
│ Tag Query:                            │
│ {                                     │
│   "$or": [                            │
│     { "tag": "web" },                 │
│     { "tag": "api" }                  │
│   ]                                   │
│ }                                     │
│                                       │
│ Matching Servers (2):                 │
│ • webserver, • apiserver              │
│                                       │
│ Quick Actions:                        │
│ • Test: preset test development       │
│ • Edit: 1mcp preset edit dev         │
│ • URL:  preset url development        │
└───────────────────────────────────────┘
```

## Information Sections

### Basic Information

- **Name**: Preset identifier
- **Strategy**: Human-readable strategy description
- **Description**: Optional user-provided description
- **Created**: When the preset was first created
- **Last Used**: When the preset was last accessed (or "Never")

### Client URL

The generated URL for configuring MCP clients:

- **Format**: `http://host:port/?preset=name`
- **Usage**: Copy this URL into your MCP client configuration
- **Dynamic**: Automatically resolves to the appropriate server subset

### Tag Query

Complete JSON representation of the filtering criteria:

- **No truncation**: Full query displayed with proper formatting
- **Syntax highlighting**: JSON structure is clearly formatted
- **Strategy mapping**: Shows how your selections translate to queries

### Server Matching

Real-time results of applying the preset to your current configuration:

- **Matching count**: Number of servers that match the criteria
- **Server list**: Names of matching servers (or "No servers match")
- **Live results**: Based on your current server configuration

### Quick Actions

Convenient commands related to this preset:

- **Test**: `preset test <name>` - Validate server matching
- **Edit**: `1mcp preset edit <name>` - Modify the preset
- **URL**: `preset url <name>` - Get just the client URL

## Use Cases

### Development Workflow

```bash
# Review preset before using
npx -y @1mcp/agent preset show development

# Copy the Client URL for your MCP client configuration
# Use the Matching Servers info to verify correct servers are included
```

### Team Collaboration

```bash
# Share preset details with team members
npx -y @1mcp/agent preset show team-production

# Team members can see exact configuration and matching servers
```

### Troubleshooting

```bash
# Debug why a preset isn't working as expected
npx -y @1mcp/agent preset show problematic-preset

# Check the Tag Query section for syntax issues
# Review Matching Servers to see actual results
```

## Error Handling

### Preset Not Found

```bash
npx -y @1mcp/agent preset show nonexistent
# Error: Preset 'nonexistent' not found
```

### Invalid Preset

If a preset exists but has validation issues, the command shows error details in the Matching Servers section.

## Workflow Integration

Common usage patterns:

```bash
# 1. List presets to see available options
npx -y @1mcp/agent preset list

# 2. Show detailed info for a specific preset
npx -y @1mcp/agent preset show staging

# 3. Test the preset if needed
npx -y @1mcp/agent preset test staging

# 4. Use the Client URL in your MCP client
```

## See Also

- **[preset list](./list)** - Overview of all presets in table format
- **[preset test](./test)** - Test preset server matching with additional details
- **[preset url](./url)** - Get just the client URL for a preset
- **[preset edit](./edit)** - Edit preset with interactive TUI
