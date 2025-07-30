import { MCPServerParams } from '../../core/types/index.js';
import {
  serverExists,
  getServer,
  setServer,
  validateConfigPath,
  backupConfig,
  reloadMcpConfig,
} from './utils/configUtils.js';
import { validateServerName } from './utils/validation.js';

export interface EnableDisableCommandArgs {
  name: string;
  config?: string;
}

/**
 * Enable a disabled MCP server
 */
export async function enableCommand(argv: EnableDisableCommandArgs): Promise<void> {
  try {
    const { name, config: configPath } = argv;

    console.log(`Enabling MCP server: ${name}`);

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

    // Check if server is already enabled
    if (!currentConfig.disabled) {
      console.log(`Server '${name}' is already enabled.`);
      return;
    }

    // Create backup
    const backupPath = backupConfig(configPath);

    // Update configuration to enable the server
    const updatedConfig: MCPServerParams = {
      ...currentConfig,
      disabled: false,
    };

    // Remove the disabled property entirely if it's false (cleaner config)
    delete updatedConfig.disabled;

    // Save the updated configuration
    setServer(name, updatedConfig, configPath);

    // Reload MCP configuration
    reloadMcpConfig(configPath);

    // Success message
    console.log(`✅ Successfully enabled server '${name}'`);
    console.log(`   Status: Disabled → Enabled`);
    console.log(`   Backup created: ${backupPath}`);
    console.log(`\n💡 Server enabled. If 1mcp is running, the server will be started automatically.`);
  } catch (error) {
    console.error(`❌ Failed to enable server: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Disable an MCP server without removing it
 */
export async function disableCommand(argv: EnableDisableCommandArgs): Promise<void> {
  try {
    const { name, config: configPath } = argv;

    console.log(`Disabling MCP server: ${name}`);

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

    // Check if server is already disabled
    if (currentConfig.disabled) {
      console.log(`Server '${name}' is already disabled.`);
      return;
    }

    // Create backup
    const backupPath = backupConfig(configPath);

    // Update configuration to disable the server
    const updatedConfig: MCPServerParams = {
      ...currentConfig,
      disabled: true,
    };

    // Save the updated configuration
    setServer(name, updatedConfig, configPath);

    // Reload MCP configuration
    reloadMcpConfig(configPath);

    // Success message
    console.log(`✅ Successfully disabled server '${name}'`);
    console.log(`   Status: Enabled → Disabled`);
    console.log(`   Backup created: ${backupPath}`);
    console.log(`\n💡 Server disabled. If 1mcp is running, the server will be stopped automatically.`);
    console.log(`   Use 'server enable ${name}' to re-enable it later.`);
  } catch (error) {
    console.error(`❌ Failed to disable server: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
