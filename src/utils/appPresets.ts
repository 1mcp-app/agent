import path from 'path';
import os from 'os';

/**
 * Desktop application preset configurations for MCP consolidation.
 *
 * Defines supported applications, their configuration file locations,
 * and platform-specific handling.
 */

export interface AppPreset {
  name: string;
  displayName: string;
  configurable: boolean;
  locations: AppLocation[];
  configFormat: 'augment' | 'vscode' | 'generic';
  manualInstructions?: string;
}

export interface AppLocation {
  platform: 'darwin' | 'win32' | 'linux' | 'all';
  path: string;
  level: 'project' | 'user' | 'system';
  priority: number; // Higher number = higher priority
}

/**
 * Supported desktop applications with their configuration presets
 */
export const APP_PRESETS: Record<string, AppPreset> = {
  'claude-desktop': {
    name: 'claude-desktop',
    displayName: 'Claude Desktop',
    configurable: true,
    configFormat: 'generic',
    locations: [
      {
        platform: 'darwin',
        path: '~/Library/Application Support/Claude/claude_desktop_config.json',
        level: 'user',
        priority: 10,
      },
      {
        platform: 'win32',
        path: '%APPDATA%/Claude/claude_desktop_config.json',
        level: 'user',
        priority: 10,
      },
      {
        platform: 'linux',
        path: '~/.config/claude/claude_desktop_config.json',
        level: 'user',
        priority: 10,
      },
    ],
  },

  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    configurable: true,
    configFormat: 'generic',
    locations: [
      {
        platform: 'all',
        path: '.cursor/mcp.json',
        level: 'project',
        priority: 20,
      },
      {
        platform: 'all',
        path: '~/.cursor/mcp.json',
        level: 'user',
        priority: 10,
      },
    ],
  },

  vscode: {
    name: 'vscode',
    displayName: 'VS Code',
    configurable: true,
    configFormat: 'vscode',
    locations: [
      {
        platform: 'darwin',
        path: '~/Library/Application Support/Code/User/settings.json',
        level: 'user',
        priority: 10,
      },
      {
        platform: 'win32',
        path: '%APPDATA%/Code/User/settings.json',
        level: 'user',
        priority: 10,
      },
      {
        platform: 'linux',
        path: '~/.config/Code/User/settings.json',
        level: 'user',
        priority: 10,
      },
    ],
  },

  'roo-code': {
    name: 'roo-code',
    displayName: 'Roo Code',
    configurable: true,
    configFormat: 'generic',
    locations: [
      {
        platform: 'all',
        path: '.roo/mcp.json',
        level: 'project',
        priority: 20,
      },
      {
        platform: 'darwin',
        path: '~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json',
        level: 'user',
        priority: 10,
      },
      {
        platform: 'win32',
        path: '%APPDATA%/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json',
        level: 'user',
        priority: 10,
      },
      {
        platform: 'linux',
        path: '~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json',
        level: 'user',
        priority: 10,
      },
    ],
  },

  cline: {
    name: 'cline',
    displayName: 'Cline',
    configurable: true,
    configFormat: 'generic',
    locations: [
      {
        platform: 'darwin',
        path: '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/mcp_settings.json',
        level: 'user',
        priority: 10,
      },
      {
        platform: 'win32',
        path: '%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/mcp_settings.json',
        level: 'user',
        priority: 10,
      },
      {
        platform: 'linux',
        path: '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/mcp_settings.json',
        level: 'user',
        priority: 10,
      },
    ],
  },

  'cherry-studio': {
    name: 'cherry-studio',
    displayName: 'Cherry Studio',
    configurable: false,
    configFormat: 'generic',
    locations: [],
    manualInstructions: `
═══ Cherry Studio Setup Instructions ═══
1. Open Cherry Studio → Settings → MCP Servers
2. Remove any existing MCP server configurations (if any)
3. Add new server with these details:

   Name: 1mcp-proxy
   URL: {url}

4. Save and restart Cherry Studio

✅ After setup, Cherry Studio will connect to 1mcp which can proxy
   to all your MCP servers from other clients!

💡 Add servers to 1mcp: npx @1mcp/agent server add <server-config>`,
  },

  continue: {
    name: 'continue',
    displayName: 'Continue (VS Code Extension)',
    configurable: false,
    configFormat: 'generic',
    locations: [],
    manualInstructions: `
═══ Continue (VS Code Extension) Setup Instructions ═══
1. Open VS Code → Extensions → Continue settings
2. Navigate to MCP Server configuration section
3. Remove any existing MCP server configurations (if any)
4. Add new server configuration:

   URL: {url}

5. Save settings and restart VS Code

✅ After setup, Continue will connect to 1mcp which can proxy
   to all your MCP servers from other clients!

💡 Add servers to 1mcp: npx @1mcp/agent server add <server-config>`,
  },

  copilot: {
    name: 'copilot',
    displayName: 'GitHub Copilot',
    configurable: false,
    configFormat: 'generic',
    locations: [],
    manualInstructions: `
═══ GitHub Copilot Setup Instructions ═══
Note: GitHub Copilot uses enterprise-managed configuration.
Manual MCP server setup may not be available depending on your organization's settings.

If MCP configuration is available:
1. Access GitHub Copilot settings through your IDE
2. Look for MCP or external server configuration options
3. Add new server:

   URL: {url}

4. Save and restart your IDE

✅ After setup, Copilot will connect to 1mcp which can proxy
   to all your MCP servers from other clients!

💡 Add servers to 1mcp: npx @1mcp/agent server add <server-config>`,
  },
};

