/**
 * Internal tool schemas for MCP installation operations
 *
 * This module contains schema definitions for MCP server installation,
 * uninstallation, and update management tools.
 */
import { z } from 'zod';

// ==================== INPUT SCHEMAS ====================

/**
 * Schema for mcp_install tool - Install MCP server
 */
export const McpInstallToolSchema = z.object({
  name: z.string().describe('Name for the MCP server configuration'),
  version: z.string().optional().describe('Version to install (latest if not specified)'),
  force: z.boolean().optional().default(false).describe('Force installation even if already exists'),
  backup: z.boolean().optional().default(true).describe('Create backup before installation'),
  tags: z.array(z.string()).optional().describe('Tags to assign to the server'),
  env: z.record(z.string(), z.string()).optional().describe('Environment variables for the server'),
  args: z.array(z.string()).optional().describe('Command line arguments for the server'),
  package: z.string().optional().describe('Package name (npm, pypi, or docker image)'),
  command: z.string().optional().describe('Command to run for stdio transport'),
  url: z.string().optional().describe('URL for HTTP/SSE transport'),
  transport: z.enum(['stdio', 'sse', 'http']).optional().default('stdio').describe('Transport type'),
  enabled: z.boolean().optional().default(true).describe('Enable server after installation'),
  autoRestart: z.boolean().optional().default(false).describe('Auto-restart server if it crashes'),

  // Enhanced prerequisite fields from registry data
  registryId: z.string().optional().describe('Full registry ID (e.g., io.github.user/server-name)'),
  installationMethod: z.enum(['package', 'remote']).optional().describe('Installation method preference'),

  // Prerequisite information (when known from registry)
  prerequisites: z
    .object({
      environmentVariables: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            isRequired: z.boolean().optional(),
            isSecret: z.boolean().optional(),
            defaultValue: z.string().optional(),
          }),
        )
        .optional()
        .describe('Required environment variables with descriptions'),

      packageArguments: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            isRequired: z.boolean().optional(),
            defaultValue: z.string().optional(),
            choices: z.array(z.string()).optional(),
          }),
        )
        .optional()
        .describe('Arguments needed for package installation'),

      runtimeArguments: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            isRequired: z.boolean().optional(),
            defaultValue: z.string().optional(),
            choices: z.array(z.string()).optional(),
          }),
        )
        .optional()
        .describe('Arguments needed at runtime'),

      dependencies: z
        .array(
          z.object({
            type: z.enum(['node', 'python', 'docker', 'system']),
            name: z.string(),
            version: z.string().optional(),
            description: z.string().optional(),
          }),
        )
        .optional()
        .describe('System dependencies required'),

      systemRequirements: z
        .object({
          os: z.array(z.string()).optional().describe('Supported operating systems'),
          architecture: z.array(z.string()).optional().describe('Supported architectures'),
          memory: z.string().optional().describe('Minimum memory requirement'),
        })
        .optional()
        .describe('System requirements'),
    })
    .optional()
    .describe('Prerequisites and requirements for installation'),
});

/**
 * Schema for mcp_uninstall tool - Remove MCP server
 */
export const McpUninstallToolSchema = z.object({
  name: z.string().describe('Name of the MCP server to remove'),
  preserveConfig: z.boolean().optional().default(false).describe('Preserve configuration but disable server'),
  force: z.boolean().optional().default(false).describe('Force removal even if server is in use'),
  graceful: z.boolean().optional().default(true).describe('Gracefully stop server before uninstalling'),
  backup: z.boolean().optional().default(true).describe('Create backup before uninstallation'),
  removeAll: z.boolean().optional().default(false).describe('Remove all related data and dependencies'),
});

/**
 * Schema for mcp_update tool - Update MCP server
 */
export const McpUpdateToolSchema = z.object({
  name: z.string().describe('Name of the MCP server to update'),
  version: z.string().optional().describe('Target version (latest if not specified)'),
  package: z.string().optional().describe('New package name if changing package'),
  autoRestart: z.boolean().optional().default(true).describe('Restart server after update'),
  backup: z.boolean().optional().default(true).describe('Backup current configuration before update'),
  force: z.boolean().optional().default(false).describe('Force update even if already latest version'),
  dryRun: z.boolean().optional().default(false).describe('Preview update without applying changes'),
});

// ==================== OUTPUT SCHEMAS ====================

/**
 * Output schema for mcp_install tool
 */
