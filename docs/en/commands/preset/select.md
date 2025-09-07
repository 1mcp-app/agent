# preset select

Interactive TUI-based preset creation and editing with visual server selection.

For a complete overview of preset management, see the **[Preset Commands Overview](./index)**.

## Synopsis

```bash
# Create new preset interactively
npx -y @1mcp/agent preset select --save <name> [options]

# Edit existing preset
npx -y @1mcp/agent preset select --load <name> [options]
```

## Options

- **`--save <name>`**
  - Save new preset with specified name after selection.
  - **Required**: No (but either --save or --load must be specified)

- **`--load <name>`**
  - Load and edit existing preset with specified name.
  - **Required**: No (but either --save or --load must be specified)

- **`--url`**
  - Show generated URL after saving preset.
  - **Required**: No

## Description

The `preset select` command provides an interactive Terminal User Interface (TUI) for creating and editing presets. This is the recommended approach for users who prefer visual selection and want to explore available servers and tags interactively.

### Features

- **Visual server selection** with three-state checkboxes (empty/selected/not-selected)
- **Live preview** of matching servers as you make selections
- **Strategy selection** (OR/AND/Advanced) with clear explanations
- **Back navigation** and comprehensive error handling
- **Tag-based filtering** with server count indicators

### Interactive Flow

1. **Strategy Selection**: Choose how tags should be matched:
   - **OR logic**: Servers with ANY of the selected tags
   - **AND logic**: Servers with ALL of the selected tags
   - **Advanced**: Custom JSON query for complex filtering

2. **Tag Selection**: Visual selection interface with:
   - Three-state selection (empty/included/excluded)
   - Server count for each tag
   - Live preview of matching servers

3. **Preview and Confirmation**: Review your selection before saving

## Examples

### Create New Preset

```bash
# Basic preset creation
npx -y @1mcp/agent preset select --save development

# Create preset and show URL immediately
npx -y @1mcp/agent preset select --save staging --url
```

### Edit Existing Preset

```bash
# Load and modify existing preset
npx -y @1mcp/agent preset select --load development

# Load existing preset and show URL after changes
npx -y @1mcp/agent preset select --load production --url
```

## Usage Tips

- **Explore first**: Use the interactive interface to understand your available servers and tags before creating presets
- **Preview results**: Always check the live preview to ensure your selection matches expectations
- **Use descriptions**: Add meaningful descriptions when prompted to help identify presets later
- **Test after creation**: Run `preset test <name>` to verify your preset works as expected

## See Also

- **[preset create](./create)** - Command-line preset creation with filter expressions
- **[preset list](./list)** - List all available presets
- **[preset show](./show)** - Show detailed preset information
- **[preset test](./test)** - Test preset server matching