/**
 * Get all supported application names
 */
export function getSupportedApps(): string[] {
  return Object.keys(APP_PRESETS);
}

/**
 * Get configurable applications (can be auto-consolidated)
 */
export function getConfigurableApps(): string[] {
  return Object.entries(APP_PRESETS)
    .filter(([_, preset]) => preset.configurable)
    .map(([name, _]) => name);
}

/**
 * Get manual-only applications (require manual setup instructions)
 */
export function getManualOnlyApps(): string[] {
  return Object.entries(APP_PRESETS)
    .filter(([_, preset]) => !preset.configurable)
    .map(([name, _]) => name);
}

/**
 * Get preset configuration for an application
 */
export function getAppPreset(appName: string): AppPreset | null {
  return APP_PRESETS[appName] || null;
}

/**
 * Resolve platform-specific paths for an application
 */
export function getAppConfigPaths(appName: string): string[] {
  const preset = getAppPreset(appName);
  if (!preset || !preset.configurable) {
    return [];
  }

  const platform = process.platform as 'darwin' | 'win32' | 'linux';
  const relevantLocations = preset.locations.filter(
    (location) => location.platform === 'all' || location.platform === platform,
  );

  // Sort by priority (highest first)
  relevantLocations.sort((a, b) => b.priority - a.priority);

  return relevantLocations.map((location) => resolvePath(location.path));
}

/**
 * Resolve path with environment variable expansion
 */
function resolvePath(pathStr: string): string {
  // Replace ~ with home directory
  if (pathStr.startsWith('~')) {
    pathStr = path.join(os.homedir(), pathStr.slice(1));
  }

  // Replace %APPDATA% on Windows
  if (process.platform === 'win32' && pathStr.includes('%APPDATA%')) {
    const appData = process.env.APPDATA || '';
    pathStr = pathStr.replace('%APPDATA%', appData);
  }

  // Handle other environment variables
  pathStr = pathStr.replace(/\$\{([^}]+)\}/g, (match, envVar) => {
    return process.env[envVar] || match;
  });

  return path.resolve(pathStr);
}

/**
 * Generate manual setup instructions for an app
 */
export function generateManualInstructions(appName: string, url: string): string {
  const preset = getAppPreset(appName);
  if (!preset || !preset.manualInstructions) {
    return `Manual setup instructions not available for ${appName}.`;
  }

  return preset.manualInstructions.replace(/\{url\}/g, url);
}

/**
 * Check if an application is supported
 */
export function isAppSupported(appName: string): boolean {
  return appName in APP_PRESETS;
}

/**
 * Check if an application is configurable (auto-consolidation supported)
 */
export function isAppConfigurable(appName: string): boolean {
  const preset = getAppPreset(appName);
  return preset ? preset.configurable : false;
}
