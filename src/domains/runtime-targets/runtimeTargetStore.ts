import fs from 'node:fs';
import path from 'node:path';

import { getGlobalConfigDir } from '@src/constants.js';

const METADATA_FILE = 'runtime-targets.json';
const SECRETS_FILE = 'runtime-target-secrets.json';
const LOCK_FILE = '.runtime-targets.lock';
const STORE_SCHEMA_VERSION = 1;
const TARGET_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface RuntimeTargetObservedIdentity {
  identityProtocolVersion: '1';
  runtimeScopeId: string;
  externalUrl: string;
  runtimeVersion: string;
  serverTime?: string;
}

export interface RuntimeTargetStoreOptions {
  storeDir?: string;
  now?: () => Date;
}

export interface PrepareAddTargetInput {
  name: string;
  url: string;
  displayName?: string;
  use?: boolean;
}

export interface PreparedRuntimeTargetAdd {
  name: string;
  url: string;
  displayName?: string;
  use: boolean;
}

export interface RuntimeTargetCredentialReferences {
  oauth?: unknown;
  adminSession?: unknown;
}

export interface ReplaceVerifiedRuntimeTargetInput {
  name: string;
  url: string;
  observedIdentity: RuntimeTargetObservedIdentity;
  displayName?: string;
  acceptNewIdentity?: boolean;
}

export interface UpdateObservedIdentityResult {
  target: RuntimeTargetListEntry;
  warnings: Array<{ code: 'warning_external_url_mismatch'; message: string }>;
}

export type RuntimeTargetIdentityVerifier = (context: {
  targetName: string;
  url: string;
  storeLocked: boolean;
}) => RuntimeTargetObservedIdentity | Promise<RuntimeTargetObservedIdentity>;

export interface StoredRuntimeTarget {
  name: string;
  url: string;
  displayName?: string;
  observedIdentity?: RuntimeTargetObservedIdentity;
  lastVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeTargetListEntry {
  name: string;
  kind: 'local' | 'remote';
  synthetic: boolean;
  current: boolean;
  url?: string;
  displayName?: string;
  observedIdentity?: RuntimeTargetObservedIdentity;
  lastVerifiedAt?: string;
  verificationStatus: 'synthetic' | 'verified' | 'stale' | 'never-verified';
  credentialReferences: {
    oauth: boolean;
    adminSession: boolean;
  };
}

export interface RuntimeTargetUseResult {
  target: RuntimeTargetListEntry;
  warnings: Array<{ code: 'warning_target_stale' | 'warning_target_never_verified'; message: string }>;
}

interface RuntimeTargetMetadataFile {
  schemaVersion: 1;
  current?: string;
  targets: Record<string, StoredRuntimeTarget>;
}

interface RuntimeTargetSecretsFile {
  schemaVersion: 1;
  credentials: Record<string, Record<string, RuntimeTargetCredentialBucket>>;
}

interface RuntimeTargetCredentialBucket {
  oauth?: unknown;
  adminSession?: unknown;
}

export class RuntimeTargetStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeTargetStoreError';
  }
}

export class RuntimeTargetStore {
  private static readonly activeLocks = new Set<string>();

  private readonly storeDir: string;
  private readonly now: () => Date;

  static defaultStoreDir(): string {
    return getGlobalConfigDir();
  }

  constructor(options: RuntimeTargetStoreOptions = {}) {
    this.storeDir = options.storeDir ?? RuntimeTargetStore.defaultStoreDir();
    this.now = options.now ?? (() => new Date());
  }

  current(): RuntimeTargetListEntry {
    const metadata = this.readMetadata();
    const currentName = metadata.current && metadata.targets[metadata.current] ? metadata.current : 'local';
    return currentName === 'local' ? this.localEntry(true) : this.toListEntry(metadata.targets[currentName], true);
  }

  list(): RuntimeTargetListEntry[] {
    const metadata = this.readMetadata();
    const secrets = this.readSecretsForMetadataOnly();
    const currentName = metadata.current && metadata.targets[metadata.current] ? metadata.current : 'local';
    const local = this.localEntry(currentName === 'local', secrets);
    const remotes = Object.values(metadata.targets)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((target) => this.toListEntry(target, target.name === currentName, secrets));

    return [local, ...remotes];
  }

