import os from 'os';
import path from 'path';

import printer from '@src/utils/ui/printer.js';

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
  configFormat: 'augment' | 'vscode' | 'generic' | 'claude-desktop';
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
 *
 * ⚠️  PLATFORM SUPPORT STATUS:
 * - macOS (darwin): ✅ Fully tested and verified
 * - Windows (win32): ⚠️  Paths researched but untested - see commented sections
 * - Linux: ⚠️  Paths researched but untested - see commented sections
 *
 * 🤝 CONTRIBUTION NEEDED:
 * If you're using Windows or Linux, please help verify these paths by:
 * 1. Uncommenting the relevant sections for your platform
 * 2. Testing the functionality
 * 3. Reporting results or submitting fixes
 *
 * 📝 STANDARD LOCATIONS RESEARCH:
 * The commented paths below are based on official documentation and
 * common conventions, but have not been tested in real environments.
 */
export const APP_PRESETS: Record<string, AppPreset> = {
  'claude-desktop': {
    name: 'claude-desktop',
    displayName: 'Claude Desktop',
    configurable: true,
    configFormat: 'claude-desktop',
    locations: [
      {
        platform: 'darwin',
        path: '~/Library/Application Support/Claude/claude_desktop_config.json',
        level: 'user',
        priority: 10,
      },
      // UNTESTED - Based on Claude Desktop documentation and Windows conventions
      // {
      //   platform: 'win32',
      //   path: '%APPDATA%\\Claude\\claude_desktop_config.json',
      //   level: 'user',
      //   priority: 10,
      // },
      // UNTESTED - Based on XDG Base Directory specification and Linux conventions
      // {
      //   platform: 'linux',
      //   path: '~/.config/claude/claude_desktop_config.json',
      //   level: 'user',
      //   priority: 10,
      // },
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
        platform: 'darwin',
        path: '~/.cursor/mcp.json',
        level: 'user',
        priority: 10,
      },
      // {
      //   platform: 'win32',
      //   path: '%APPDATA%\\Cursor\\User\\settings.json',
      //   level: 'user',
      //   priority: 10,
      // },
      // {
      //   platform: 'linux',
      //   path: '~/.cursor/mcp.json',
      //   level: 'user',
      //   priority: 10,
      // },
    ],
  },

  vscode: {
    name: 'vscode',
    displayName: 'VS Code',
    configurable: true,
    configFormat: 'vscode',
    locations: [
      {
        platform: 'all',
        path: '.vscode/mcp.json',
        level: 'project',
        priority: 20,
      },
      {
        platform: 'darwin',
        path: '~/Library/Application Support/Code/User/settings.json',
        level: 'user',
        priority: 10,
      },
      // {
      //   platform: 'win32',
      //   path: '%APPDATA%\\Code\\User\\settings.json',
      //   level: 'user',
      //   priority: 10,
      // },
      // {
      //   platform: 'linux',
      //   path: '~/.config/Code/User/settings.json',
      //   level: 'user',
      //   priority: 10,
      // },
    ],
  },

  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    configurable: true,
    configFormat: 'generic',
    locations: [
      {
        platform: 'all',
        path: '.mcp.json',
        level: 'project',
        priority: 20,
      },
    ],
  },

  'gemini-code': {
    name: 'gemini-code',
    displayName: 'Gemini Code',
    configurable: true,
    configFormat: 'generic',
    locations: [
      {
        platform: 'darwin',
        path: '~/.gemini/settings.json',
        level: 'user',
        priority: 10,
      },
      // {
      //   platform: 'win32',
      //   path: '%APPDATA%\\Gemini\\settings.json',
      //   level: 'user',
      //   priority: 10,
      // },
      // {
      //   platform: 'linux',
      //   path: '~/.gemini/settings.json',
      //   level: 'user',
      //   priority: 10,
      // },
    ],
  },

  'augment-code': {
    name: 'augment-code',
    displayName: 'Augment Code',
    configurable: true,
    configFormat: 'augment',
    locations: [
      {
        platform: 'darwin',
        path: '~/Library/Application Support/Code/User/settings.json',
        level: 'user',
        priority: 10,
      },
      // {
      //   platform: 'win32',
      //   path: '%APPDATA%\\Code\\User\\settings.json',
      //   level: 'user',
      //   priority: 10,
      // },
      // {
      //   platform: 'linux',
      //   path: '~/.config/Code/User/settings.json',
      //   level: 'user',
      //   priority: 10,
      // },
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
      // {
      //   platform: 'win32',
      //   path: '%APPDATA%\\Code\\User\\globalStorage\\rooveterinaryinc.roo-cline\\settings\\mcp_settings.json',
      //   level: 'user',
      //   priority: 10,
      // },
      // {
      //   platform: 'linux',
      //   path: '~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json',
      //   level: 'user',
      //   priority: 10,
      // },
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
        path: '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
        level: 'user',
        priority: 10,
      },
      // {
      //   platform: 'win32',
      //   path: '%APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json',
      //   level: 'user',
      //   priority: 10,
      // },
      // {
      //   platform: 'linux',
      //   path: '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
      //   level: 'user',
      //   priority: 10,
      // },
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

   Name: 1mcp
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
 * Check if the current platform has verified support for an app
 */
export function isPlatformTested(appName: string): boolean {
  const preset = getAppPreset(appName);
  if (!preset) return false;

  const platform = process.platform as 'darwin' | 'win32' | 'linux';

  // Only macOS is currently tested
  if (platform !== 'darwin') return false;

  return preset.locations.some((loc) => loc.platform === 'darwin' || loc.platform === 'all');
}

/**
 * Get platform support message for CLI users
 */
export function getPlatformSupportMessage(_appName: string): string {
  const platform = process.platform as 'darwin' | 'win32' | 'linux';

  if (platform === 'darwin') {
    return '✅ Fully supported and tested on macOS';
  }

  const platformName = platform === 'win32' ? 'Windows' : 'Linux';
  return `⚠️  ${platformName} support is experimental - paths researched but untested.
     If you encounter issues, please contribute by:
     1. Testing the functionality
     2. Reporting results at https://github.com/1mcp-app/agent/issues
     3. Submitting corrections if needed`;
}

/**
 * Display platform support warning for CLI commands if needed
 */
export function showPlatformWarningIfNeeded(): void {
  const platform = process.platform as 'darwin' | 'win32' | 'linux';

  if (platform !== 'darwin') {
    const platformName = platform === 'win32' ? 'Windows' : 'Linux';

    printer.warn('PLATFORM SUPPORT WARNING');
    printer.blank();
    printer.raw(`${platformName} support is experimental - paths researched but untested.`);
    printer.raw('If you encounter issues, please contribute by:');
    printer.raw('  1. Testing the functionality');
    printer.raw('  2. Reporting results at https://github.com/1mcp-app/agent/issues');
    printer.raw('  3. Submitting corrections if needed');
    printer.blank();
  }
}

/**
 * Safely get environment variable value
 */
function getEnvVar(key: string): string | undefined {
  // Type-safe access to environment variables
  return process.env[key] as string | undefined;
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
    const appData = getEnvVar('APPDATA') || '';
    pathStr = pathStr.replace('%APPDATA%', appData);
  }

  // Handle other environment variables
  pathStr = pathStr.replace(/\$\{([^}]+)\}/g, (match: string, envVar: string) => {
    const envValue = getEnvVar(envVar) as string | undefined;
    return envValue ?? match;
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

/**
 * Generate dynamic supported apps list for CLI help text
 */
export function generateSupportedAppsHelp(): string {
  const configurableApps = getConfigurableApps();
  const manualApps = getManualOnlyApps();

  let helpText = 'SUPPORTED APPS:\n';

  // Add configurable apps
  configurableApps.forEach((appName) => {
    const preset = APP_PRESETS[appName];
    helpText += `  - ${appName}: ${preset.displayName}\n`;
  });

  // Add manual apps with note
  manualApps.forEach((appName) => {
    const preset = APP_PRESETS[appName];
    helpText += `  - ${appName}: ${preset.displayName} (manual setup only)\n`;
  });

  return helpText.trimEnd();
}
