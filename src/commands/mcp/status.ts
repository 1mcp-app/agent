import { ApiClient } from '@src/commands/shared/apiClient.js';
import { type ResolvableServeTargetOptions, resolveServeTarget } from '@src/commands/shared/serveTargetResolver.js';
import { GlobalTransportConfig, MCPServerParams } from '@src/core/types/index.js';
import { RuntimeTargetStore } from '@src/domains/runtime-targets/runtimeTargetStore.js';
import { GlobalOptions } from '@src/globalOptions.js';
import { sanitizeForLogging } from '@src/logger/secureLogger.js';
import { inferTransportType } from '@src/transport/transportFactory.js';
import printer from '@src/utils/ui/printer.js';
import { stripMcpSuffix } from '@src/utils/urlUtils.js';

import type { Argv } from 'yargs';

import {
  getAllServerTargets,
  getEffectiveServerTargetConfig,
  getGlobalConfig,
  getInheritedKeys,
  initializeConfigContext,
  resolveServerTarget,
  validateConfigPath,
} from './utils/mcpServerConfig.js';
import { validateServerName } from './utils/validation.js';

export interface StatusCommandArgs extends GlobalOptions {
  name?: string;
  verbose?: boolean;
}

interface RuntimeStatusApiClient {
  get(path: string): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }>;
}

export interface StatusCommandDependencies {
  runtimeTargetStore?: { current(): { name: string } };
  resolveTarget?: (options: ResolvableServeTargetOptions & { context: string }) => Promise<{ discoveredUrl: string }>;
  createApiClient?: (baseUrl: string) => RuntimeStatusApiClient;
}

interface RuntimeSupervisionStatus {
  backendId?: string;
  name?: string;
  state: string;
  attempt?: number;
  limit?: number | null;
  nextRetryAt?: string | number | Date | null;
  lastExit?: {
    code?: number | null;
    signal?: string | null;
    pid?: number | null;
    at?: string | number | Date | null;
  } | null;
  lastError?: string | { message?: string } | null;
  error?: string | { message?: string } | null;
  currentPid?: number | null;
  instances?: RuntimeSupervisionStatus[];
}

interface AggregateRuntimeStatus {
  backendSupervision?: Record<string, RuntimeSupervisionStatus>;
}

/**
 * Build the status command configuration
 */
export function buildStatusCommand(yargs: Argv) {
  return yargs
    .positional('name', {
      describe: 'Name of specific server to check (optional)',
      type: 'string',
    })
    .option('verbose', {
      describe: 'Show detailed status information with effective merged configuration',
      type: 'boolean',
      default: false,
      alias: 'v',
    })
    .example([
      ['$0 mcp status', 'Show status of all servers'],
      ['$0 mcp status myserver', 'Show status of specific server'],
      ['$0 mcp status --verbose', 'Show detailed status information'],
    ]);
}

/**
 * Show status and details of MCP servers
 */
