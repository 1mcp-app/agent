import { readPidFile, cleanupPidFile } from './pidFileManager.js';
import { getConfigDir } from '../constants.js';

/**
 * Multi-method URL detection system for app commands.
 *
 * Since app commands run standalone (not within serving process),
 * the AgentConfigManager singleton isn't available. This module
 * provides alternative detection methods with priority-based fallback.
 */

/**
 * Method 1: Detect URL from CLI arguments (highest priority)
 */
export function detectUrlFromCliArgs(): string {
  const args = process.argv;

  // Parse external-url flag
  const externalUrlIndex = args.findIndex((arg) => arg === '--external-url' || arg === '-u');
  if (externalUrlIndex !== -1 && args[externalUrlIndex + 1]) {
    return `${args[externalUrlIndex + 1]}/mcp`;
  }

  // Parse host and port
  const hostIndex = args.findIndex((arg) => arg === '--host' || arg === '-H');
  const portIndex = args.findIndex((arg) => arg === '--port' || arg === '-P');

  const host = hostIndex !== -1 && args[hostIndex + 1] ? args[hostIndex + 1] : 'localhost';
  const port = portIndex !== -1 && args[portIndex + 1] ? args[portIndex + 1] : '3050';

  return `http://${host}:${port}/mcp`;
}

/**
 * Method 2: Detect running server on common ports
 */
export async function detectRunningServerUrl(): Promise<string | null> {
  // Try common ports and check /oauth endpoint (which always exists)
  const commonPorts = [3050, 3051, 3052];

  for (const port of commonPorts) {
    try {
      const response = await fetch(`http://localhost:${port}/oauth/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        return `http://localhost:${port}/mcp`;
      }
    } catch {
      // Continue to next port
    }
  }
  return null;
}

/**
 * Method 3: Detect URL from environment variables
 */
export function detectUrlFromEnv(): string | null {
  const externalUrl = process.env.ONE_MCP_EXTERNAL_URL;
  if (externalUrl) {
    return `${externalUrl}/mcp`;
  }

  const host = process.env.ONE_MCP_HOST || 'localhost';
  const port = process.env.ONE_MCP_PORT || '3050';
  return `http://${host}:${port}/mcp`;
}

/**
 * Method 4: Detect URL from PID file (for proxy command)
 */
export async function detectUrlFromPidFile(configDir?: string): Promise<string | null> {
  const dir = getConfigDir(configDir);
  const serverInfo = readPidFile(dir);

  if (serverInfo) {
    // Validate server is still responding
    const validation = await validateServer1mcpUrl(serverInfo.url);
    if (validation.valid) {
      return serverInfo.url;
    }
    // Server is dead, clean up stale PID file
    cleanupPidFile(dir);
  }

  return null;
}

/**
 * Method 5: Combined detection with priority fallback (primary implementation)
 */
export async function detectServer1mcpUrl(): Promise<string> {
  // 1. Try CLI args first (highest priority)
  const cliUrl = detectUrlFromCliArgs();
  if (cliUrl !== 'http://localhost:3050/mcp') return cliUrl; // Only use if non-default

  // 2. Try running server detection
  const runningUrl = await detectRunningServerUrl();
  if (runningUrl) return runningUrl;

  // 3. Try environment variables
  const envUrl = detectUrlFromEnv();
  if (envUrl && envUrl !== 'http://localhost:3050/mcp') return envUrl;

  // 4. Default fallback
  return 'http://localhost:3050/mcp';
}

/**
 * Method 6: Combined detection with PID file support (for proxy command)
 * Priority: user URL → PID file → port scanning → error
 */
export async function discoverServerWithPidFile(
  configDir?: string,
  userUrl?: string,
): Promise<{ url: string; source: 'user' | 'pidfile' | 'portscan' }> {
  // 1. User override (highest priority)
  if (userUrl) {
    const normalizedUrl = userUrl.endsWith('/mcp') ? userUrl : `${userUrl}/mcp`;
    return { url: normalizedUrl, source: 'user' };
  }

  // 2. Try PID file
  const pidFileUrl = await detectUrlFromPidFile(configDir);
  if (pidFileUrl) {
    return { url: pidFileUrl, source: 'pidfile' };
  }

  // 3. Fallback to port scanning
  const portScanUrl = await detectRunningServerUrl();
  if (portScanUrl) {
    return { url: portScanUrl, source: 'portscan' };
  }

  // 4. No server found
  throw new Error(
    'No running 1MCP server found.\n\n' +
      'Start a server first:\n' +
      '  1mcp serve\n\n' +
      'Or specify URL manually:\n' +
      '  1mcp proxy --url http://localhost:3050/mcp',
  );
}

/**
 * Method 7: Get URL with user override (for command-specific URLs)
 */
export async function getServer1mcpUrl(userOverrideUrl?: string): Promise<string> {
  if (userOverrideUrl) {
    // Ensure URL ends with /mcp if not already present
    return userOverrideUrl.endsWith('/mcp') ? userOverrideUrl : `${userOverrideUrl}/mcp`;
  }

  return await detectServer1mcpUrl();
}

/**
 * Validate that a URL is accessible and appears to be a 1mcp server
 */
export async function validateServer1mcpUrl(url: string): Promise<{
  valid: boolean;
  error?: string;
}> {
  try {
    // Remove /mcp suffix to test base URL
    const baseUrl = url.replace('/mcp', '');

    // Test basic connectivity to OAuth endpoint (which always exists)
    const oauthResponse = await fetch(`${baseUrl}/oauth/`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!oauthResponse.ok) {
      return {
        valid: false,
        error: `1mcp server not responding (HTTP ${oauthResponse.status})`,
      };
    }

    // For MCP endpoint, we just verify OAuth is working since MCP requires POST with specific payload
    // The OAuth endpoint responding successfully indicates the server is properly running

    return { valid: true };
  } catch (error: any) {
    return {
      valid: false,
      error: `Cannot connect to 1mcp server: ${error.message}`,
    };
  }
}