  inspect(name: string): RuntimeTargetListEntry {
    if (name === 'local') {
      return this.localEntry(this.current().name === 'local');
    }

    const metadata = this.readMetadata();
    const target = metadata.targets[name];
    if (!target) {
      throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${name}" was not found`);
    }
    return this.toListEntry(target, metadata.current === name);
  }

  useTarget(name: string): RuntimeTargetUseResult {
    if (name === 'local') {
      return this.withLock(() => {
        const metadata = this.readMetadata();
        this.writeMetadata({ ...metadata, current: undefined });
        return { target: this.localEntry(true), warnings: [] };
      });
    }

    return this.withLock(() => {
      const metadata = this.readMetadata();
      const target = metadata.targets[name];
      if (!target) {
        throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${name}" was not found`);
      }
      this.writeMetadata({ ...metadata, current: name });
      const entry = this.toListEntry(target, true);
      return {
        target: entry,
        warnings: verificationWarnings(entry),
      };
    });
  }

  deleteTarget(name: string, options: { force?: boolean } = {}): void {
    if (name === 'local') {
      throw new RuntimeTargetStoreError('target_local_reserved', 'The built-in local target cannot be deleted');
    }

    this.withLock(() => {
      const metadata = this.readMetadata();
      if (!metadata.targets[name]) {
        throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${name}" was not found`);
      }
      if (metadata.current === name && !options.force) {
        throw new RuntimeTargetStoreError(
          'target_is_current',
          'Cannot delete the current runtime target without force',
        );
      }

      const { [name]: _deleted, ...targets } = metadata.targets;
      const secrets = this.readSecretsForCredentialUse();
      const hadSecrets = secrets.credentials[name] !== undefined;
      const { [name]: _deletedSecrets, ...credentials } = secrets.credentials;
      const nextMetadata = {
        ...metadata,
        current: metadata.current === name ? undefined : metadata.current,
        targets,
      };
      if (hadSecrets) {
        this.writeSecretsThenMetadata(secrets, { ...secrets, credentials }, nextMetadata);
        return;
      }
      this.writeMetadata(nextMetadata);
    });
  }

  renameTarget(sourceName: string, destinationName: string): RuntimeTargetListEntry {
    if (sourceName === 'local') {
      throw new RuntimeTargetStoreError('target_local_reserved', 'The built-in local target cannot be renamed');
    }
    const normalizedDestinationName = validateRuntimeTargetName(destinationName);

    return this.withLock(() => {
      const metadata = this.readMetadata();
      const source = metadata.targets[sourceName];
      if (!source) {
        throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${sourceName}" was not found`);
      }
      if (metadata.targets[normalizedDestinationName]) {
        throw new RuntimeTargetStoreError(
          'target_already_exists',
          `Runtime target "${normalizedDestinationName}" already exists`,
        );
      }

      const renamed: StoredRuntimeTarget = {
        ...source,
        name: normalizedDestinationName,
        updatedAt: this.now().toISOString(),
      };
      const { [sourceName]: _removed, ...remainingTargets } = metadata.targets;
      const secrets = this.readSecretsForCredentialUse();
      const sourceSecrets = secrets.credentials[sourceName];
      const { [sourceName]: _removedSecrets, ...remainingCredentials } = secrets.credentials;
      const nextMetadata = {
        ...metadata,
        current: metadata.current === sourceName ? normalizedDestinationName : metadata.current,
        targets: {
          ...remainingTargets,
          [normalizedDestinationName]: renamed,
        },
      };
      if (sourceSecrets !== undefined) {
        this.writeSecretsThenMetadata(
          secrets,
          {
            ...secrets,
            credentials: {
              ...remainingCredentials,
              [normalizedDestinationName]: sourceSecrets,
            },
          },
          nextMetadata,
        );
      } else {
        this.writeMetadata(nextMetadata);
      }
      return this.toListEntry(renamed, metadata.current === sourceName);
    });
  }

