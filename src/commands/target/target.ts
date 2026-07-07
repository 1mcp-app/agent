import type { GlobalOptions } from '@src/globalOptions.js';
import { discoverServerWithPidFile as defaultDiscoverServerWithPidFile } from '@src/utils/validation/urlDetection.js';

import { fetchRuntimeIdentity as defaultFetchRuntimeIdentity } from '../../domains/runtime-targets/runtimeIdentityVerification.js';
import {
  assertRuntimeTargetConfigDirAllowed,
  type RuntimeTargetListEntry,
  type RuntimeTargetObservedIdentity,
  RuntimeTargetStore,
  validateRuntimeTargetName,
} from '../../domains/runtime-targets/runtimeTargetStore.js';

export interface TargetCommandDependencies {
  store?: RuntimeTargetStore;
  fetchRuntimeIdentity?: (url: string) => Promise<RuntimeTargetObservedIdentity>;
  discoverServerWithPidFile?: typeof defaultDiscoverServerWithPidFile;
}

interface TargetCommandBaseOptions extends GlobalOptions {
  name?: string;
}

export interface TargetAddOptions extends TargetCommandBaseOptions {
  url?: string;
  use?: boolean;
  replace?: boolean;
  displayName?: string;
  'display-name'?: string;
  acceptNewIdentity?: boolean;
  'accept-new-identity'?: boolean;
}

export interface TargetRenameOptions extends GlobalOptions {
  oldName?: string;
  newName?: string;
  old?: string;
  new?: string;
}

export interface TargetDeleteOptions extends TargetCommandBaseOptions {
  force?: boolean;
}

export class TargetCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoveryCommand?: string,
  ) {
    super(`${code}: ${message}${recoveryCommand ? `\nRecovery: ${recoveryCommand}` : ''}`);
    this.name = 'TargetCommandError';
  }
}

export async function targetAddCommand(
  options: TargetAddOptions,
  dependencies: TargetCommandDependencies = {},
): Promise<void> {
  await withTargetErrors(async () => {
    const name = requireOption(options.name, 'target name');
    const url = requireOption(options.url, 'target URL');
    assertRuntimeTargetConfigDirAllowed({
      command: 'target-store',
      targetName: name,
      configDir: options['config-dir'],
    });

    const store = dependencies.store ?? new RuntimeTargetStore();
    const fetchRuntimeIdentity = dependencies.fetchRuntimeIdentity ?? defaultFetchRuntimeIdentity;
    const displayName = options.displayName ?? options['display-name'];

    if (options.replace) {
      validateRuntimeTargetName(name);
      const existing = store.inspect(name);
      const previousRuntimeScopeId = existing.observedIdentity?.runtimeScopeId;
      const observedIdentity = await fetchRuntimeIdentity(url);
      const replacement: Parameters<RuntimeTargetStore['replaceVerifiedTarget']>[0] = {
        name,
        url,
        observedIdentity,
        acceptNewIdentity: Boolean(options.acceptNewIdentity ?? options['accept-new-identity']),
      };
      if (displayName !== undefined) {
        replacement.displayName = displayName;
      }
      const target = replaceTargetWithRecovery(store, replacement);
      process.stdout.write(`Replaced runtime target "${target.name}" (${target.url}).\n`);
      if (previousRuntimeScopeId && previousRuntimeScopeId !== observedIdentity.runtimeScopeId) {
        process.stdout.write(`runtimeScopeId: ${previousRuntimeScopeId} -> ${observedIdentity.runtimeScopeId}\n`);
      }
      return;
    }

    const target = await store.addVerifiedTarget(
      {
        name,
        url,
        displayName,
        use: Boolean(options.use),
      },
      ({ url: preparedUrl }) => fetchRuntimeIdentity(preparedUrl),
    );

    process.stdout.write(`Added runtime target "${target.name}" (${target.url}).\n`);
    if (target.current) {
      process.stdout.write(`Current target: ${target.name}\n`);
    } else {
      process.stdout.write(`Next: target use ${target.name}\n`);
    }
  });
}

export async function targetUseCommand(
  options: TargetCommandBaseOptions,
  dependencies: TargetCommandDependencies = {},
): Promise<void> {
  await withTargetErrors(async () => {
    const name = requireOption(options.name, 'target name');
    assertRuntimeTargetConfigDirAllowed({
      command: 'target-store',
      targetName: name,
      configDir: options['config-dir'],
    });

    const result = (dependencies.store ?? new RuntimeTargetStore()).useTarget(name);
    process.stdout.write(
      `Current target: ${result.target.name}${result.target.synthetic ? ' (synthetic local)' : ''}\n`,
    );
    for (const warning of result.warnings) {
      process.stdout.write(`${warning.code}: ${warning.message}. Run: target verify ${result.target.name}\n`);
    }
  });
}

