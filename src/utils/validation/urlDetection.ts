import { getConfigDir } from '@src/constants.js';
import { discoverScopedRuntime } from '@src/core/server/runtimeLifecycle.js';
import {
  fetchRuntimeIdentity,
  fetchRuntimeTargetUrl,
  RuntimeTargetIdentityError,
  type RuntimeTargetTlsOptions,
} from '@src/domains/runtime-targets/runtimeIdentityVerification.js';
import {
  localRuntimeStatusCommand,
  RuntimeProbeError,
  type RuntimeProbeFailure,
} from '@src/domains/runtime-targets/runtimeProbe.js';
import type { RuntimeTargetObservedIdentity } from '@src/domains/runtime-targets/runtimeTargetStore.js';
import { debugIf } from '@src/logger/logger.js';
import { sanitizeForLogging } from '@src/logger/secureLogger.js';
import { normalizedArgv } from '@src/utils/cli/normalizedArgv.js';

import type { DiscoveredServer } from './discoveredServer.js';

const LOOPBACK_ADDRESSES = ['127.0.0.1', '[::1]'] as const;

export interface RuntimeUrlValidationResult {
  valid: boolean;
  error?: string;
  failure?: RuntimeProbeFailure;
  identity?: RuntimeTargetObservedIdentity;
}

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
  // Try common ports against the unthrottled runtime identity endpoint.
  const commonPorts = [3050, 3051, 3052];

  for (const port of commonPorts) {
    try {
      return await raceLoopbackAddresses((host, signal) => probeLocalPortAddress(host, port, signal));
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

async function probeLocalPortAddress(host: string, port: number, signal: AbortSignal): Promise<string> {
  const baseUrl = `http://${host}:${port}`;
  const identityResponse = await fetch(`${baseUrl}/.well-known/1mcp/runtime-identity`, {
    redirect: 'manual',
    signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
  });
  if (identityResponse.ok) {
    return `${baseUrl}/mcp`;
  }

  // Compatibility fallback for runtimes that predate runtime identity.
  if (identityResponse.status === 404) {
    const oauthResponse = await fetch(`${baseUrl}/oauth/`, {
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
    });
    if (isReachableOAuthProbeResponse(oauthResponse)) {
      return `${baseUrl}/mcp`;
    }
  }

  throw new Error(`No reachable 1MCP runtime at ${baseUrl}`);
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
 * Reachability probe for client surfaces. Runtime identity is intentionally
 * outside OAuth rate limiting, so repeated CLI attachments cannot exhaust the
 * OAuth discovery budget and make a healthy runtime appear unavailable.
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
export async function discoverServerWithPidFile(configDir?: string, userUrl?: string): Promise<DiscoveredServer> {
  // 1. User override (highest priority)
  if (userUrl) {
    const normalizedUrl = userUrl.endsWith('/mcp') ? userUrl : `${userUrl}/mcp`;
    return { url: normalizedUrl, source: 'user', validated: false };
  }

  // 2. Try PID file. A live PID is authoritative for its Runtime Scope, even
  //    when the endpoint rejects or cannot satisfy the probe.
  const dir = getConfigDir(configDir);
  let ownedProbeFailure: RuntimeProbeFailure | undefined;
  let runtimeIdentity: RuntimeTargetObservedIdentity | undefined;
  const runtime = await discoverScopedRuntime(dir, async (info) => {
    const validation = await validateServer1mcpUrl(info.url);
    if (!validation.valid) {
      ownedProbeFailure = toRuntimeProbeFailure(validation, info.url);
    } else {
      runtimeIdentity = validation.identity;
    }
    return validation.valid;
  });

  if (runtime.status === 'running' && runtime.info) {
    return {
      url: runtime.info.url,
      source: 'pidfile',
      validated: true,
      pid: runtime.info.pid,
      ...(runtimeIdentity ? { runtimeIdentity } : {}),
    };
  }

  if (runtime.status === 'unreachable' && runtime.info) {
    throw new RuntimeProbeError(
      ownedProbeFailure ?? fallbackProbeFailure(runtime.info.url, 'Runtime endpoint did not respond'),
      {
        targetKind: 'local',
        configDir: dir,
        pid: runtime.info.pid,
        recoveryCommand: localRuntimeStatusCommand(dir),
      },
    );
  }
  if (runtime.status === 'error') {
    throw new LocalRuntimeAttachmentError(
      runtime.error ?? 'Runtime Scope ownership could not be inspected safely',
      localRuntimeStatusCommand(dir),
    );
  }

  // 3. Fallback to port scanning
  const portScanUrl = await detectRunningServerUrl();
  if (portScanUrl) {
    return { url: portScanUrl, source: 'portscan', validated: false };
  }

  // 4. No server found
  throw new LocalRuntimeUnavailableError(
    'No running 1MCP server found.\n\n' +
      'Start a server first:\n' +
      '  1mcp serve\n\n' +
      'Or specify URL manually:\n' +
      '  1mcp proxy --url http://localhost:3050/mcp',
  );
}

export class LocalRuntimeUnavailableError extends Error {
  readonly code = 'local_runtime_unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'LocalRuntimeUnavailableError';
  }
}

export class LocalRuntimeAttachmentError extends Error {
  readonly code = 'local_runtime_discovery_failed';

  constructor(
    message: string,
    readonly recoveryCommand?: string,
  ) {
    super(message);
    this.name = 'LocalRuntimeAttachmentError';
  }
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
): Promise<RuntimeUrlValidationResult> {
  // Remove a trailing /mcp suffix to test base URL. Anchor to the end so a URL
  // like http://host/mcp-internal/mcp is not mangled by stripping the first match.
  const baseUrl = url.replace(/\/mcp\/?$/, '');

  const parsedBaseUrl = new URL(baseUrl);
  if (parsedBaseUrl.protocol === 'http:' && parsedBaseUrl.hostname === 'localhost') {
    try {
      return await raceLoopbackAddresses(async (host, signal) => {
        const candidate = new URL(baseUrl);
        candidate.hostname = host;
        const result = await validateConcreteServer1mcpUrl(candidate.toString().replace(/\/$/, ''), tls, signal);
        if (result.valid) return result;
        throw result;
      });
    } catch (error) {
      const failures = error instanceof AggregateError ? error.errors.filter(isRuntimeUrlValidationResult) : [];
      return selectMostActionableFailure(failures) ?? invalidProbeResult(probeFailureFromError(error, '/'));
    }
  }

  return validateConcreteServer1mcpUrl(baseUrl, tls);
}

async function validateConcreteServer1mcpUrl(
  baseUrl: string,
  tls?: RuntimeTargetTlsOptions,
  signal?: AbortSignal,
): Promise<RuntimeUrlValidationResult> {
  try {
    const identity = await fetchRuntimeIdentity(baseUrl, {
      fetch: (url, init) =>
        fetchRuntimeTargetUrl(url, {
          ...init,
          ...(signal ? { signal: combineAbortSignals(signal, init.signal) } : {}),
        }),
      ...tls,
    });
    return { valid: true, identity };
  } catch (error) {
    if (!isMissingRuntimeIdentityEndpoint(error)) {
      return invalidProbeResult(probeFailureFromError(error, '/.well-known/1mcp/runtime-identity'));
    }
    debugIf(() => ({
      message: 'Runtime identity endpoint is unavailable; trying legacy OAuth discovery',
      meta: { error: error instanceof Error ? error.message : String(error) },
    }));
  }

  try {
    // Compatibility fallback for runtimes that predate runtime identity.
    const oauthResponse = await fetchRuntimeTargetUrl(`${baseUrl}/oauth/`, {
      redirect: 'manual',
      signal: combineAbortSignals(AbortSignal.timeout(5000), signal),
      tls,
    });

    if (!isReachableOAuthProbeResponse(oauthResponse)) {
      return invalidProbeResult(await probeFailureFromResponse(oauthResponse, '/oauth/'));
    }

    return { valid: true };
  } catch (error) {
    return invalidProbeResult(probeFailureFromError(error, '/oauth/'));
  }
}

async function raceLoopbackAddresses<T>(probe: (host: string, signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  try {
    return await Promise.any(LOOPBACK_ADDRESSES.map((host) => probe(host, controller.signal)));
  } finally {
    controller.abort();
  }
}

function isRuntimeUrlValidationResult(value: unknown): value is RuntimeUrlValidationResult {
  return typeof value === 'object' && value !== null && 'valid' in value;
}

function selectMostActionableFailure(failures: RuntimeUrlValidationResult[]): RuntimeUrlValidationResult | undefined {
  return [...failures].sort((left, right) => failurePriority(right.failure) - failurePriority(left.failure))[0];
}

function failurePriority(failure?: RuntimeProbeFailure): number {
  if (failure?.httpStatus === 429) return 6;
  if (failure?.failureKind === 'http_rejection') return 5;
  if (failure?.failureKind === 'tls_failure') return 4;
  if (failure?.failureKind === 'invalid_response') return 3;
  if (failure?.failureKind === 'timeout') return 2;
  return 1;
}

function combineAbortSignals(primary: AbortSignal, secondary?: AbortSignal): AbortSignal {
  return secondary ? AbortSignal.any([primary, secondary]) : primary;
}

export function toRuntimeProbeFailure(validation: RuntimeUrlValidationResult, url: string): RuntimeProbeFailure {
  return validation.failure ?? fallbackProbeFailure(url, validation.error ?? 'Runtime probe failed');
}

function isMissingRuntimeIdentityEndpoint(error: unknown): boolean {
  return error instanceof RuntimeTargetIdentityError && error.details?.httpStatus === 404;
}

function invalidProbeResult(failure: RuntimeProbeFailure): RuntimeUrlValidationResult {
  const statusPrefix = failure.httpStatus !== undefined ? `HTTP ${failure.httpStatus}: ` : '';
  return {
    valid: false,
    error: `${statusPrefix}${failure.reason}`,
    failure,
  };
}

function probeFailureFromError(error: unknown, endpoint: string): RuntimeProbeFailure {
  if (error instanceof RuntimeTargetIdentityError) {
    const status = error.details?.httpStatus;
    if (status !== undefined) {
      return {
        failureKind: 'http_rejection',
        endpoint: error.details?.endpoint ?? endpoint,
        reason: error.details?.reason ?? error.message,
        retryable: isRetryableHttpStatus(status),
        httpStatus: status,
        ...(status === 429 && error.details?.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.details.retryAfterSeconds }
          : {}),
      };
    }
    if (error.code === 'identity_invalid' || error.code === 'identity_response_too_large') {
      return {
        failureKind: 'invalid_response',
        endpoint,
        reason: safeReason(error.message),
        retryable: false,
      };
    }
    if (error.code === 'target_ca_file_unreadable' || error.code === 'identity_url_invalid') {
      return {
        failureKind: 'tls_failure',
        endpoint,
        reason: safeReason(error.message),
        retryable: false,
      };
    }
  }

  const cause = error instanceof Error && isErrorLike(error.cause) ? error.cause : error;
  const code = isErrorLike(cause) && typeof cause.code === 'string' ? cause.code : undefined;
  const message = cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error);
  if (code === 'ECONNREFUSED') {
    return {
      failureKind: 'connection_refused',
      endpoint,
      reason: 'Connection refused (ECONNREFUSED)',
      retryable: true,
    };
  }
  if (
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    /timed?\s*out/i.test(message)
  ) {
    return {
      failureKind: 'timeout',
      endpoint,
      reason: 'Request timed out',
      retryable: true,
    };
  }
  if (isTlsErrorCode(code)) {
    return {
      failureKind: 'tls_failure',
      endpoint,
      reason: code ? `TLS validation failed (${code})` : 'TLS validation failed',
      retryable: false,
    };
  }
  return {
    failureKind: 'network_failure',
    endpoint,
    reason: safeReason(message || 'Network request failed'),
    retryable: true,
  };
}

async function probeFailureFromResponse(
  response: {
    status: number;
    headers?: { get: (name: string) => string | null };
    json: () => Promise<unknown>;
  },
  endpoint: string,
): Promise<RuntimeProbeFailure> {
  const reason = (await readSafeResponseReason(response)) ?? `Server returned HTTP ${response.status}`;
  const retryAfterSeconds =
    response.status === 429 ? parseRetryAfterSeconds(response.headers?.get('retry-after')) : undefined;
  return {
    failureKind: 'http_rejection',
    endpoint,
    reason,
    retryable: isRetryableHttpStatus(response.status),
    httpStatus: response.status,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}

async function readSafeResponseReason(response: { json: () => Promise<unknown> }): Promise<string | undefined> {
  try {
    const body = await response.json();
    if (!isRecord(body)) {
      return undefined;
    }
    const nestedError = isRecord(body.error) ? body.error.message : undefined;
    const candidate =
      typeof body.error === 'string'
        ? body.error
        : typeof nestedError === 'string'
          ? nestedError
          : typeof body.message === 'string'
            ? body.message
            : typeof body.error_description === 'string'
              ? body.error_description
              : undefined;
    return candidate ? safeReason(candidate) : undefined;
  } catch {
    return undefined;
  }
}

function fallbackProbeFailure(url: string, reason: string): RuntimeProbeFailure {
  let endpoint = '/';
  try {
    endpoint = new URL(url).pathname;
  } catch {
    // Keep the bounded default path for malformed URLs.
  }
  return {
    failureKind: 'network_failure',
    endpoint,
    reason: safeReason(reason),
    retryable: true,
  };
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function parseRetryAfterSeconds(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const deltaSeconds = Number(value);
  if (Number.isFinite(deltaSeconds) && deltaSeconds >= 0) {
    return Math.ceil(deltaSeconds);
  }
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : undefined;
}

function safeReason(value: string): string {
  const sanitized = sanitizeForLogging(value);
  const reason = typeof sanitized === 'string' ? sanitized : String(sanitized);
  return stripControlCharacters(reason).trim().slice(0, 300) || 'Runtime probe failed';
}

function stripControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159) ? ' ' : character;
  }).join('');
}

function isTlsErrorCode(code: string | undefined): boolean {
  return Boolean(
    code &&
    (code.startsWith('ERR_TLS') ||
      code.startsWith('CERT_') ||
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
  );
}

function isErrorLike(value: unknown): value is { code?: unknown } {
  return typeof value === 'object' && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
