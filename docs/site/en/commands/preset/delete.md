---
title: Preset Delete Command - Remove Presets
description: Remove presets from your configuration. Delete named presets that are no longer needed and clean up preset definitions.
head:
  - ['meta', { name: 'keywords', content: 'preset delete,delete preset,remove preset,cleanup presets,preset removal' }]
  - ['meta', { property: 'og:title', content: '1MCP Preset Delete Command Reference' }]
  - [
      'meta',
      { property: 'og:description', content: 'Remove presets from configuration and clean up preset definitions.' },
    ]
---

# preset delete

Remove a preset from your configuration.

For a complete overview of preset management, see the **[Preset Commands Overview](./index)**.

## Synopsis

```bash
npx -y @1mcp/agent preset delete <name>
```

## Arguments

- **`<name>`**
  - The name of the preset to delete.
  - **Required**: Yes

## Description

The `preset delete` command permanently removes a preset from your configuration. This is useful for cleaning up unused presets or removing outdated configurations.

### Safety Features

- **Confirmation prompt**: Asks for confirmation before deletion
- **Preset validation**: Verifies the preset exists before attempting deletion
- **Atomic operation**: Either deletes completely or fails without partial changes
- **Backup suggestion**: Reminds users about backup options for important presets

## Examples

### Basic Usage

```bash
# Delete a specific preset
npx -y @1mcp/agent preset delete old-staging

# Delete development preset
npx -y @1mcp/agent preset delete temp-dev
```

### Example Output

```bash
npx -y @1mcp/agent preset delete old-staging

⚠️  Delete preset 'old-staging'?
   This action cannot be undone.

   Preset details:
   • Strategy: OR logic
   • Created: 8/15/2025

? Are you sure? (y/N) y

✅ Preset 'old-staging' deleted successfully.
```

### Confirmation Declined

```bash
npx -y @1mcp/agent preset delete production

⚠️  Delete preset 'production'?
   This action cannot be undone.

   Preset details:
   • Strategy: Advanced
   • Created: 9/1/2025
   • Last used: 9/6/2025

? Are you sure? (y/N) n

❌ Deletion cancelled.
```

## Use Cases

### Configuration Cleanup

```bash
# Review unused presets
npx -y @1mcp/agent preset list

# Delete presets that show "never" in Last Used column
npx -y @1mcp/agent preset delete unused-preset
npx -y @1mcp/agent preset delete old-experiment
```

### Development Workflow

```bash
# Clean up temporary presets after testing
npx -y @1mcp/agent preset delete test-temp
npx -y @1mcp/agent preset delete debug-session
npx -y @1mcp/agent preset delete experiment-2024
```

### Team Environment Management

```bash
# Remove deprecated team presets
npx -y @1mcp/agent preset delete legacy-prod
npx -y @1mcp/agent preset delete old-team-config
```

## Safety Considerations

### Important Presets

Before deleting presets that are actively used:

1. **Check usage**: Review "Last Used" date in `preset list`
2. **Verify impact**: Ensure no team members depend on the preset
3. **Document changes**: Inform team about preset removal
4. **Consider renaming**: Instead of deletion, consider renaming for clarity

### Backup Strategy

```bash
# Export preset configuration before deletion (manual backup)
npx -y @1mcp/agent preset show important-preset > backup-important-preset.txt

# Then delete if needed
npx -y @1mcp/agent preset delete important-preset
```

## Error Handling

### Preset Not Found

```bash
npx -y @1mcp/agent preset delete nonexistent
# Error: Preset 'nonexistent' not found
```

### Permission Issues

If there are file system permission issues:

```bash
npx -y @1mcp/agent preset delete locked-preset
# Error: Unable to delete preset: Permission denied
```

### Configuration File Issues

If the preset configuration file is corrupted:

```bash
npx -y @1mcp/agent preset delete corrupted-preset
# Error: Unable to read preset configuration file
```

## Workflow Integration

### Regular Maintenance

```bash
# 1. Review all presets
npx -y @1mcp/agent preset list

# 2. Identify unused presets (Last Used: never, old dates)
# 3. Verify with team that presets are truly unused
# 4. Delete unused presets
npx -y @1mcp/agent preset delete unused-1
npx -y @1mcp/agent preset delete unused-2

# 5. Verify cleanup
npx -y @1mcp/agent preset list
```

### After Project Changes

```bash
# When project requirements change, remove obsolete presets
npx -y @1mcp/agent preset delete old-architecture
npx -y @1mcp/agent preset delete deprecated-stack
```

## Best Practices

### Before Deletion

1. **Verify preset usage**: Check if any team members are using the preset
2. **Document dependencies**: Ensure no automation scripts reference the preset
3. **Check client configurations**: Verify no MCP clients use the preset URL
4. **Consider archiving**: For important historical presets, export before deletion

### Bulk Deletion

For multiple presets, delete one at a time to maintain control:

```bash
# Avoid bulk deletion scripts - delete individually for safety
npx -y @1mcp/agent preset delete preset1
npx -y @1mcp/agent preset delete preset2
```

### Team Coordination

- **Communicate changes**: Inform team members before deleting shared presets
- **Update documentation**: Remove references to deleted presets in team docs
- **Provide alternatives**: Suggest replacement presets if available

## Recovery

### No Built-in Recovery

Once a preset is deleted, it cannot be recovered through the CLI. However:

1. **Manual Recreation**: Use `preset create` or `1mcp preset` to recreate
2. **Backup Files**: If you exported preset details beforehand
3. **Version Control**: If your configuration is version controlled
4. **Team Knowledge**: Other team members may have the same preset

### Prevention

```bash
# Export preset details before deletion for potential recovery
npx -y @1mcp/agent preset show critical-preset > critical-preset-backup.json
npx -y @1mcp/agent preset delete critical-preset
```

## See Also

- **[preset list](./list)** - Review presets before deletion
- **[preset show](./show)** - Export preset details for backup
- **[preset create](./create)** - Recreate deleted presets
- **[Smart Interactive Mode](./)** - Recreate deleted presets interactively