export async function targetCurrentCommand(
  options: GlobalOptions,
  dependencies: TargetCommandDependencies = {},
): Promise<void> {
  await withTargetErrors(async () => {
    assertRuntimeTargetConfigDirAllowed({
      command: 'target-store',
      targetName: 'current',
      configDir: options['config-dir'],
    });

    const target = (dependencies.store ?? new RuntimeTargetStore()).current();
    process.stdout.write(`Current target: ${target.name}${target.synthetic ? ' (synthetic local)' : ''}\n`);
    process.stdout.write(`${formatEntryDetails(target)}`);
  });
}

export async function targetListCommand(
  options: GlobalOptions,
  dependencies: TargetCommandDependencies = {},
): Promise<void> {
  await withTargetErrors(async () => {
    assertRuntimeTargetConfigDirAllowed({
      command: 'target-store',
      targetName: 'list',
      configDir: options['config-dir'],
    });

    const targets = (dependencies.store ?? new RuntimeTargetStore()).list();
    process.stdout.write('Runtime targets:\n');
    for (const target of targets) {
      process.stdout.write(`${formatListEntry(target)}\n`);
    }
  });
}

export async function targetInspectCommand(
  options: TargetCommandBaseOptions,
  dependencies: TargetCommandDependencies = {},
): Promise<void> {
  await withTargetErrors(async () => {
    const name = requireOption(options.name, 'target name');
    assertRuntimeTargetConfigDirAllowed({
      command: 'target-store',
      targetName: name,
      configDir: options['config-dir'],
    });

    const target = (dependencies.store ?? new RuntimeTargetStore()).inspect(name);
    process.stdout.write(`Target: ${target.name}\n`);
    process.stdout.write(`${formatEntryDetails(target)}`);
  });
}

export async function targetDeleteCommand(
  options: TargetDeleteOptions,
  dependencies: TargetCommandDependencies = {},
): Promise<void> {
  await withTargetErrors(async () => {
    const name = requireOption(options.name, 'target name');
    assertRuntimeTargetConfigDirAllowed({
      command: 'target-store',
      targetName: name,
      configDir: options['config-dir'],
    });

    (dependencies.store ?? new RuntimeTargetStore()).deleteTarget(name, { force: Boolean(options.force) });
    process.stdout.write(`Deleted runtime target "${name}".\n`);
  });
}

export async function targetRenameCommand(
  options: TargetRenameOptions,
  dependencies: TargetCommandDependencies = {},
): Promise<void> {
  await withTargetErrors(async () => {
    const oldName = requireOption(options.oldName ?? options.old, 'source target name');
    const newName = requireOption(options.newName ?? options.new, 'destination target name');
    assertRuntimeTargetConfigDirAllowed({
      command: 'target-store',
      targetName: oldName,
      configDir: options['config-dir'],
    });

    const target = (dependencies.store ?? new RuntimeTargetStore()).renameTarget(oldName, newName);
    process.stdout.write(`Renamed runtime target "${oldName}" to "${target.name}".\n`);
  });
}

export async function targetVerifyCommand(
  options: TargetCommandBaseOptions,
  dependencies: TargetCommandDependencies = {},
): Promise<void> {
  await withTargetErrors(async () => {
    const name = requireOption(options.name, 'target name');
    assertRuntimeTargetConfigDirAllowed({ command: 'verify', targetName: name, configDir: options['config-dir'] });

    const fetchRuntimeIdentity = dependencies.fetchRuntimeIdentity ?? defaultFetchRuntimeIdentity;
    if (name === 'local') {
      const discoverServerWithPidFile = dependencies.discoverServerWithPidFile ?? defaultDiscoverServerWithPidFile;
      const discovered = await discoverServerWithPidFile(options['config-dir']);
      const observedIdentity = await fetchRuntimeIdentity(discovered.url);
      process.stdout.write(`Verified local runtime (${discovered.url}).\n`);
      process.stdout.write(`${formatIdentityDetails(observedIdentity)}`);
      return;
    }

    const store = dependencies.store ?? new RuntimeTargetStore();
    const target = store.inspect(name);
    if (target.kind !== 'remote' || !target.url) {
      throw new TargetCommandError('target_local_reserved', 'The built-in local target has no stored metadata');
    }

    const observedIdentity = await fetchRuntimeIdentity(target.url);
    const result = updateObservedIdentityWithRecovery(store, name, target.url, observedIdentity);
    process.stdout.write(`Verified runtime target "${name}" (${target.url}).\n`);
    for (const warning of result.warnings) {
      process.stdout.write(`${warning.code}: ${warning.message}\n`);
    }
    process.stdout.write(`${formatIdentityDetails(result.target.observedIdentity)}`);
  });
}