export const McpInstallOutputSchema = z.object({
  name: z.string().describe('Server name'),
  status: z.enum(['success', 'failed', 'exists']).describe('Installation status'),
  message: z.string().describe('Status message'),
  package: z.string().optional().describe('Package that was installed'),
  version: z.string().optional().describe('Installed version'),
  location: z.string().optional().describe('Installation location'),
  installedAt: z.string().optional().describe('Installation timestamp'),
  configPath: z.string().optional().describe('Configuration file path'),
  backupPath: z.string().optional().describe('Backup file path'),
  operationId: z.string().optional().describe('Operation ID for tracking'),
  warnings: z.array(z.string()).optional().describe('Installation warnings'),
  reloadRecommended: z.boolean().optional().describe('Whether config reload is recommended'),
  error: z.string().optional().describe('Error message if failed'),

  // Enhanced fields for LLM context
  registryId: z.string().optional().describe('Registry ID that was installed'),
  installationMethod: z.enum(['package', 'remote']).optional().describe('Installation method used'),
  prerequisites: z
    .object({
      environmentVariables: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            isRequired: z.boolean().optional(),
            isSecret: z.boolean().optional(),
            defaultValue: z.string().optional(),
          }),
        )
        .optional()
        .describe('Required environment variables with descriptions'),

      packageArguments: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            isRequired: z.boolean().optional(),
            defaultValue: z.string().optional(),
            choices: z.array(z.string()).optional(),
          }),
        )
        .optional()
        .describe('Arguments needed for package installation'),

      runtimeArguments: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            isRequired: z.boolean().optional(),
            defaultValue: z.string().optional(),
            choices: z.array(z.string()).optional(),
          }),
        )
        .optional()
        .describe('Arguments needed at runtime'),

      dependencies: z
        .array(
          z.object({
            type: z.enum(['node', 'python', 'docker', 'system']),
            name: z.string(),
            version: z.string().optional(),
            description: z.string().optional(),
          }),
        )
        .optional()
        .describe('System dependencies required'),

      systemRequirements: z
        .object({
          os: z.array(z.string()).optional().describe('Supported operating systems'),
          architecture: z.array(z.string()).optional().describe('Supported architectures'),
          memory: z.string().optional().describe('Minimum memory requirement'),
          transport: z.string().optional().describe('Transport type required'),
        })
        .optional()
        .describe('System requirements'),
    })
    .optional()
    .describe('Prerequisites and requirements for the installed server'),
});

/**
 * Output schema for mcp_uninstall tool
 */
export const McpUninstallOutputSchema = z.object({
  name: z.string().describe('Server name'),
  status: z.enum(['success', 'failed', 'not_found']).describe('Uninstallation status'),
  message: z.string().describe('Status message'),
  removed: z.boolean().optional().describe('Whether server was removed'),
  removedAt: z.string().optional().describe('Removal timestamp'),
  configRemoved: z.boolean().optional().describe('Whether configuration was removed'),
  gracefulShutdown: z.boolean().optional().describe('Whether graceful shutdown was performed'),
  operationId: z.string().optional().describe('Operation ID for tracking'),
  warnings: z.array(z.string()).optional().describe('Uninstallation warnings'),
  reloadRecommended: z.boolean().optional().describe('Whether config reload is recommended'),
  error: z.string().optional().describe('Error message if failed'),
});

/**
 * Output schema for mcp_update tool
 */
export const McpUpdateOutputSchema = z.object({
  name: z.string().describe('Server name'),
  status: z.enum(['success', 'failed', 'not_found', 'up_to_date']).describe('Update status'),
  message: z.string().describe('Status message'),
  previousVersion: z.string().optional().describe('Previous version'),
  newVersion: z.string().optional().describe('Updated version'),
  updatedAt: z.string().optional().describe('Update timestamp'),
  operationId: z.string().optional().describe('Operation ID for tracking'),
  warnings: z.array(z.string()).optional().describe('Update warnings'),
  reloadRecommended: z.boolean().optional().describe('Whether config reload is recommended'),
  error: z.string().optional().describe('Error message if failed'),
});

// ==================== TYPE EXPORTS ====================

// Zod-inferred types (existing pattern)
export type McpInstallToolArgs = z.infer<typeof McpInstallToolSchema>;
export type McpUninstallToolArgs = z.infer<typeof McpUninstallToolSchema>;
export type McpUpdateToolArgs = z.infer<typeof McpUpdateToolSchema>;

// Output types
export type McpInstallOutput = z.infer<typeof McpInstallOutputSchema>;
export type McpUninstallOutput = z.infer<typeof McpUninstallOutputSchema>;
export type McpUpdateOutput = z.infer<typeof McpUpdateOutputSchema>;
