# preset create

Command-line preset creation using filter expressions.

For a complete overview of preset management, see the **[Preset Commands Overview](./index)**.

## Synopsis

```bash
npx -y @1mcp/agent preset create <name> --filter <expression> [options]
```

## Arguments

- **`<name>`**
  - A unique name for the new preset.
  - **Required**: Yes
  - **Format**: Letters, numbers, hyphens, and underscores only

## Options

- **`--filter, -f <expression>`**
  - Filter expression for server selection.
  - **Required**: Yes
  - **Format**: Simple comma-separated or complex boolean expressions

- **`--description, -d <description>`**
  - Optional description for the preset.
  - **Required**: No

## Description

The `preset create` command allows you to create presets quickly from the command line using filter expressions. This is ideal for automation, scripting, and users who know exactly which servers they want to include.

### Filter Expression Formats

#### Simple (Comma-separated = OR logic)

```bash
--filter "web,api,database"
# Matches servers with web OR api OR database tags
```

#### Boolean Expressions

```bash
# AND logic
--filter "web AND database"

# Complex expressions with parentheses
--filter "(web OR api) AND database AND NOT experimental"

# Multi-condition grouping
--filter "(frontend OR backend) AND (dev OR staging)"
```

#### Expression Operators

- **`,`** (comma): OR logic (simple format only)
- **`AND`**: All conditions must match
- **`OR`**: Any condition can match
- **`NOT`**: Exclude matching servers
- **`()`**: Group conditions for precedence

## Examples

### Simple OR Filters

```bash
# Development servers with web, api, or database
npx -y @1mcp/agent preset create development --filter "web,api,database"

# Testing servers
npx -y @1mcp/agent preset create testing --filter "test,staging,qa"
```

### AND Logic Filters

```bash
# Production servers with both web and database
npx -y @1mcp/agent preset create production --filter "web AND database"

# Monitored web services
npx -y @1mcp/agent preset create monitored-web --filter "web AND monitoring"
```

### Complex Boolean Expressions

```bash
# Secure production environment
npx -y @1mcp/agent preset create secure-prod \
  --filter "web AND database AND NOT experimental" \
  --description "Production servers excluding experimental features"

# Cross-functional development team
npx -y @1mcp/agent preset create fullstack-dev \
  --filter "(frontend OR backend) AND development"

# Multi-environment with exclusions
npx -y @1mcp/agent preset create staging-safe \
  --filter "(staging OR test) AND NOT deprecated"
```

### With Descriptions

```bash
# Add meaningful descriptions for team sharing
npx -y @1mcp/agent preset create team-prod \
  --filter "web AND database AND monitoring" \
  --description "Team production environment with full monitoring"
```

## Filter Expression Reference

### Tag Matching

```bash
# Single tag
"web"

# Multiple tags (OR)
"web,api,database"
"web OR api OR database"  # equivalent
```

### Logical Operations

```bash
# AND - all must match
"web AND database"

# OR - any can match
"web OR api"

# NOT - exclude matches
"web AND NOT experimental"
```

### Grouping with Parentheses

```bash
# Group OR operations
"(web OR api) AND database"

# Complex grouping
"(frontend AND web) OR (backend AND api)"

# Multi-level grouping
"(web OR api) AND (prod OR staging) AND NOT deprecated"
```

## Strategy Mapping

The command automatically maps filter expressions to preset strategies:

- **Simple tags** (`"web"`) → `tag` strategy
- **Comma-separated** (`"web,api"`) → `OR` strategy
- **Boolean expressions** (`"web AND api"`) → `advanced` strategy

## Usage Tips

- **Quote expressions**: Always wrap complex filter expressions in quotes
- **Test first**: Use `preset test <name>` after creation to verify server matching
- **Descriptive names**: Use clear, descriptive preset names for team collaboration
- **Start simple**: Begin with simple comma-separated filters, then move to complex expressions

## Error Handling

Common errors and solutions:

```bash
# Invalid characters in name
Error: Preset name can only contain letters, numbers, hyphens, and underscores

# Invalid filter syntax
Error: Invalid filter expression: unexpected token 'XYZ'

# Empty filter
Error: Filter expression cannot be empty
```

## See Also

- **[Smart Interactive Mode](./)** - Interactive TUI-based preset creation
- **[preset list](./list)** - List all available presets
- **[preset show](./show)** - Show detailed preset information
- **[preset test](./test)** - Test preset server matching
- **[preset url](./url)** - Generate preset URL for client configuration
