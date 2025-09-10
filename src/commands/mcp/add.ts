import { MCPServerParams } from '../../core/types/index.js';
import {
  serverExists,
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
import { GlobalOptions } from '../../globalOptions.js';

export interface AddCommandArgs extends GlobalOptions {
  name: string;
  type?: string; // Will be validated as 'stdio' | 'http' | 'sse' (optional for " -- " pattern)
  command?: string;
  args?: string[];
  url?: string;
  env?: string[];
  tags?: string;
  timeout?: number;
  disabled?: boolean;
  cwd?: string;
  headers?: string[];
  restartOnExit?: boolean;
  maxRestarts?: number;
  restartDelay?: number;
}

/**
 * Add a new MCP server to the configuration
 */
export async function addCommand(argv: AddCommandArgs): Promise<void> {
  try {
    const { name, config: configPath, type, disabled = false } = argv;

    console.log(`Adding MCP server: ${name}`);

    // Validate inputs
    validateServerName(name);

    // Type is required either explicitly or inferred from " -- " pattern
    if (!type) {
      throw new Error('Server type must be specified with --type or inferred from " -- " pattern');
    }

    validateServerArgs(type, argv);
    validateEnvVars(argv.env);
    validateHeaders(argv.headers);
    validateTags(argv.tags);
    validateTimeout(argv.timeout);

    // Validate config path
    try {
      validateConfigPath(configPath);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        // If config file doesn't exist, we'll create it
        console.log('Configuration file not found, will create a new one');
      } else {
        throw error;
      }
    }

    // Check if server already exists
    if (serverExists(name, configPath)) {
      throw new Error(
        `Server '${name}' already exists. Use 'mcp update' to modify it or 'mcp remove' to delete it first.`,
      );
    }

    // Create backup if config file exists
    let backupPath: string | undefined;
    try {
      backupPath = backupConfig(configPath);
    } catch (_error) {
      // Config file might not exist yet, that's ok
      console.log('Creating new configuration file');
    }

    // Build server configuration
    const serverConfig: MCPServerParams = {
      type: type as 'stdio' | 'http' | 'sse',
      disabled,
    };

    // Add type-specific configuration
    switch (type as 'stdio' | 'http' | 'sse') {
      case 'stdio':
        if (!argv.command) {
          throw new Error('Command is required for stdio servers');
        }
        serverConfig.command = argv.command;
        if (argv.args && argv.args.length > 0) {
          serverConfig.args = argv.args;
        }
        if (argv.cwd) {
          serverConfig.cwd = argv.cwd;
        }
        if (argv.restartOnExit !== undefined) {
          serverConfig.restartOnExit = argv.restartOnExit;
        }
        if (argv.maxRestarts !== undefined) {
          serverConfig.maxRestarts = argv.maxRestarts;
        }
        if (argv.restartDelay !== undefined) {
          serverConfig.restartDelay = argv.restartDelay;
        }
        break;

      case 'http':
      case 'sse':
        if (!argv.url) {
          throw new Error(`URL is required for ${type} servers`);
        }
        serverConfig.url = argv.url;

        // Add headers if provided
        if (argv.headers && argv.headers.length > 0) {
          serverConfig.headers = parseHeaders(argv.headers);
        }
        break;
    }

    // Add common optional configuration
    if (argv.env && argv.env.length > 0) {
      serverConfig.env = parseEnvVars(argv.env);
    }

    if (argv.tags) {
      serverConfig.tags = parseTags(argv.tags);
    }

    if (argv.timeout !== undefined) {
      serverConfig.timeout = argv.timeout;
    }

    // Save the server configuration
    setServer(name, serverConfig, configPath);

    // Reload MCP configuration
    reloadMcpConfig(configPath);

    // Success message
    console.log(`✅ Successfully added server '${name}'`);
    console.log(`   Type: ${type}`);

    if (type === 'stdio') {
      console.log(`   Command: ${serverConfig.command}`);
      if (serverConfig.args) {
        console.log(`   Args: ${serverConfig.args.join(' ')}`);
      }
      if (serverConfig.cwd) {
        console.log(`   Working Directory: ${serverConfig.cwd}`);
      }
      if (serverConfig.restartOnExit) {
        console.log(`   Restart on Exit: Enabled`);
        if (serverConfig.maxRestarts !== undefined) {
          console.log(`   Max Restarts: ${serverConfig.maxRestarts}`);
        } else {
          console.log(`   Max Restarts: Unlimited`);
        }
        if (serverConfig.restartDelay !== undefined) {
          console.log(`   Restart Delay: ${serverConfig.restartDelay}ms`);
        } else {
          console.log(`   Restart Delay: 1000ms (default)`);
        }
      }
    } else {
      console.log(`   URL: ${serverConfig.url}`);
      if (serverConfig.headers) {
        console.log(`   Headers: ${Object.keys(serverConfig.headers).length} header(s)`);
      }
    }

    if (serverConfig.env) {
      console.log(`   Environment Variables: ${Object.keys(serverConfig.env).length} variable(s)`);
    }

    if (serverConfig.tags && serverConfig.tags.length > 0) {
      console.log(`   Tags: ${serverConfig.tags.join(', ')}`);
    }

    if (serverConfig.timeout) {
      console.log(`   Timeout: ${serverConfig.timeout}ms`);
    }

    if (disabled) {
      console.log(`   Status: Disabled (use 'mcp enable ${name}' to activate)`);
    } else {
      console.log(`   Status: Enabled`);
    }

    if (backupPath) {
      console.log(`   Backup created: ${backupPath}`);
    }

    console.log(`\n💡 Server added to configuration. If 1mcp is running, the new server will be loaded automatically.`);
  } catch (error) {
    console.error(`❌ Failed to add server: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
