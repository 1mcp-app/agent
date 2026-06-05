import type { MCPServerParams } from '@src/core/types/index.js';
import type { RegistryServer, ServerPackage, ServerRemote } from '@src/domains/registry/types.js';

import {
  type DirectInstallationSource,
  type RegistryInstallationSource,
  type SelectedRegistryEndpoint,
  type TargetResolution,
} from './serverInstallationTypes.js';
import { deriveLocalName, isValidServerName } from './validators/serverNameValidator.js';

export function resolveDirectInstallTarget(source: DirectInstallationSource): TargetResolution {
  const fieldErrors = validateDirectSource(source);
  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: 'invalid_input',
      sourceType: 'direct',
      targetName: source.localName,
      fieldErrors,
      warnings: [],
    };
  }

  const config = createDirectServerConfig(source);
  return {
    sourceType: 'direct',
    targetName: source.localName,
    config,
    warnings: [],
    metadata: {
      localName: source.localName,
    },
  };
}

export function resolveRegistryInstallTarget(
  source: RegistryInstallationSource,
  registryServer: RegistryServer,
): TargetResolution {
  const endpoint = selectRegistryEndpoint(registryServer);
  if (!endpoint) {
    return {
      status: 'invalid_input',
      sourceType: 'registry',
      registryId: source.registryId,
      fieldErrors: {
        registryId: [`No compatible installation endpoint found for ${source.registryId}`],
      },
      warnings: [],
    };
  }

  const targetName = source.localName ?? deriveLocalName(source.registryId);
  if (!isValidServerName(targetName)) {
    return {
      status: 'invalid_input',
      sourceType: 'registry',
      registryId: source.registryId,
      targetName,
      fieldErrors: {
        localName: [`Local server name '${targetName}' is invalid`],
      },
      warnings: [],
    };
  }

  const config = createRegistryServerConfig({
    endpoint,
    registryId: source.registryId,
    targetName,
    tags: source.tags,
    env: source.env,
    args: source.args,
  });

  return {
    sourceType: 'registry',
    targetName,
    registryId: source.registryId,
    version: registryServer.version,
    config,
    selectedEndpoint: endpoint,
    warnings: [],
    metadata: {
      registryId: source.registryId,
      localName: targetName,
      version: registryServer.version,
      selectedEndpoint: endpoint,
    },
  };
}

export function validateRegistrySource(source: RegistryInstallationSource): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (!source.registryId?.trim()) {
    pushFieldError(errors, 'registryId', 'Registry ID is required');
  }
  if (source.localName && !isValidServerName(source.localName)) {
    pushFieldError(errors, 'localName', `Local server name '${source.localName}' is invalid`);
  }
  return errors;
}

function validateDirectSource(source: DirectInstallationSource): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const command = resolveDirectStdioCommand(source);

  if (!isValidServerName(source.localName)) {
    pushFieldError(errors, 'localName', `Local server name '${source.localName}' is invalid`);
  }

  if (source.transport === 'stdio') {
    if (!command?.trim()) {
      pushFieldError(errors, 'command', 'Direct stdio installs require command');
    }
    if (source.url) {
      pushFieldError(errors, 'url', 'Direct stdio installs cannot include url');
    }
    if (source.headers) {
      pushFieldError(errors, 'headers', 'Direct stdio installs cannot include headers');
    }
    return errors;
  }

  if (!source.url?.trim()) {
    pushFieldError(errors, 'url', `Direct ${source.transport} installs require url`);
  }
  if (source.command) {
    pushFieldError(errors, 'command', `Direct ${source.transport} installs cannot include command`);
  }
  if (source.args?.length) {
    pushFieldError(errors, 'args', `Direct ${source.transport} installs cannot include args`);
  }
  if (source.env && Object.keys(source.env).length > 0) {
    pushFieldError(errors, 'env', `Direct ${source.transport} installs cannot include env`);
  }
  if (source.cwd) {
    pushFieldError(errors, 'cwd', `Direct ${source.transport} installs cannot include cwd`);
  }

  return errors;
}

function createDirectServerConfig(source: DirectInstallationSource): MCPServerParams {
  const common = {
    tags: source.tags,
    timeout: source.timeout,
    disabled: source.enabled === undefined ? undefined : !source.enabled,
  };

  if (source.transport === 'stdio') {
    return omitUndefined({
      ...common,
      type: 'stdio',
      command: resolveDirectStdioCommand(source),
      args: resolveDirectStdioArgs(source),
      env: source.env,
      cwd: source.cwd,
      restartOnExit: source.autoRestart,
      maxRestarts: source.maxRestarts,
      restartDelay: source.restartDelay,
    });
  }

  return omitUndefined({
    ...common,
    type: source.transport,
    url: source.url,
    headers: source.headers,
  });
}

function resolveDirectStdioCommand(source: DirectInstallationSource): string | undefined {
  if (source.command) {
    return source.command;
  }

  return source.package ? 'npx' : undefined;
}

function resolveDirectStdioArgs(source: DirectInstallationSource): string[] | undefined {
  if (source.command || !source.package) {
    return source.args;
  }

  return ['-y', source.package, ...(source.args ?? [])];
}

function selectRegistryEndpoint(registryServer: RegistryServer): SelectedRegistryEndpoint | undefined {
  const packages = registryServer.packages ?? [];
  if (packages.length > 0) {
    const selectedPackage = packages.find((candidate) => candidate.registryType === 'npm') ?? packages[0];
    return packageEndpoint(selectedPackage);
  }

  const remotes = registryServer.remotes ?? [];
  if (remotes.length > 0) {
    const selectedRemote = remotes.find((candidate) => candidate.type === 'streamable-http') ?? remotes[0];
    return remoteEndpoint(selectedRemote);
  }

  return undefined;
}

function packageEndpoint(serverPackage: ServerPackage): SelectedRegistryEndpoint {
  return {
    kind: 'package',
    type: serverPackage.registryType,
    identifier: serverPackage.identifier,
  };
}

function remoteEndpoint(remote: ServerRemote): SelectedRegistryEndpoint {
  return {
    kind: 'remote',
    type: remote.type,
    url: remote.url,
  };
}

function createRegistryServerConfig(input: {
  endpoint: SelectedRegistryEndpoint;
  registryId: string;
  targetName: string;
  tags?: string[];
  env?: Record<string, string>;
  args?: string[];
}): MCPServerParams {
  const tags = Array.from(new Set([...(input.tags ?? []), input.targetName, input.registryId]));

  if (input.endpoint.kind === 'package') {
    if (input.endpoint.type !== 'npm') {
      throw new Error(`Unsupported package registry type for installation: ${input.endpoint.type}`);
    }

    return omitUndefined({
      type: 'stdio',
      command: 'npx',
      args: ['-y', input.endpoint.identifier, ...(input.args ?? [])],
      env: input.env,
      tags,
    });
  }

  return omitUndefined({
    type: input.endpoint.type === 'sse' ? 'sse' : 'http',
    url: input.endpoint.url,
    tags,
  });
}

function pushFieldError(errors: Record<string, string[]>, field: string, message: string): void {
  errors[field] = [...(errors[field] ?? []), message];
}

function omitUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}
