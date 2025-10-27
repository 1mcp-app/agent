---
title: Preset Edit Command - Modify Existing Presets
description: Edit existing presets interactively with visual server selection. Modify filter expressions and server criteria using an intuitive interface.
head:
  - ['meta', { name: 'keywords', content: 'preset edit,edit preset,modify preset,interactive edit,visual selection' }]
  - ['meta', { property: 'og:title', content: '1MCP Preset Edit Command Reference' }]
  - [
      'meta',
      { property: 'og:description', content: 'Edit existing presets interactively with visual server selection.' },
    ]
---

# preset edit

Edit existing preset interactively with visual server selection.

For a complete overview of preset management, see the **[Preset Commands Overview](./index)**.

## Synopsis

```bash
npx -y @1mcp/agent preset edit <name> [options]
```

## Arguments

- **`<name>`**
  - Name of the preset to edit.
  - **Required**: Yes

## Options

- **`--description, -d <description>`**
  - Update description for the preset.
  - **Required**: No

## Description

The `preset edit` command provides an interactive Terminal User Interface (TUI) for modifying existing presets. This command loads an existing preset and allows you to visually modify server selections, strategies, and other settings.

### Features

- **Visual server selection** with three-state checkboxes (empty/selected/not-selected)
- **Live preview** of matching servers as you make selections
- **Strategy modification** (OR/AND/Advanced) with clear explanations
- **Back navigation** and comprehensive error handling
- **Description editing** - update preset descriptions during editing
- **Load existing configuration** - preserves current settings while allowing modifications

### Interactive Flow

1. **Preset Loading**: Loads the existing preset configuration
2. **Current Display**: Shows preset name, description, and current settings
3. **Strategy Selection**: Modify how tags should be matched:
   - **OR logic**: Servers with ANY of the selected tags
   - **AND logic**: Servers with ALL of the selected tags
   - **Advanced**: Custom JSON query for complex filtering
4. **Tag Selection**: Visual selection interface with:
   - Three-state selection (empty/included/excluded)
   - Server count for each tag
   - Live preview of matching servers
5. **Description Update**: Option to update the preset description
6. **Save and Confirmation**: Automatically saves back to the same preset name

## Examples

### Basic Preset Editing

```bash
# Edit development preset
npx -y @1mcp/agent preset edit development

# Edit production preset
npx -y @1mcp/agent preset edit production
```

### Edit with Description Update

```bash
# Edit preset and update description
npx -y @1mcp/agent preset edit staging --description "Updated staging environment with monitoring"
```

### Example Output

```bash
npx -y @1mcp/agent preset edit development

📁 Config directory: /Users/user/.config/1mcp

📝 Editing preset: development
   Description: Development servers

[Interactive TUI opens with current configuration loaded]

✅ Preset 'development' updated successfully!
🔗 URL: http://127.0.0.1:3050/?preset=development
```

## Interactive Mode Details

### Server Selection Interface

The interactive mode provides:

- **Three-state checkboxes**:
  - `[ ]` - Not selected (server excluded)
  - `[✓]` - Selected (server included)
  - `[-]` - Not selected (server excluded)

- **Real-time preview**: Shows which servers match your current selection
- **Tag statistics**: Displays server count for each tag
- **Strategy switching**: Change filtering logic on the fly

### Strategy Options

- **OR logic**: Include servers with ANY selected tags
- **AND logic**: Include servers with ALL selected tags
- **Advanced**: Use complex boolean expressions with parentheses

## Usage Tips

- **Review before editing**: Use `preset show <name>` to see current configuration
- **Test after changes**: Run `preset test <name>` to verify the updated preset works
- **Update descriptions**: Keep descriptions current when changing preset behavior
- **Use live preview**: Always check the preview to ensure your changes match expectations

## Error Handling

### Preset Not Found

```bash
npx -y @1mcp/agent preset edit nonexistent
# Error: Preset 'nonexistent' not found
```

### Configuration Issues

If the preset configuration is corrupted or inaccessible:

```bash
npx -y @1mcp/agent preset edit broken-preset
# Error: Failed to load preset 'broken-preset'
```

## Workflow Integration

### Development Workflow

```bash
# 1. Review current preset
npx -y @1mcp/agent preset show development

# 2. Edit preset to add new servers
npx -y @1mcp/agent preset edit development

# 3. Test updated preset
npx -y @1mcp/agent preset test development

# 4. Get updated URL for clients
npx -y @1mcp/agent preset url development
```

### Team Environment Management

```bash
# Update team presets when server configurations change
npx -y @1mcp/agent preset edit team-dev
npx -y @1mcp/agent preset edit team-prod
npx -y @1mcp/agent preset edit team-staging
```

## Comparison with Other Commands

### preset edit vs Smart Interactive Mode

- **`preset edit <name>`**: Direct editing workflow for existing presets
- **`1mcp preset`**: Smart mode that auto-detects existing presets and offers editing options

### preset edit vs preset create

- **`preset edit`**: Modifies existing presets with visual interface
- **`preset create`**: Creates new presets from command-line filter expressions

## Advanced Usage

### Complex Configuration Updates

```bash
# Edit preset to use AND logic instead of OR
npx -y @1mcp/agent preset edit production
# In interactive mode: switch strategy from OR to AND logic

# Edit preset to exclude experimental servers
npx -y @1mcp/agent preset edit development
# In interactive mode: select Advanced strategy and add NOT conditions
```

### Bulk Updates

```bash
# Update multiple presets with similar changes
for preset in dev staging prod; do
  echo "Editing $preset..."
  npx -y @1mcp/agent preset edit $preset
done
```

## Best Practices

### Before Editing

1. **Backup important presets**: Use `preset show <name>` to document current state
2. **Test current preset**: Run `preset test <name>` to establish baseline
3. **Check team dependencies**: Ensure no team members are actively using the preset
4. **Plan changes**: Know what servers/tags you want to add or remove

### During Editing

1. **Use live preview**: Always verify matching servers before saving
2. **Update descriptions**: Keep descriptions accurate when changing behavior
3. **Test strategies**: Try different filtering strategies to find optimal one
4. **Save frequently**: The interactive mode saves automatically when you exit

### After Editing

1. **Test the preset**: Verify it works as expected with `preset test <name>`
2. **Update team documentation**: Inform team members of significant changes
3. **Update client configurations**: Share new URLs if needed
4. **Monitor usage**: Check if the updated preset works well in practice

## See Also

- **[Smart Interactive Mode](./)** - Auto-detects existing presets and offers editing options
- **[preset show](./show)** - Show detailed preset information before editing
- **[preset test](./test)** - Test preset after making changes
- **[preset create](./create)** - Create new presets
- **[preset list](./list)** - List all available presets