  setCredentialReferences(name: string, runtimeScopeId: string, references: RuntimeTargetCredentialReferences): void {
    if (!runtimeScopeId) {
      throw new RuntimeTargetStoreError('identity_invalid', 'Runtime scope id is required for credential references');
    }

    this.withLock(() => {
      const metadata = this.readMetadata();
      if (name !== 'local' && !metadata.targets[name]) {
        throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${name}" was not found`);
      }

      const secrets = this.readSecretsForCredentialUse();
      const byScope = secrets.credentials[name] ?? {};
      this.writeSecrets({
        ...secrets,
        credentials: {
          ...secrets.credentials,
          [name]: {
            ...byScope,
            [runtimeScopeId]: compactCredentialReferences(references),
          },
        },
      });
    });
  }

  replaceVerifiedTarget(input: ReplaceVerifiedRuntimeTargetInput): RuntimeTargetListEntry {
    const name = validateRuntimeTargetName(input.name);
    const url = normalizeRuntimeTargetUrl(input.url);
    const hasDisplayNameInput = Object.prototype.hasOwnProperty.call(input, 'displayName');
    const nextDisplayName = hasDisplayNameInput ? normalizeDisplayName(input.displayName) : undefined;
    validateRuntimeIdentity(input.observedIdentity);

    return this.withLock(() => {
      const metadata = this.readMetadata();
      const existing = metadata.targets[name];
      if (!existing) {
        throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${name}" was not found`);
      }

      const previousRuntimeScopeId = existing.observedIdentity?.runtimeScopeId;
      const nextRuntimeScopeId = input.observedIdentity.runtimeScopeId;
      const identityChanged = previousRuntimeScopeId !== undefined && previousRuntimeScopeId !== nextRuntimeScopeId;
      if (identityChanged && !input.acceptNewIdentity) {
        throw new RuntimeTargetStoreError(
          'identity_runtime_scope_mismatch',
          'Runtime target identity changed; accept the new identity before replacing metadata',
        );
      }

      const now = this.now().toISOString();
      const updated: StoredRuntimeTarget = {
        ...existing,
        url,
        displayName: hasDisplayNameInput ? nextDisplayName : existing.displayName,
        observedIdentity: input.observedIdentity,
        lastVerifiedAt: now,
        updatedAt: now,
      };
      const secrets = this.readSecretsForCredentialUse();
      const shouldClearCredentials = identityChanged || existing.url !== url;
      const { [name]: _removedSecrets, ...credentials } = secrets.credentials;
      const nextSecrets = shouldClearCredentials ? { ...secrets, credentials } : secrets;
      const nextMetadata = {
        ...metadata,
        targets: {
          ...metadata.targets,
          [name]: updated,
        },
      };
      if (shouldClearCredentials && secrets.credentials[name] !== undefined) {
        this.writeSecretsThenMetadata(secrets, nextSecrets, nextMetadata);
      } else {
        this.writeMetadata(nextMetadata);
      }

      return this.toListEntry(updated, metadata.current === name, nextSecrets);
    });
  }

  updateObservedIdentityMetadata(
    name: string,
    observedIdentity: RuntimeTargetObservedIdentity,
  ): UpdateObservedIdentityResult {
    if (name === 'local') {
      throw new RuntimeTargetStoreError('target_local_reserved', 'The built-in local target has no stored metadata');
    }
    validateRuntimeIdentity(observedIdentity);

    return this.withLock(() => {
      const metadata = this.readMetadata();
      const existing = metadata.targets[name];
      if (!existing) {
        throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${name}" was not found`);
      }
      if (
        existing.observedIdentity?.runtimeScopeId &&
        existing.observedIdentity.runtimeScopeId !== observedIdentity.runtimeScopeId
      ) {
        throw new RuntimeTargetStoreError(
          'identity_runtime_scope_mismatch',
          'Runtime target identity changed; stored credentials cannot be used until identity replacement is accepted',
        );
      }

      const now = this.now().toISOString();
      const updated: StoredRuntimeTarget = {
        ...existing,
        observedIdentity,
        lastVerifiedAt: now,
        updatedAt: now,
      };
      this.writeMetadata({
        ...metadata,
        targets: {
          ...metadata.targets,
          [name]: updated,
        },
      });

      const entry = this.toListEntry(updated, metadata.current === name);
      return {
        target: entry,
        warnings: externalUrlWarnings(existing.url, observedIdentity),
      };
    });
  }

