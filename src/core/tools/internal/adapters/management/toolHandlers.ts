import { FlagManager } from '@src/core/flags/flagManager.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { McpEditOutput, McpEditOutputSchema, McpEditToolArgs } from '../../schemas/index.js';
import { createManagementAdapter } from './managementAdapter.js';
import { ManagementAdapter, ServerInfo } from './types.js';

/**
 * Preview changes that would be made to the server configuration
 */
async function previewChanges(
  serverName: string,
  editArgs: McpEditToolArgs,
  adapter: ManagementAdapter,
): Promise<Array<{ field: string; oldValue?: unknown; newValue?: unknown }>> {
  try {
    const changes: Array<{ field: string; oldValue?: unknown; newValue?: unknown }> = [];

    // Get current server configuration
    const serverList: ServerInfo[] = await adapter.listServers();
    const currentServer = serverList.find((server: ServerInfo) => server.name === serverName);

    if (!currentServer) {
      throw new Error(`Server '${serverName}' not found`);
    }

    const currentConfig = currentServer.config;

    // Check each editable field for changes
    const editableFields = [
      'newName',
      'tags',
      'disabled',
      'timeout',
      'connectionTimeout',
      'requestTimeout',
      'env',
      'command',
      'args',
      'cwd',
      'inheritParentEnv',
      'envFilter',
      'restartOnExit',
      'maxRestarts',
      'restartDelay',
      'url',
      'headers',
      'oauth',
    ];

    for (const field of editableFields) {
      if (field in editArgs) {
        const fieldName = field === 'newName' ? 'name' : field;
        const newValue = editArgs[field as keyof McpEditToolArgs];
        const oldValue = currentConfig[fieldName as keyof typeof currentConfig];

        // Only add change if the value is different
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          changes.push({
            field: fieldName,
            oldValue,
            newValue,
          });
        }
      }
    }

    return changes;
  } catch (error) {
    logger.error('Error previewing configuration changes', {
      error: error instanceof Error ? error.message : 'Unknown error',
      serverName,
    });
    throw error;
  }
}

/**
 * Internal tool handler for editing MCP server configurations
 */
export async function handleMcpEdit(args: McpEditToolArgs): Promise<McpEditOutput> {
  // Apply default values for optional operation control fields
  const normalizedArgs = {
    preview: args.preview ?? false,
    backup: args.backup ?? true,
    interactive: args.interactive ?? false,
    ...args,
  };

  try {
    debugIf(() => ({
      message: 'Executing mcp_edit tool',
      meta: { args: normalizedArgs },
    }));

    // Check if edit tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'edit', 'modify')) {
      const result = {
        success: false,
        message: 'MCP server editing is currently disabled by configuration',
        serverName: normalizedArgs.name,
        error: 'Edit tools are disabled',
      };
      return McpEditOutputSchema.parse(result);
    }

    const adapter = createManagementAdapter();

    // Validate configuration before making changes
    const validationResult = await adapter.validateServerConfig(normalizedArgs.name, normalizedArgs);
    if (!validationResult.valid) {
      const result = {
        success: false,
        message: `Configuration validation failed: ${validationResult.errors?.join(', ') || 'Unknown validation error'}`,
        serverName: normalizedArgs.name,
        error: validationResult.errors?.join(', ') || 'Validation failed',
      };
      return McpEditOutputSchema.parse(result);
    }

    // Handle preview mode
    if (normalizedArgs.preview) {
      const changes = await previewChanges(normalizedArgs.name, normalizedArgs, adapter);
      const result = {
        success: true,
        message: `Preview of changes for server '${normalizedArgs.name}' configuration`,
        serverName: normalizedArgs.name,
        preview: true,
        changes,
      };
      return McpEditOutputSchema.parse(result);
    }

    // Apply changes with backup if requested
    let backupPath: string | undefined;
    if (normalizedArgs.backup) {
      // Backup would be handled by the adapter
      debugIf(() => ({
        message: 'Creating backup before editing server configuration',
        meta: { serverName: normalizedArgs.name, backup: normalizedArgs.backup },
      }));
    }

    // Execute the configuration update
    const updateResult = await adapter.updateServerConfig(normalizedArgs.name, normalizedArgs);

    // Transform to match expected output schema
    const structuredResult = {
      success: updateResult.success,
      message: updateResult.success
        ? `MCP server '${updateResult.serverName}' configuration updated successfully`
        : `Failed to update server configuration: ${updateResult.errors?.join(', ') || 'Unknown error'}`,
      serverName: updateResult.serverName,
      changes: updateResult.changes,
      preview: false,
      backupPath: updateResult.backupPath || backupPath,
      warnings: updateResult.warnings,
      reloadRecommended: updateResult.success,
      error: updateResult.success ? undefined : updateResult.errors?.join(', '),
    };

    return McpEditOutputSchema.parse(structuredResult);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_edit tool handler', { error: errorMessage, serverName: normalizedArgs.name });

    const result = {
      success: false,
      message: `Edit operation failed: ${errorMessage}`,
      serverName: normalizedArgs.name,
      error: errorMessage,
    };

    return McpEditOutputSchema.parse(result);
  }
}
