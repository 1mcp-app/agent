import fs from 'node:fs';

import type { GlobalOptions } from '@src/globalOptions.js';
import { discoverServerWithPidFile as defaultDiscoverServerWithPidFile } from '@src/utils/validation/urlDetection.js';

import {
  fetchRuntimeIdentity as defaultFetchRuntimeIdentity,
  type RuntimeTargetTlsOptions,
} from '../../domains/runtime-targets/runtimeIdentityVerification.js';
import {
  assertRuntimeTargetConfigDirAllowed,
  type RuntimeTargetListEntry,
  type RuntimeTargetObservedIdentity,
  RuntimeTargetStore,
  validateRuntimeTargetName,
} from '../../domains/runtime-targets/runtimeTargetStore.js';

export interface TargetCommandDependencies {
  store?: RuntimeTargetStore;
  fetchRuntimeIdentity?: (url: string, tls?: RuntimeTargetTlsOptions) => Promise<RuntimeTargetObservedIdentity>;
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
  caFile?: string;
  'ca-file'?: string;
  insecureSkipVerify?: boolean;
  'insecure-skip-verify'?: boolean;
  acceptNewIdentity?: boolean;
  'accept-new-identity'?: boolean;
}

export interface TargetUseOptions extends TargetCommandBaseOptions {
  json?: boolean;
  acceptInsecureTls?: boolean;
  'accept-insecure-tls'?: boolean;
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

export interface TargetVerifyOptions extends TargetCommandBaseOptions {
  json?: boolean;
  acceptInsecureTls?: boolean;
  'accept-insecure-tls'?: boolean;
}

export interface TargetExportOptions extends GlobalOptions {
  output?: string;
}

export interface TargetImportOptions extends GlobalOptions {
  file?: string;
  json?: boolean;
  dryRun?: boolean;
  'dry-run'?: boolean;
}

export interface TargetDoctorOptions extends GlobalOptions {
  fixSecrets?: boolean;
  'fix-secrets'?: boolean;
  pruneOrphans?: boolean;
  'prune-orphans'?: boolean;
}

export class TargetCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoveryCommand?: string,
    public readonly details?: unknown,
  ) {
    super(message);
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
    const caFile = options.caFile ?? options['ca-file'];
    const insecureSkipVerify = Boolean(options.insecureSkipVerify ?? options['insecure-skip-verify']);

    if (options.replace) {
      validateRuntimeTargetName(name);
      const existing = store.inspect(name);
      const previousRuntimeScopeId = existing.observedIdentity?.runtimeScopeId;
      const tlsOptions = targetTlsOptions({ caFile, insecureSkipVerify });
      const observedIdentity = tlsOptions
        ? await fetchRuntimeIdentity(url, tlsOptions)
        : await fetchRuntimeIdentity(url);
      const replacement: Parameters<RuntimeTargetStore['replaceVerifiedTarget']>[0] = {
        name,
        url,
        observedIdentity,
        caFile,
        insecureSkipVerify,
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
        caFile,
        insecureSkipVerify,
        use: Boolean(options.use),
      },
      ({ url: preparedUrl, caFile: preparedCaFile, insecureSkipVerify: preparedInsecureSkipVerify }) => {
        const tlsOptions = targetTlsOptions({
          caFile: preparedCaFile,
          insecureSkipVerify: preparedInsecureSkipVerify,
        });
        return tlsOptions ? fetchRuntimeIdentity(preparedUrl, tlsOptions) : fetchRuntimeIdentity(preparedUrl);
      },
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
  options: TargetUseOptions,
  dependencies: TargetCommandDependencies = {},
): Promise<void> {
  await withTargetErrors(async () => {
    const name = requireOption(options.name, 'target name');
    assertRuntimeTargetConfigDirAllowed({
      command: 'target-store',
      targetName: name,
      configDir: options['config-dir'],
    });

    const result = (dependencies.store ?? new RuntimeTargetStore()).useTarget(name, {
      acceptInsecureTls: Boolean(options.acceptInsecureTls ?? options['accept-insecure-tls']),
    });
    if (options.json) {
      writeTargetJsonSuccess({
        operation: 'target.use',
        warnings: result.warnings,
        result,
      });
      return;
    }
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

export async function targetExportCommand(
  options: TargetExportOptions,
  dependencies: TargetCommandDependencies = {},
): Promise<void> {
  await withTargetErrors(async () => {
    assertRuntimeTargetConfigDirAllowed({
      command: 'target-store',
      targetName: 'export',
      configDir: options['config-dir'],
    });

    const bundle = (dependencies.store ?? new RuntimeTargetStore()).exportTargetBundle();
    const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
    if (options.output) {
      fs.writeFileSync(options.output, serialized, 'utf8');
      process.stdout.write(`Exported runtime target bundle to ${options.output}.\n`);
      return;
    }
    process.stdout.write(serialized);
  });
}

export async function targetImportCommand(
  options: TargetImportOptions,
  dependencies: TargetCommandDependencies = {},
): Promise<void> {
  await withTargetErrors(async () => {
    const file = requireOption(options.file, 'target import file');
    assertRuntimeTargetConfigDirAllowed({
      command: 'target-store',
      targetName: 'import',
      configDir: options['config-dir'],
    });

    const bundle = parseImportBundle(await readImportBundle(file));
    const store = dependencies.store ?? new RuntimeTargetStore();
    const dryRun = Boolean(options.dryRun ?? options['dry-run']);
    const result = dryRun ? store.previewImportTargetBundle(bundle) : store.importTargetBundle(bundle);
    if (options.json) {
      writeTargetJsonSuccess({
        operation: 'target.import',
        warnings: result.warnings,
        result: {
          mode: dryRun ? 'dry_run' : 'import',
          additions: result.additions,
          validationFacts: result.validationFacts,
        },
      });
      return;
    }
    process.stdout.write(
      `${dryRun ? 'Dry run: would import' : 'Imported'} ${result.additions.length} runtime target(s).\n`,
    );
    for (const addition of result.additions) {
      process.stdout.write(`- ${addition.name} ${addition.url}\n`);
    }
    for (const warning of result.warnings) {
      process.stdout.write(`${warning.code}: ${warning.message}\n`);
    }
  });
}

export async function targetDoctorCommand(
  options: TargetDoctorOptions,
  dependencies: TargetCommandDependencies = {},
): Promise<void> {
  await withTargetErrors(async () => {
    assertRuntimeTargetConfigDirAllowed({
      command: 'target-store',
      targetName: 'doctor',
      configDir: options['config-dir'],
    });

    const result = (dependencies.store ?? new RuntimeTargetStore()).doctor({
      fixSecrets: Boolean(options.fixSecrets ?? options['fix-secrets']),
      pruneOrphans: Boolean(options.pruneOrphans ?? options['prune-orphans']),
    });

    if (result.issues.length === 0) {
      process.stdout.write('No runtime target store issues found.\n');
    } else {
      process.stdout.write('Issues:\n');
      for (const issue of result.issues) {
        process.stdout.write(formatDoctorLine(issue));
      }
    }

    if (result.repairs.length > 0) {
      process.stdout.write('Repairs:\n');
      for (const repair of result.repairs) {
        process.stdout.write(formatDoctorLine(repair));
      }
    }
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
  options: TargetVerifyOptions,
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
      if (options.json) {
        writeTargetJsonSuccess({
          operation: 'target.verify',
          warnings: [],
          result: {
            target: {
              name: 'local',
              kind: 'local',
              synthetic: true,
              url: discovered.url,
            },
            observedIdentity,
          },
        });
        return;
      }
      process.stdout.write(`Verified local runtime (${discovered.url}).\n`);
      process.stdout.write(`${formatIdentityDetails(observedIdentity)}`);
      return;
    }

    const store = dependencies.store ?? new RuntimeTargetStore();
    const target = store.requireInsecureTlsConfirmation({
      name,
      operation: 'verify',
      acceptInsecureTls: Boolean(options.acceptInsecureTls ?? options['accept-insecure-tls']),
    });
    if (target.kind !== 'remote' || !target.url) {
      throw new TargetCommandError('target_local_reserved', 'The built-in local target has no stored metadata');
    }

    const tlsOptions = targetTlsOptions({
      caFile: target.caFile,
      insecureSkipVerify: target.insecureSkipVerify,
    });
    const observedIdentity = tlsOptions
      ? await fetchRuntimeIdentity(target.url, tlsOptions)
      : await fetchRuntimeIdentity(target.url);
    const result = updateObservedIdentityWithRecovery(store, name, target.url, observedIdentity);
    if (options.json) {
      writeTargetJsonSuccess({
        operation: 'target.verify',
        warnings: result.warnings,
        result,
      });
      return;
    }
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
      'details' in error ? error.details : undefined,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function targetTlsOptions(tls: RuntimeTargetTlsOptions): RuntimeTargetTlsOptions | undefined {
  return tls.caFile || tls.insecureSkipVerify
    ? {
        ...(tls.caFile ? { caFile: tls.caFile } : {}),
        ...(tls.insecureSkipVerify ? { insecureSkipVerify: true } : {}),
      }
    : undefined;
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

function writeTargetJsonSuccess(input: {
  operation: string;
  warnings: Array<{ code: string; message: string; targetName?: string }>;
  result: unknown;
}): void {
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      cliProtocolVersion: '1',
      requestId: createCliRequestId(),
      operation: input.operation,
      warnings: input.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
        ...(warning.targetName ? { details: { targetName: warning.targetName } } : {}),
      })),
      result: input.result,
    })}\n`,
  );
}

function createCliRequestId(): string {
  return `cli_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function requireOption(value: string | undefined, label: string): string {
  if (!value) {
    throw new TargetCommandError('target_argument_missing', `Missing ${label}`);
  }
  return value;
}

async function readImportBundle(file: string): Promise<string> {
  if (file !== '-') {
    return fs.readFileSync(file, 'utf8');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseImportBundle(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new TargetCommandError(
      'target_import_validation_failed',
      'Runtime target import bundle failed validation',
      undefined,
      {
        validationFacts: [
          {
            code: 'invalid_bundle_schema',
            message: 'Runtime target import file must contain valid JSON',
          },
        ],
      },
    );
  }
}

function formatDoctorLine(entry: { code: string; targetName?: string; message: string }): string {
  const targetName = entry.targetName ? ` target=${entry.targetName}` : '';
  return `- ${entry.code}${targetName}: ${entry.message}\n`;
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
