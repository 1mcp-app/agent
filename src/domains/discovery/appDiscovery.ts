import fs from 'fs';

import { getAppConfigPaths, getAppPreset, isAppConfigurable } from '@src/domains/discovery/appPresets.js';

import JSON5 from 'json5';

/**
 * Desktop application configuration discovery and validation.
 *
 * Handles multi-location config file discovery, parsing, and validation
 * for supported desktop applications.
 */

export interface MCPServerConfig {
  name: string;
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ConfigDiscovery {
  app: string;
  configs: Array<{
    path: string;
    level: 'project' | 'user' | 'system';
    servers: MCPServerConfig[];
    priority: number;
    exists: boolean;
    readable: boolean;
    valid: boolean;
    content?: unknown;
    error?: string;
  }>;
}

export interface ConfigStrategy {
  action: 'replace' | 'choose' | 'none';
  target?: ConfigDiscovery['configs'][0];
  options?: ConfigDiscovery['configs'];
  recommendation?: string;
}

export interface ConsolidationStatus {
  isConsolidated: boolean;
  consolidatedUrl?: string;
  configPath?: string;
  originalServers?: number;
  message?: string;
}

/**
 * Discover all configuration files for a given application
 */
export async function discoverAppConfigs(appName: string): Promise<ConfigDiscovery> {
  const preset = getAppPreset(appName);
  if (!preset || !isAppConfigurable(appName)) {
    return {
      app: appName,
      configs: [],
    };
  }

  const configPaths = getAppConfigPaths(appName);
  const configs: ConfigDiscovery['configs'] = [];

  for (const configPath of configPaths) {
    const configInfo = await analyzeConfigFile(configPath, preset.configFormat);

    // Determine level and priority from preset
    const location = preset.locations.find((loc) => {
      const resolvedPath = configPath;
      return resolvedPath.includes(loc.path.replace('~', '').replace('%APPDATA%', ''));
    });

    configs.push({
      ...configInfo,
      path: configPath,
      level: location?.level || 'user',
      priority: location?.priority || 5,
    });
  }

  return {
    app: appName,
    configs: configs.filter((config) => config.exists),
  };
}

/**
 * Check if an application has already been consolidated to 1mcp
 */
export async function checkConsolidationStatus(appName: string): Promise<ConsolidationStatus> {
  const discovery = await discoverAppConfigs(appName);

  // Check each configuration for consolidation patterns
  for (const config of discovery.configs) {
    if (!config.content || !config.valid) {
      continue;
    }

    const consolidationInfo = detectConsolidationPattern(config.content || {});
    if (consolidationInfo.isConsolidated) {
      return {
        isConsolidated: true,
        consolidatedUrl: consolidationInfo.consolidatedUrl,
        configPath: config.path,
        originalServers: consolidationInfo.originalServers,
        message: `Already consolidated to ${consolidationInfo.consolidatedUrl}`,
      };
    }
  }

  return { isConsolidated: false };
}

/**
 * Detect if a configuration file contains consolidation patterns
 */
function detectConsolidationPattern(config: unknown): {
  isConsolidated: boolean;
  consolidatedUrl?: string;
  originalServers?: number;
} {
  // Type guard to ensure config is an object
  if (!config || typeof config !== 'object') {
    return { isConsolidated: false };
  }

  const configObj = config as Record<string, unknown>;

  // Check for different config formats
  const serverSections = [
    configObj.mcpServers, // Claude Desktop format
    configObj.servers, // Cursor format
    configObj['mcp.servers'], // VS Code settings.json format
    configObj['claude.mcpServers'], // VS Code Claude extension format
    configObj['cline.mcpServers'], // VS Code Cline extension format
    configObj['continue.mcpServers'], // VS Code Continue extension format
    (configObj.mcp as Record<string, unknown>)?.servers, // Alternative nested format
  ].filter(Boolean);

  for (const servers of serverSections) {
    // Type guard to ensure servers is an object
    if (!servers || typeof servers !== 'object') {
      continue;
    }

    const serversObj = servers as Record<string, unknown>;
    const serverNames = Object.keys(serversObj);

    // Pattern 1: Only has a single '1mcp' server entry
    if (serverNames.length === 1 && (serverNames[0] === '1mcp' || serverNames[0].includes('1mcp'))) {
      const server = serversObj[serverNames[0]] as Record<string, unknown>;
      const url = server.url as string;
      const command = server.command as string;

      // Verify it looks like a 1mcp URL or command
      const hasValidUrl = url && (url.includes('/mcp') || url.includes('localhost') || url.includes('1mcp'));
      const hasValidCommand = command && command.includes('@1mcp/agent');

      if (hasValidUrl || hasValidCommand) {
        return {
          isConsolidated: true,
          consolidatedUrl: url || 'detected',
          originalServers: 1,
        };
      }
    }

    // Pattern 2: Check if all servers point to 1mcp URLs
    if (serverNames.length > 0) {
      const allServersAre1mcp = serverNames.every((name) => {
        const server = serversObj[name] as Record<string, unknown>;
        return (
          name === '1mcp' ||
          name.includes('1mcp') ||
          ((server.url as string) && (server.url as string).includes('1mcp')) ||
          ((server.command as string) && (server.command as string).includes('@1mcp/agent'))
        );
      });

      if (allServersAre1mcp) {
        const firstServer = serversObj[serverNames[0]] as Record<string, unknown>;
        return {
          isConsolidated: true,
          consolidatedUrl: (firstServer.url as string) || 'detected',
          originalServers: serverNames.length,
        };
      }
    }
  }

  return { isConsolidated: false };
}

/**
 * Analyze a single configuration file
 */
async function analyzeConfigFile(
  configPath: string,
  format: string,
): Promise<{
  servers: MCPServerConfig[];
  exists: boolean;
  readable: boolean;
  valid: boolean;
  content?: unknown;
  error?: string;
}> {
  try {
    // Check if file exists
    if (!fs.existsSync(configPath)) {
      return {
        servers: [],
        exists: false,
        readable: false,
        valid: false,
      };
    }

    // Check if readable
    try {
      fs.accessSync(configPath, fs.constants.R_OK);
    } catch {
      return {
        servers: [],
        exists: true,
        readable: false,
        valid: false,
        error: 'File not readable',
      };
    }

    // Read and parse file
    const content = fs.readFileSync(configPath, 'utf8');
    let parsedContent: unknown;

    try {
      // For VS Code settings, use JSON5 parser to handle comments
      parsedContent = format === 'vscode' ? JSON5.parse(content) : JSON.parse(content);
    } catch (parseError) {
      return {
        servers: [],
        exists: true,
        readable: true,
        valid: false,
        error: `Invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      };
    }

    // Extract servers based on format
    const servers = extractServersFromConfig(parsedContent, format);

    return {
      servers,
      exists: true,
      readable: true,
      valid: true,
      content: parsedContent,
    };
  } catch (error: unknown) {
    return {
      servers: [],
      exists: false,
      readable: false,
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Extract MCP server configurations from parsed config based on format
 */
function extractServersFromConfig(config: unknown, format: string): MCPServerConfig[] {
  const servers: MCPServerConfig[] = [];

  // Type guard to ensure config is an object
  if (!config || typeof config !== 'object') {
    return servers;
  }

  const configObj = config as Record<string, unknown>;

  try {
    let mcpSection: unknown;

    switch (format) {
      case 'claude-desktop':
        mcpSection = configObj.mcpServers || {};
        break;
      case 'vscode':
        // VS Code stores MCP servers in settings.json under extension-specific keys
        // Common patterns: mcp.servers, mcpServers, or extension-specific keys
        mcpSection =
          configObj['mcp.servers'] ||
          configObj.mcpServers ||
          configObj['claude.mcpServers'] ||
          configObj['cline.mcpServers'] ||
          configObj['continue.mcpServers'] ||
          {};
        break;
      case 'cursor':
        mcpSection = configObj.servers || configObj.mcpServers || {};
        break;
      case 'generic':
        mcpSection = configObj.servers || configObj.mcpServers || configObj;
        break;
      default:
        mcpSection = configObj.mcpServers || configObj.servers || {};
    }

    // Type guard to ensure mcpSection is an object
    if (!mcpSection || typeof mcpSection !== 'object') {
      return servers;
    }

    const mcpSectionObj = mcpSection as Record<string, unknown>;

    for (const [name, serverConfig] of Object.entries(mcpSectionObj)) {
      if (typeof serverConfig === 'object' && serverConfig !== null) {
        const server = serverConfig as Record<string, unknown>;

        // Skip existing 1mcp entries to avoid circular references
        if (
          name === '1mcp' ||
          name.includes('1mcp') ||
          ((server.url as string) && (server.url as string).includes('1mcp')) ||
          ((server.command as string) && (server.command as string).includes('@1mcp/agent'))
        ) {
          continue;
        }

        servers.push({
          name,
          command: Array.isArray(server.command) ? server.command.join(' ') : (server.command as string | undefined),
          url: server.url as string | undefined,
          args: server.args as string[] | undefined,
          env: server.env as Record<string, string> | undefined,
        });
      }
    }
  } catch (_error) {
    // Return empty array if extraction fails
  }

  return servers;
}

/**
 * Handle multiple configuration files strategy
 */
export function handleMultipleConfigs(discovery: ConfigDiscovery): ConfigStrategy {
  const validConfigs = discovery.configs.filter((config) => config.exists && config.readable && config.valid);

  if (validConfigs.length === 0) {
    return { action: 'none' };
  }

  if (validConfigs.length === 1) {
    return {
      action: 'replace',
      target: validConfigs[0],
    };
  }

  // Multiple configs found - need user choice
  // Sort by priority (highest first), then by number of servers
  validConfigs.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    return b.servers.length - a.servers.length;
  });

  return {
    action: 'choose',
    options: validConfigs,
    target: validConfigs[0], // Default to highest priority
    recommendation: 'highest-priority-with-servers',
  };
}

/**
 * Filter and validate extracted servers
 */
export function extractAndFilterServers(appConfig: unknown, format: string = 'generic'): MCPServerConfig[] {
  const servers = extractServersFromConfig(appConfig, format);

  return servers.filter((server) => {
    // Must have either command or url
    if (!server.command && !server.url) {
      return false;
    }

    // Skip if it's already a 1mcp server
    if (server.name === '1mcp' || server.name.includes('1mcp')) {
      return false;
    }

    if (server.url && server.url.includes('1mcp')) {
      return false;
    }

    if (server.command && server.command.includes('@1mcp/agent')) {
      return false;
    }

    return true;
  });
}

/**
 * Generate configuration for specific app format
 */
export function generateAppConfig(appName: string, url: string): Record<string, unknown> {
  const preset = getAppPreset(appName);
  if (!preset) {
    throw new Error(`Unsupported app: ${appName}`);
  }

  switch (preset.configFormat) {
    case 'vscode':
      return {
        'mcp.servers': {
          '1mcp': {
            url: url,
          },
        },
      };

    case 'augment':
      return {
        'augment.advanced.mcpServers': {
          '1mcp': {
            url: url,
          },
        },
      };

    case 'claude-desktop':
      return {
        mcpServers: {
          '1mcp': {
            command: 'npx',
            args: ['-y', '@1mcp/agent', 'proxy'],
          },
        },
      };

    case 'generic':
    default:
      return {
        mcpServers: {
          '1mcp': {
            url: url,
          },
        },
      };
  }
}

/**
 * Discover all installed apps with MCP configurations
 */
export async function discoverInstalledApps(): Promise<{
  configurable: Array<{
    name: string;
    displayName: string;
    hasConfig: boolean;
    configCount: number;
    serverCount: number;
    paths: string[];
  }>;
  manualOnly: string[];
}> {
  const configurableApps = [];
  const manualOnlyApps = [];

  const { APP_PRESETS } = await import('@src/domains/discovery/appPresets.js');
  for (const [appName, preset] of Object.entries(APP_PRESETS)) {
    if (preset.configurable) {
      const discovery = await discoverAppConfigs(appName);
      const validConfigs = discovery.configs.filter((c) => c.exists && c.readable);
      const totalServers = validConfigs.reduce((sum, config) => sum + config.servers.length, 0);

      configurableApps.push({
        name: appName,
        displayName: preset.displayName,
        hasConfig: validConfigs.length > 0,
        configCount: validConfigs.length,
        serverCount: totalServers,
        paths: validConfigs.map((c) => c.path),
      });
    } else {
      manualOnlyApps.push(appName);
    }
  }

  return {
    configurable: configurableApps,
    manualOnly: manualOnlyApps,
  };
}
