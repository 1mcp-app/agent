import { getConfigDir } from '@src/constants.js';
import { discoverScopedRuntime } from '@src/core/server/runtimeLifecycle.js';
import {
  fetchRuntimeTargetUrl,
  type RuntimeTargetTlsOptions,
} from '@src/domains/runtime-targets/runtimeIdentityVerification.js';
import { debugIf } from '@src/logger/logger.js';
import { createSafeErrorMessage } from '@src/logger/secureLogger.js';
import { normalizedArgv } from '@src/utils/cli/normalizedArgv.js';

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
  const args = normalizedArgv;

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
        redirect: 'manual',
        signal: AbortSignal.timeout(2000),
      });
      if (isReachableOAuthProbeResponse(response)) {
        return `http://localhost:${port}/mcp`;
      }
    } catch (error) {
      // Connection refused is the expected case while scanning unused ports, but
      // a TLS/DNS/abort error on a port that IS listening is diagnostic — log it
      // at debug so a misconfigured-but-present server is not invisible.
      debugIf(() => ({
        message: `Port scan probe failed on ${port}`,
        meta: { port, error: error instanceof Error ? error.message : String(error) },
      }));
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
 * Reachability probe for client surfaces. Reuses the existing 1mcp-aware
 * validation (OAuth endpoint check) rather than the readiness gate, preserving
 * the attach semantics these commands already had.
 */
const clientSurfaceProbe = async (info: { url: string }): Promise<boolean> =>
  (await validateServer1mcpUrl(info.url)).valid;

/**
 * Method 4: Detect URL from PID file (for proxy command)
 *
 * Discovery (and the two-tier staleness rule) is delegated to the lifecycle
 * module: a dead process has its PID file removed; an alive-but-unreachable
 * runtime keeps its PID file so a mid-startup runtime is not stranded.
 */
export async function detectUrlFromPidFile(configDir?: string): Promise<string | null> {
  const dir = getConfigDir(configDir);
  const runtime = await discoverScopedRuntime(dir, clientSurfaceProbe);

  if (runtime.status === 'running' && runtime.info) {
    return runtime.info.url;
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
): Promise<{ url: string; source: 'user' | 'pidfile' | 'portscan'; pid?: number }> {
  // 1. User override (highest priority)
  if (userUrl) {
    const normalizedUrl = userUrl.endsWith('/mcp') ? userUrl : `${userUrl}/mcp`;
    return { url: normalizedUrl, source: 'user' };
  }

  // 2. Try PID file (lifecycle module owns the two-tier staleness rule:
  //    dead → delete; alive-but-unreachable → retain and fall through).
  const dir = getConfigDir(configDir);
  const runtime = await discoverScopedRuntime(dir, clientSurfaceProbe);

  if (runtime.status === 'running' && runtime.info) {
    return { url: runtime.info.url, source: 'pidfile', pid: runtime.info.pid };
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
export async function validateServer1mcpUrl(
  url: string,
  tls?: RuntimeTargetTlsOptions,
): Promise<{
  valid: boolean;
  error?: string;
}> {
  try {
    // Remove a trailing /mcp suffix to test base URL. Anchor to the end so a URL
    // like http://host/mcp-internal/mcp is not mangled by stripping the first match.
    const baseUrl = url.replace(/\/mcp\/?$/, '');

    // Test basic connectivity to OAuth endpoint (which always exists)
    const oauthResponse = await fetchRuntimeTargetUrl(`${baseUrl}/oauth/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      tls,
    });

    if (!isReachableOAuthProbeResponse(oauthResponse)) {
      return {
        valid: false,
        error: createSafeErrorMessage(`1mcp server not responding (HTTP ${oauthResponse.status})`),
      };
    }

    // For MCP endpoint, we just verify OAuth is working since MCP requires POST with specific payload
    // The OAuth endpoint responding successfully indicates the server is properly running

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: createSafeErrorMessage(
        `Cannot connect to 1mcp server: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
}

function isReachableOAuthProbeResponse(response: {
  ok: boolean;
  status: number;
  headers?: { get: (name: string) => string | null };
}): boolean {
  if (response.ok) {
    return true;
  }

  return response.status >= 300 && response.status < 400 && Boolean(response.headers?.get('location'));
}