  prepareAddTarget(input: PrepareAddTargetInput): PreparedRuntimeTargetAdd {
    const name = validateRuntimeTargetName(input.name);
    const displayName = normalizeDisplayName(input.displayName);
    const url = normalizeRuntimeTargetUrl(input.url);

    this.withLock(() => {
      const metadata = this.readMetadata();
      if (metadata.targets[name]) {
        throw new RuntimeTargetStoreError('target_already_exists', `Runtime target "${name}" already exists`);
      }
    });

    return {
      name,
      url,
      displayName,
      use: input.use ?? false,
    };
  }

  commitVerifiedAdd(
    prepared: PreparedRuntimeTargetAdd,
    observedIdentity: RuntimeTargetObservedIdentity,
  ): RuntimeTargetListEntry {
    validateRuntimeIdentity(observedIdentity);

    return this.withLock(() => {
      const metadata = this.readMetadata();
      if (metadata.targets[prepared.name]) {
        throw new RuntimeTargetStoreError('target_already_exists', `Runtime target "${prepared.name}" already exists`);
      }

      const now = this.now().toISOString();
      const target: StoredRuntimeTarget = {
        name: prepared.name,
        url: prepared.url,
        displayName: prepared.displayName,
        observedIdentity,
        lastVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      this.writeMetadata({
        ...metadata,
        current: prepared.use ? prepared.name : metadata.current,
        targets: {
          ...metadata.targets,
          [prepared.name]: target,
        },
      });
      return this.toListEntry(target, prepared.use);
    });
  }

  async addVerifiedTarget(
    input: PrepareAddTargetInput,
    verifier: RuntimeTargetIdentityVerifier,
  ): Promise<RuntimeTargetListEntry> {
    const prepared = this.prepareAddTarget(input);
    const observedIdentity = await verifier({
      targetName: prepared.name,
      url: prepared.url,
      storeLocked: this.isLockedInThisProcess(),
    });
    return this.commitVerifiedAdd(prepared, observedIdentity);
  }

  private localEntry(current: boolean, secrets = this.readSecretsForMetadataOnly()): RuntimeTargetListEntry {
    return {
      name: 'local',
      kind: 'local',
      synthetic: true,
      current,
      verificationStatus: 'synthetic',
      credentialReferences: credentialReferencePresence(secrets.credentials.local),
    };
  }

  private toListEntry(
    target: StoredRuntimeTarget,
    current: boolean,
    secrets = this.readSecretsForMetadataOnly(),
  ): RuntimeTargetListEntry {
    return {
      name: target.name,
      kind: 'remote',
      synthetic: false,
      current,
      url: target.url,
      displayName: target.displayName,
      observedIdentity: target.observedIdentity,
      lastVerifiedAt: target.lastVerifiedAt,
      verificationStatus: this.verificationStatus(target),
      credentialReferences: credentialReferencePresence(secrets.credentials[target.name]),
    };
  }

  private verificationStatus(target: StoredRuntimeTarget): RuntimeTargetListEntry['verificationStatus'] {
    if (!target.lastVerifiedAt) {
      return 'never-verified';
    }
    const ageMs = this.now().getTime() - new Date(target.lastVerifiedAt).getTime();
    return ageMs > THIRTY_DAYS_MS ? 'stale' : 'verified';
  }

  private readMetadata(): RuntimeTargetMetadataFile {
    const filePath = this.metadataPath();
    if (!fs.existsSync(filePath)) {
      return { schemaVersion: STORE_SCHEMA_VERSION, targets: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<RuntimeTargetMetadataFile>;
    return {
      schemaVersion: STORE_SCHEMA_VERSION,
      current: typeof parsed.current === 'string' ? parsed.current : undefined,
      targets: isRecord(parsed.targets) ? (parsed.targets as Record<string, StoredRuntimeTarget>) : {},
    };
  }

  private readSecretsForMetadataOnly(): RuntimeTargetSecretsFile {
    const filePath = this.secretsPath();
    if (!fs.existsSync(filePath)) {
      return { schemaVersion: STORE_SCHEMA_VERSION, credentials: {} };
    }

    if (!isOwnerOnly(filePath)) {
      return { schemaVersion: STORE_SCHEMA_VERSION, credentials: {} };
    }

    return this.readSecretsUnchecked();
  }

  private readSecretsForCredentialUse(): RuntimeTargetSecretsFile {
    const filePath = this.secretsPath();
    if (!fs.existsSync(filePath)) {
      return { schemaVersion: STORE_SCHEMA_VERSION, credentials: {} };
    }
    if (!isOwnerOnly(filePath)) {
      throw new RuntimeTargetStoreError(
        'target_secret_store_insecure',
        'Runtime target secret store is too permissive',
      );
    }
    return this.readSecretsUnchecked();
  }

  private readSecretsUnchecked(): RuntimeTargetSecretsFile {
    const filePath = this.secretsPath();
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<RuntimeTargetSecretsFile>;
    return {
      schemaVersion: STORE_SCHEMA_VERSION,
      credentials: isRecord(parsed.credentials)
        ? (parsed.credentials as Record<string, Record<string, RuntimeTargetCredentialBucket>>)
        : {},
    };
  }

  private writeMetadata(metadata: RuntimeTargetMetadataFile): void {
    writeJsonAtomic(this.metadataPath(), metadata);
  }

  private writeSecrets(secrets: RuntimeTargetSecretsFile): void {
    writeJsonAtomic(this.secretsPath(), secrets, 0o600);
  }

  private writeSecretsThenMetadata(
    previousSecrets: RuntimeTargetSecretsFile,
    nextSecrets: RuntimeTargetSecretsFile,
    nextMetadata: RuntimeTargetMetadataFile,
  ): void {
    this.writeSecrets(nextSecrets);
    try {
      this.writeMetadata(nextMetadata);
    } catch (error) {
      try {
        this.writeSecrets(previousSecrets);
      } catch {
        // Keep the original metadata-write error as the reported failure.
      }
      throw error;
    }
  }

  private withLock<T>(fn: () => T): T {
    const release = this.acquireLock();
    try {
      return fn();
    } finally {
      release();
    }
  }

  private acquireLock(): () => void {
    fs.mkdirSync(this.storeDir, { recursive: true });
    const lockPath = this.lockPath();
    if (RuntimeTargetStore.activeLocks.has(lockPath)) {
      throw new RuntimeTargetStoreError('lock_unavailable', 'Another 1mcp command is editing runtime targets');
    }

    RuntimeTargetStore.activeLocks.add(lockPath);
    let fd: number | null = null;
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      RuntimeTargetStore.activeLocks.delete(lockPath);
      if (isFileExistsError(error)) {
        throw new RuntimeTargetStoreError('lock_unavailable', 'Another 1mcp command is editing runtime targets');
      }
      throw error;
    }

    return () => {
      if (fd !== null) {
        fs.closeSync(fd);
      }
      fs.rmSync(lockPath, { force: true });
      RuntimeTargetStore.activeLocks.delete(lockPath);
    };
  }

  private metadataPath(): string {
    return path.join(this.storeDir, METADATA_FILE);
  }

  private secretsPath(): string {
    return path.join(this.storeDir, SECRETS_FILE);
  }

  private lockPath(): string {
    return path.join(this.storeDir, LOCK_FILE);
  }

  private isLockedInThisProcess(): boolean {
    return RuntimeTargetStore.activeLocks.has(this.lockPath());
  }
}

export function validateRuntimeTargetName(name: string): string {
  if (!TARGET_NAME_PATTERN.test(name) || name.includes('/') || name.includes('\\')) {
    throw new RuntimeTargetStoreError('target_name_invalid', 'Runtime target name is invalid');
  }
  if (name === 'local') {
    throw new RuntimeTargetStoreError('target_name_reserved', 'Runtime target name "local" is reserved');
  }
  return name;
}

export function normalizeDisplayName(displayName: string | undefined): string | undefined {
  if (displayName === undefined) {
    return undefined;
  }
  const normalized = displayName.trim();
  if (normalized === '') {
    return undefined;
  }
  const codePoints = Array.from(normalized);
  if (codePoints.length > 80) {
    throw new RuntimeTargetStoreError('target_display_name_invalid', 'Runtime target display name is too long');
  }
  for (const char of codePoints) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || isControlCodePoint(codePoint) || isSurrogateCodePoint(codePoint)) {
      throw new RuntimeTargetStoreError('target_display_name_invalid', 'Runtime target display name is invalid');
    }
  }
  return normalized;
}