export async function statusCommand(
  argv: StatusCommandArgs,
  dependencies: StatusCommandDependencies = {},
): Promise<void> {
  try {
    const { name, config: configPath, 'config-dir': configDir, verbose = false } = argv;

    // Initialize ConfigContext with CLI options
    initializeConfigContext(configPath, configDir);

    // Validate config path
    validateConfigPath();

    if (name) {
      // Show status for specific server
      await showServerStatus(name, verbose, argv, dependencies);
    } else {
      // Show status for all servers
      await showAllServersStatus(verbose, argv, dependencies);
    }
  } catch (error) {
    printer.error(`Failed to get server status: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Show status for a specific server
 */
async function showServerStatus(
  serverName: string,
  verbose: boolean,
  argv: StatusCommandArgs,
  dependencies: StatusCommandDependencies,
): Promise<void> {
  // Validate server name
  validateServerName(serverName);

  // Get server configuration
  const rawServerConfig = resolveServerTarget(serverName)?.serverConfig;
  const effectiveServerConfig = getEffectiveServerTargetConfig(serverName);
  if (!rawServerConfig || !effectiveServerConfig) {
    throw new Error(`Server '${serverName}' does not exist.`);
  }

  printer.blank();
  printer.title(`Server Status: ${serverName}`);
  printer.blank();

  const runtimeStatus = await fetchRuntimeStatus(argv, dependencies, serverName);
  displayDetailedServerStatus(
    serverName,
    rawServerConfig,
    effectiveServerConfig,
    getGlobalConfig(),
    verbose,
    runtimeStatus,
  );
}

/**
 * Show status for all servers
 */
async function showAllServersStatus(
  verbose: boolean,
  argv: StatusCommandArgs,
  dependencies: StatusCommandDependencies,
): Promise<void> {
  const allServers = getAllServerTargets();
  const allEffectiveServers = Object.fromEntries(
    Object.keys(allServers).flatMap((serverName) => {
      const config = getEffectiveServerTargetConfig(serverName);
      return config ? [[serverName, config] as const] : [];
    }),
  );
  const globalConfig = getGlobalConfig();

  if (Object.keys(allEffectiveServers).length === 0) {
    printer.info('No MCP servers are configured.');
    printer.info('Use "mcp add <name>" to add your first server.');
    return;
  }

  printer
    .blank()
    .title(
      `MCP Servers Status (${Object.keys(allEffectiveServers).length} server${Object.keys(allEffectiveServers).length === 1 ? '' : 's'})`,
    )
    .blank();

  if (Object.keys(globalConfig).length > 0) {
    printer.subtitle('Global Defaults:');
    printer.keyValue({
      timeout: globalConfig.timeout !== undefined ? `${globalConfig.timeout}ms` : '(none)',
      connectionTimeout:
        globalConfig.connectionTimeout !== undefined ? `${globalConfig.connectionTimeout}ms` : '(none)',
      requestTimeout: globalConfig.requestTimeout !== undefined ? `${globalConfig.requestTimeout}ms` : '(none)',
    });
    printer.blank();
  }

  // Sort servers by name for consistent output
  const sortedServerNames = Object.keys(allEffectiveServers).sort();
  const aggregateRuntimeStatus = await fetchAggregateRuntimeStatus(argv, dependencies);

  for (const serverName of sortedServerNames) {
    const effectiveConfig = allEffectiveServers[serverName];
    displayServerStatusSummary(serverName, effectiveConfig);
    const target = resolveServerTarget(serverName);
    displayRuntimeSupervision(runtimeStatusForTarget(aggregateRuntimeStatus, serverName, target?.source), verbose);
    if (verbose && allServers[serverName]) {
      const inherited = getInheritedKeys(allServers[serverName], effectiveConfig, globalConfig);
      if (inherited.length > 0) {
        printer.keyValue({ Inherited: inherited.join(', ') });
      }
    }
    printer.blank(); // Empty line between servers
  }

  // Overall summary
  const enabledCount = sortedServerNames.filter((name) => !allEffectiveServers[name].disabled).length;
  const disabledCount = sortedServerNames.length - enabledCount;
  const stdioCount = sortedServerNames.filter((name) => allEffectiveServers[name].type === 'stdio').length;
  const httpCount = sortedServerNames.filter((name) => allEffectiveServers[name].type === 'http').length;
  const sseCount = sortedServerNames.filter((name) => allEffectiveServers[name].type === 'sse').length;
  const streamableHttpCount = sortedServerNames.filter(
    (name) => allEffectiveServers[name].type === 'streamableHttp',
  ).length;

  printer.subtitle('Overall Summary:');
  printer.keyValue({
    'Total Servers': sortedServerNames.length,
    'Enabled | Disabled': `${enabledCount} | ${disabledCount}`,
  });
  printer.subtitle('Transport Types:');
  printer.keyValue({
    stdio: stdioCount,
    http: httpCount,
    sse: sseCount,
    streamableHttp: streamableHttpCount,
  });

  // Get unique tags
  const allTags = new Set<string>();
  for (const config of Object.values(allEffectiveServers)) {
    if (config.tags) {
      config.tags.forEach((tag) => allTags.add(tag));
    }
  }

  if (allTags.size > 0) {
    printer.keyValue({ 'Available Tags': Array.from(allTags).sort().join(', ') });
  }

  if (verbose) {
    printer.blank();
    printer.info('Use "mcp status <name>" to see detailed information for a specific server.');
  }
}

/**
 * Display summary status for a server (used in list view)
 */
function displayServerStatusSummary(name: string, config: MCPServerParams): void {
  const statusIcon = config.disabled ? '🔴' : '🟢';
  const statusText = config.disabled ? 'Disabled' : 'Enabled';

  // Infer type if missing
  const inferredConfig = config.type ? config : inferTransportType(config, name);
  const displayType = inferredConfig.type || 'unknown';

  printer.raw(`${statusIcon} ${name}`);
  printer.keyValue({
    Status: statusText,
    Type: displayType,
  });

  if (inferredConfig.type === 'stdio' && inferredConfig.command) {
    printer.keyValue({ Command: inferredConfig.command });
  } else if (
    (inferredConfig.type === 'http' || inferredConfig.type === 'sse' || inferredConfig.type === 'streamableHttp') &&
    inferredConfig.url
  ) {
    printer.keyValue({ URL: inferredConfig.url });
  }

  if (config.tags && config.tags.length > 0) {
    printer.keyValue({ Tags: config.tags.join(', ') });
  }
}

/**
 * Display detailed status for a server (used in single server view)
 */
function displayDetailedServerStatus(
  name: string,
  rawConfig: MCPServerParams,
  effectiveConfig: MCPServerParams,
  globalConfig: GlobalTransportConfig,
  verbose: boolean,
  runtimeStatus?: RuntimeSupervisionStatus,
): void {
  const statusIcon = effectiveConfig.disabled ? '🔴' : '🟢';
  const statusText = effectiveConfig.disabled ? 'Disabled' : 'Enabled';

  // Infer type if missing
  const inferredConfig = effectiveConfig.type ? effectiveConfig : inferTransportType(effectiveConfig, name);
  const displayType = inferredConfig.type || 'unknown';

  printer.subtitle('Configuration:');
  printer.keyValue({
    Name: name,
    Status: `${statusIcon} ${statusText}`,
    Type: displayType,
  });

  // Type-specific configuration
  if (inferredConfig.type === 'stdio') {
    if (inferredConfig.command) {
      printer.keyValue({ Command: inferredConfig.command });
    }

    if (inferredConfig.args && inferredConfig.args.length > 0) {
      printer.keyValue({ Arguments: '(see below)' });
      inferredConfig.args.forEach((arg, index) => {
        printer.raw(`     [${index}]: ${arg}`);
      });
    } else {
      printer.keyValue({ Arguments: '(none)' });
    }

    printer.keyValue({ 'Working Directory': inferredConfig.cwd || '(current directory)' });
  } else if (
    inferredConfig.type === 'http' ||
    inferredConfig.type === 'sse' ||
    inferredConfig.type === 'streamableHttp'
  ) {
    if (inferredConfig.url) {
      printer.keyValue({ URL: inferredConfig.url });
    }

    if (inferredConfig.headers && Object.keys(inferredConfig.headers).length > 0) {
      printer.keyValue({ Headers: '(see below)' });
      for (const [key, value] of Object.entries(inferredConfig.headers)) {
        printer.raw(`     ${key}: ${value}`);
      }
    } else {
      printer.keyValue({ Headers: '(none)' });
    }
  }

  // Common configuration
  printer.keyValue({
    Timeout: inferredConfig.timeout !== undefined ? `${inferredConfig.timeout}ms` : '(default)',
    'Connection Timeout':
      inferredConfig.connectionTimeout !== undefined ? `${inferredConfig.connectionTimeout}ms` : '(default)',
    'Request Timeout': inferredConfig.requestTimeout !== undefined ? `${inferredConfig.requestTimeout}ms` : '(default)',
  });
  printer.keyValue({
    Tags: inferredConfig.tags && inferredConfig.tags.length > 0 ? inferredConfig.tags.join(', ') : '(none)',
  });

  // Environment variables
  if (inferredConfig.env && Object.keys(inferredConfig.env).length > 0) {
    printer.keyValue({ 'Environment Variables': '(see below)' });
    for (const [key, value] of Object.entries(inferredConfig.env)) {
      // Show first few characters for security, unless verbose mode
      if (verbose) {
        printer.raw(`     ${key}=${value}`);
      } else {
        const strValue = String(value);
        const displayValue = strValue.length > 20 ? `${strValue.substring(0, 20)}...` : strValue;
        printer.raw(`     ${key}=${displayValue}`);
      }
    }
  } else {
    printer.keyValue({ 'Environment Variables': '(none)' });
  }

  const inherited = getInheritedKeys(rawConfig, effectiveConfig, globalConfig);
  if (inherited.length > 0) {
    printer.keyValue({ Inherited: inherited.join(', ') });
  }

  printer.blank();
  printer.subtitle('Runtime Information:');
  printer.keyValue({ 'Effective Configuration': JSON.stringify(sanitizeForLogging(effectiveConfig)) });

  if (runtimeStatus) {
    displayRuntimeSupervision(runtimeStatus, verbose);
  } else if (effectiveConfig.disabled) {
    printer.keyValue({ 'Runtime Status': '⏹️  Not running (disabled)' });
    printer.info(`Use 'mcp enable ${name}' to enable this server.`);
  } else {
    printer.keyValue({ 'Runtime Status': '❓ Unknown (requires 1mcp to be running)' });
    printer.info('Start 1mcp to see actual runtime status.');
  }

  // Validation status
  printer.blank();
  printer.subtitle('Validation:');
  try {
    validateServerConfiguration(effectiveConfig);
    printer.info('Configuration: Valid ✓');
  } catch (error) {
    printer.error('Configuration: Invalid ❌');
    printer.info(`Error: ${error instanceof Error ? error.message : error}`);
  }

  // Quick actions
  printer.blank();
  printer.subtitle('Quick Actions:');
  if (effectiveConfig.disabled) {
    printer.info(`   • Enable: mcp enable ${name}`);
  } else {
    printer.info(`   • Disable: mcp disable ${name}`);
  }
  printer.info(`   • Update: mcp update ${name} [options]`);
  printer.info(`   • Remove: server remove ${name}`);
}

async function fetchRuntimeStatus(
  argv: StatusCommandArgs,
  dependencies: StatusCommandDependencies,
  serverName: string,
): Promise<RuntimeSupervisionStatus | undefined> {
  const status = await fetchRuntimeHealth<unknown>(argv, dependencies, `/health/mcp/${encodeURIComponent(serverName)}`);
  return isRuntimeSupervisionStatus(status) ? status : undefined;
}

async function fetchAggregateRuntimeStatus(
  argv: StatusCommandArgs,
  dependencies: StatusCommandDependencies,
): Promise<AggregateRuntimeStatus | undefined> {
  const status = await fetchRuntimeHealth<unknown>(argv, dependencies, '/health/mcp');
  return isAggregateRuntimeStatus(status) ? status : undefined;
}

async function fetchRuntimeHealth<T>(
  argv: StatusCommandArgs,
  dependencies: StatusCommandDependencies,
  path: string,
): Promise<T | undefined> {
  try {
    const store = dependencies.runtimeTargetStore ?? new RuntimeTargetStore();
    const context = store.current().name;
    const resolver = dependencies.resolveTarget ?? ((options) => resolveServeTarget(options));
    const target = await resolver({ ...argv, context });
    const baseUrl = stripMcpSuffix(target.discoveredUrl);
    const client = dependencies.createApiClient?.(baseUrl) ?? new ApiClient({ baseUrl, timeout: 2_000 });
    const response = await client.get(path);
    // Degraded backend health intentionally returns 503 with structured state facts.
    return response.data as T | undefined;
  } catch {
    return undefined;
  }
}

function isRuntimeSupervisionStatus(value: unknown): value is RuntimeSupervisionStatus {
  return typeof value === 'object' && value !== null && typeof (value as { state?: unknown }).state === 'string';
}

function isAggregateRuntimeStatus(value: unknown): value is AggregateRuntimeStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { backendSupervision?: unknown }).backendSupervision === 'object' &&
    (value as { backendSupervision?: unknown }).backendSupervision !== null
  );
}

function displayRuntimeSupervision(status?: RuntimeSupervisionStatus, showInstances = false): void {
  if (!status) {
    return;
  }

  printer.keyValue({ 'Runtime Status': status.state });
  if (status.instances?.length) {
    const stateCounts = countInstanceStates(status.instances);
    printer.keyValue({
      'Active Instances': status.instances.length,
      'Instance States': Object.entries(stateCounts)
        .map(([state, count]) => `${state}=${count}`)
        .join(', '),
    });
    if (!showInstances) {
      return;
    }
    for (const instance of status.instances) {
      const instanceId = instance.backendId?.split(':').at(-1);
      printer.subtitle(`Instance ${instanceId?.slice(0, 12) || 'unknown'}:`);
      displayRuntimeSupervision({ ...instance, instances: undefined });
    }
    return;
  }
  if (status.attempt !== undefined) {
    printer.keyValue({
      'Restart Attempt':
        status.limit === null ? `${status.attempt} / unlimited` : `${status.attempt} / ${status.limit ?? '?'}`,
    });
  }
  if (status.nextRetryAt) {
    printer.keyValue({ 'Next Retry': formatRuntimeTimestamp(status.nextRetryAt) });
  }
  if (status.lastExit) {
    const exitFacts = [
      `code=${status.lastExit.code ?? 'none'}`,
      `signal=${status.lastExit.signal ?? 'none'}`,
      status.lastExit.pid != null ? `pid=${status.lastExit.pid}` : undefined,
      status.lastExit.at ? `at=${formatRuntimeTimestamp(status.lastExit.at)}` : undefined,
    ].filter((value): value is string => value !== undefined);
    printer.keyValue({ 'Last Exit': exitFacts.join(', ') });
  }
  const error = runtimeErrorMessage(status.lastError ?? status.error);
  if (error) {
    printer.keyValue({ 'Last Error': error });
  }
  if (status.currentPid != null) {
    printer.keyValue({ 'Current PID': status.currentPid });
  }
}

function runtimeStatusForTarget(
  aggregate: AggregateRuntimeStatus | undefined,
  serverName: string,
  source: 'mcpServers' | 'mcpTemplates' | undefined,
): RuntimeSupervisionStatus | undefined {
  const snapshots = aggregate?.backendSupervision;
  if (!snapshots) {
    return undefined;
  }

  const direct = snapshots[serverName];
  if (source !== 'mcpTemplates') {
    return direct;
  }
  if (direct?.instances) {
    return direct;
  }

  const instances = Object.values(snapshots).filter((snapshot) =>
    snapshot.backendId?.startsWith(`template:${serverName}:`),
  );
  if (instances.length === 0) {
    return direct;
  }

  return {
    name: serverName,
    state: aggregateInstanceState(instances),
    instances,
  };
}

function aggregateInstanceState(instances: RuntimeSupervisionStatus[]): string {
  if (instances.some((instance) => instance.state === 'crash-loop')) {
    return 'crash-loop';
  }
  if (instances.some((instance) => instance.state === 'restarting')) {
    return 'restarting';
  }
  if (instances.every((instance) => instance.state === 'connected')) {
    return 'connected';
  }
  return 'stopped';
}

function countInstanceStates(instances: RuntimeSupervisionStatus[]): Record<string, number> {
  return instances.reduce<Record<string, number>>((counts, instance) => {
    counts[instance.state] = (counts[instance.state] ?? 0) + 1;
    return counts;
  }, {});
}

function formatRuntimeTimestamp(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function runtimeErrorMessage(value: RuntimeSupervisionStatus['lastError']): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return value?.message;
}

/**
 * Validate server configuration
 */
function validateServerConfiguration(config: MCPServerParams): void {
  if (!config.type) {
    throw new Error('Server type is required');
  }

  switch (config.type) {
    case 'stdio':
      if (!config.command) {
        throw new Error('Command is required for stdio servers');
      }
      break;
    case 'http':
    case 'sse':
    case 'streamableHttp':
      if (!config.url) {
        throw new Error(`URL is required for ${config.type} servers`);
      }
      try {
        new URL(config.url);
      } catch {
        throw new Error('Invalid URL format');
      }
      break;
    default:
      throw new Error(`Unsupported server type: ${config.type}`);
  }
}