async function withTargetErrors(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    throw normalizeTargetError(error);
  }
}

function replaceTargetWithRecovery(
  store: RuntimeTargetStore,
  input: Parameters<RuntimeTargetStore['replaceVerifiedTarget']>[0],
): RuntimeTargetListEntry {
  try {
    return store.replaceVerifiedTarget(input);
  } catch (error) {
    if (isCodedError(error) && error.code === 'identity_runtime_scope_mismatch') {
      throw new TargetCommandError(
        error.code,
        error.message,
        `1mcp target add ${input.name} ${input.url} --replace --accept-new-identity`,
      );
    }
    throw error;
  }
}

function updateObservedIdentityWithRecovery(
  store: RuntimeTargetStore,
  name: string,
  url: string,
  observedIdentity: RuntimeTargetObservedIdentity,
): ReturnType<RuntimeTargetStore['updateObservedIdentityMetadata']> {
  try {
    return store.updateObservedIdentityMetadata(name, observedIdentity);
  } catch (error) {
    if (isCodedError(error) && error.code === 'identity_runtime_scope_mismatch') {
      throw new TargetCommandError(
        error.code,
        error.message,
        `1mcp target add ${name} ${url} --replace --accept-new-identity`,
      );
    }
    throw error;
  }
}

function normalizeTargetError(error: unknown): Error {
  if (error instanceof TargetCommandError) {
    return error;
  }
  if (isCodedError(error)) {
    return new TargetCommandError(
      error.code,
      error.message,
      'recoveryCommand' in error && typeof error.recoveryCommand === 'string' ? error.recoveryCommand : undefined,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isCodedError(error: unknown): error is { code: string; message: string; recoveryCommand?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

function requireOption(value: string | undefined, label: string): string {
  if (!value) {
    throw new TargetCommandError('target_argument_missing', `Missing ${label}`);
  }
  return value;
}

function formatListEntry(target: RuntimeTargetListEntry): string {
  const marker = target.current ? '*' : ' ';
  const url = target.url ? ` url=${target.url}` : '';
  const identity = target.observedIdentity
    ? ` runtimeScopeId=${target.observedIdentity.runtimeScopeId} runtimeVersion=${target.observedIdentity.runtimeVersion}`
    : '';
  const verified = target.lastVerifiedAt ? ` lastVerifiedAt=${target.lastVerifiedAt}` : '';
  return `${marker} ${target.name} kind=${target.kind}${target.synthetic ? ' synthetic=true' : ''}${url}${identity}${verified} verification=${target.verificationStatus} credentials=${formatCredentials(target)}`;
}

function formatEntryDetails(target: RuntimeTargetListEntry): string {
  const lines = [
    `kind: ${target.kind}`,
    `current: ${target.current ? 'yes' : 'no'}`,
    `synthetic: ${target.synthetic ? 'yes' : 'no'}`,
  ];
  if (target.displayName) {
    lines.push(`displayName: ${target.displayName}`);
  }
  if (target.url) {
    lines.push(`url: ${target.url}`);
  }
  if (target.observedIdentity) {
    lines.push(...formatIdentityDetails(target.observedIdentity).trimEnd().split('\n'));
  }
  if (target.lastVerifiedAt) {
    lines.push(`lastVerifiedAt: ${target.lastVerifiedAt}`);
  }
  lines.push(`verification: ${target.verificationStatus}`);
  lines.push(`credentials: ${formatCredentials(target)}`);
  return `${lines.join('\n')}\n`;
}

function formatIdentityDetails(identity: RuntimeTargetObservedIdentity | undefined): string {
  if (!identity) {
    return '';
  }
  const lines = [
    `identityProtocolVersion: ${identity.identityProtocolVersion}`,
    `runtimeScopeId: ${identity.runtimeScopeId}`,
    `externalUrl: ${identity.externalUrl}`,
    `runtimeVersion: ${identity.runtimeVersion}`,
  ];
  if (identity.serverTime) {
    lines.push(`serverTime: ${identity.serverTime}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatCredentials(target: RuntimeTargetListEntry): string {
  const labels = [];
  if (target.credentialReferences.oauth) {
    labels.push('oauth');
  }
  if (target.credentialReferences.adminSession) {
    labels.push('admin');
  }
  return labels.length > 0 ? labels.join(',') : 'none';
}