export function assertRuntimeTargetConfigDirAllowed(input: {
  command: 'target-store' | 'verify';
  targetName: string;
  configDir?: string;
}): void {
  if (!input.configDir) {
    return;
  }
  if (input.command === 'verify' && input.targetName === 'local') {
    return;
  }
  if (input.command === 'verify') {
    throw new RuntimeTargetStoreError(
      'target_config_dir_remote_unsupported',
      '--config-dir selects only a local Runtime Scope and cannot scope a remote target',
    );
  }
  throw new RuntimeTargetStoreError(
    'target_store_config_dir_unsupported',
    'Runtime target store commands are user-global and do not accept --config-dir',
  );
}

function normalizeRuntimeTargetUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RuntimeTargetStoreError('target_url_invalid', 'Runtime target URL is invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RuntimeTargetStoreError('target_url_invalid', 'Runtime target URL must use http or https');
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function compactCredentialReferences(references: RuntimeTargetCredentialReferences): RuntimeTargetCredentialBucket {
  const bucket: RuntimeTargetCredentialBucket = {};
  if (references.oauth !== undefined) {
    bucket.oauth = references.oauth;
  }
  if (references.adminSession !== undefined) {
    bucket.adminSession = references.adminSession;
  }
  return bucket;
}

function externalUrlWarnings(
  configuredUrl: string,
  observedIdentity: RuntimeTargetObservedIdentity,
): UpdateObservedIdentityResult['warnings'] {
  return normalizeUrlForComparison(configuredUrl) === normalizeUrlForComparison(observedIdentity.externalUrl)
    ? []
    : [
        {
          code: 'warning_external_url_mismatch',
          message: `Runtime target externalUrl differs from configured URL for "${configuredUrl}"`,
        },
      ];
}

function normalizeUrlForComparison(url: string): string {
  return url.replace(/\/$/, '');
}

function validateRuntimeIdentity(identity: RuntimeTargetObservedIdentity): void {
  if (
    identity.identityProtocolVersion !== '1' ||
    !identity.runtimeScopeId ||
    !identity.externalUrl ||
    !identity.runtimeVersion
  ) {
    throw new RuntimeTargetStoreError('identity_invalid', 'Runtime identity response is missing required fields');
  }
}

function credentialReferencePresence(
  byScope: Record<string, RuntimeTargetCredentialBucket> | undefined,
): RuntimeTargetListEntry['credentialReferences'] {
  const buckets = Object.values(byScope ?? {});
  return {
    oauth: buckets.some((bucket) => bucket.oauth !== undefined),
    adminSession: buckets.some((bucket) => bucket.adminSession !== undefined),
  };
}

function verificationWarnings(entry: RuntimeTargetListEntry): RuntimeTargetUseResult['warnings'] {
  if (entry.verificationStatus === 'stale') {
    return [{ code: 'warning_target_stale', message: `Runtime target "${entry.name}" has stale verification` }];
  }
  if (entry.verificationStatus === 'never-verified') {
    return [
      { code: 'warning_target_never_verified', message: `Runtime target "${entry.name}" has never been verified` },
    ];
  }
  return [];
}

function writeJsonAtomic(filePath: string, value: unknown, mode?: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode });
  fs.renameSync(tempPath, filePath);
  if (mode !== undefined) {
    fs.chmodSync(filePath, mode);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function isOwnerOnly(filePath: string): boolean {
  if (process.platform === 'win32') {
    return true;
  }
  return (fs.statSync(filePath).mode & 0o077) === 0;
}

function isControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function isSurrogateCodePoint(codePoint: number): boolean {
  return codePoint >= 0xd800 && codePoint <= 0xdfff;
}
