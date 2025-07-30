import { MCPServerParams } from '../../core/types/index.js';
import {
  serverExists,
  getServer,
  setServer,
  parseEnvVars,
  parseHeaders,
  parseTags,
  validateConfigPath,
  backupConfig,
  reloadMcpConfig,
} from './utils/configUtils.js';
import {
  validateServerName,
  validateServerArgs,
  validateEnvVars,
  validateHeaders,
  validateTags,
  validateTimeout,
} from './utils/validation.js';

export interface UpdateCommandArgs {
  name: string;
  config?: string;
  type?: string; // Will be validated as 'stdio' | 'http' | 'sse'
  command?: string;
  args?: string[];
  url?: string;
  env?: string[];
  tags?: string;
  timeout?: number;
  cwd?: string;
  headers?: string[];
}

/**
 * Update an existing MCP server configuration
 */
export async function updateCommand(argv: UpdateCommandArgs): Promise<void> {
  try {
    const { name, config: configPath } = argv;

    console.log(`Updating MCP server: ${name}`);

    // Validate inputs
    validateServerName(name);

    // Validate config path
    validateConfigPath(configPath);

    // Check if server exists
    if (!serverExists(name, configPath)) {
      throw new Error(`Server '${name}' does not exist. Use 'server add' to create it first.`);
    }

    // Get current server configuration
    const currentConfig = getServer(name, configPath);
    if (!currentConfig) {
      throw new Error(`Failed to retrieve server '${name}' configuration.`);
    }

    // Create updated configuration starting from current config
    const updatedConfig: MCPServerParams = { ...currentConfig };

    // Track changes for reporting
    const changes: string[] = [];

    // Update type if provided
    if (argv.type !== undefined && argv.type !== currentConfig.type) {
      // Validate the new type with provided args
      validateServerArgs(argv.type, argv);

      updatedConfig.type = argv.type as 'stdio' | 'http' | 'sse';
      changes.push(`type: ${currentConfig.type} → ${argv.type}`);

      // Clear type-specific properties when changing type
      if (currentConfig.type === 'stdio' && (argv.type === 'http' || argv.type === 'sse')) {
        // Switching from stdio to HTTP/SSE
        delete updatedConfig.command;
        delete updatedConfig.args;
        delete updatedConfig.cwd;
        if (!argv.url) {
          throw new Error(`URL is required when changing to ${argv.type} server`);
        }
      } else if ((currentConfig.type === 'http' || currentConfig.type === 'sse') && argv.type === 'stdio') {
        // Switching from HTTP/SSE to stdio
        delete updatedConfig.url;
        delete updatedConfig.headers;
        if (!argv.command) {
          throw new Error('Command is required when changing to stdio server');
        }
      }
    }

    // Update type-specific properties
    const effectiveType = updatedConfig.type as 'stdio' | 'http' | 'sse';

    if (effectiveType === 'stdio') {
      if (argv.command !== undefined) {
        if (argv.command !== currentConfig.command) {
          changes.push(`command: ${currentConfig.command || '(none)'} → ${argv.command}`);
        }
        updatedConfig.command = argv.command;
      }

      if (argv.args !== undefined) {
        const oldArgs = currentConfig.args || [];
        const newArgs = argv.args;
        if (JSON.stringify(oldArgs) !== JSON.stringify(newArgs)) {
          changes.push(`args: [${oldArgs.join(', ')}] → [${newArgs.join(', ')}]`);
        }
        updatedConfig.args = newArgs.length > 0 ? newArgs : undefined;
      }

      if (argv.cwd !== undefined) {
        if (argv.cwd !== currentConfig.cwd) {
          changes.push(`cwd: ${currentConfig.cwd || '(none)'} → ${argv.cwd}`);
        }
        updatedConfig.cwd = argv.cwd;
      }
    } else if (effectiveType === 'http' || effectiveType === 'sse') {
      if (argv.url !== undefined) {
        if (argv.url !== currentConfig.url) {
          changes.push(`url: ${currentConfig.url || '(none)'} → ${argv.url}`);
        }
        updatedConfig.url = argv.url;
      }

      if (argv.headers !== undefined) {
        validateHeaders(argv.headers);
        const newHeaders = argv.headers.length > 0 ? parseHeaders(argv.headers) : undefined;
        const oldHeaders = currentConfig.headers;

        if (JSON.stringify(oldHeaders) !== JSON.stringify(newHeaders)) {
          const oldCount = oldHeaders ? Object.keys(oldHeaders).length : 0;
          const newCount = newHeaders ? Object.keys(newHeaders).length : 0;
          changes.push(`headers: ${oldCount} header(s) → ${newCount} header(s)`);
        }
        updatedConfig.headers = newHeaders;
      }
    }

    // Update common properties
    if (argv.env !== undefined) {
      validateEnvVars(argv.env);
      const newEnv = argv.env.length > 0 ? parseEnvVars(argv.env) : undefined;
      const oldEnv = currentConfig.env;

      if (JSON.stringify(oldEnv) !== JSON.stringify(newEnv)) {
        const oldCount = oldEnv ? Object.keys(oldEnv).length : 0;
        const newCount = newEnv ? Object.keys(newEnv).length : 0;
        changes.push(`env: ${oldCount} variable(s) → ${newCount} variable(s)`);
      }
      updatedConfig.env = newEnv;
    }

    if (argv.tags !== undefined) {
      validateTags(argv.tags);
      const newTags = argv.tags ? parseTags(argv.tags) : undefined;
      const oldTags = currentConfig.tags;

      if (JSON.stringify(oldTags) !== JSON.stringify(newTags)) {
        const oldTagsStr = oldTags ? oldTags.join(', ') : '(none)';
        const newTagsStr = newTags ? newTags.join(', ') : '(none)';
        changes.push(`tags: ${oldTagsStr} → ${newTagsStr}`);
      }
      updatedConfig.tags = newTags;
    }

    if (argv.timeout !== undefined) {
      validateTimeout(argv.timeout);
      if (argv.timeout !== currentConfig.timeout) {
        changes.push(`timeout: ${currentConfig.timeout || '(none)'}ms → ${argv.timeout}ms`);
      }
      updatedConfig.timeout = argv.timeout;
    }

    // Check if any changes were made
    if (changes.length === 0) {
      console.log(`No changes specified for server '${name}'. Configuration remains unchanged.`);
      return;
    }

    // Final validation of the complete updated configuration
    if (updatedConfig.type === 'stdio' && !updatedConfig.command) {
      throw new Error('Command cannot be empty for stdio servers');
    }
    if ((updatedConfig.type === 'http' || updatedConfig.type === 'sse') && !updatedConfig.url) {
      throw new Error(`URL cannot be empty for ${updatedConfig.type} servers`);
    }

    // Create backup
    const backupPath = backupConfig(configPath);

    // Save the updated configuration
    setServer(name, updatedConfig, configPath);

    // Reload MCP configuration
    reloadMcpConfig(configPath);

    // Success message
    console.log(`✅ Successfully updated server '${name}'`);
    console.log(`   Changes made:`);
    for (const change of changes) {
      console.log(`     • ${change}`);
    }
    console.log(`   Backup created: ${backupPath}`);
    console.log(`\n💡 Server configuration updated. If 1mcp is running, the server will be reloaded automatically.`);
  } catch (error) {
    console.error(`❌ Failed to update server: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
