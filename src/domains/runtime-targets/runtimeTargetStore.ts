import fs from 'node:fs';
import net from 'node:net';
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
  caFile?: string;
  insecureSkipVerify?: boolean;
  use?: boolean;
}

export interface PreparedRuntimeTargetAdd {
  name: string;
  url: string;
  displayName?: string;
  caFile?: string;
  insecureSkipVerify?: boolean;
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
  caFile?: string;
  insecureSkipVerify?: boolean;
  acceptNewIdentity?: boolean;
}

export interface UpdateObservedIdentityResult {
  target: RuntimeTargetListEntry;
  warnings: Array<{ code: 'warning_external_url_mismatch'; message: string }>;
}

export type RuntimeTargetIdentityVerifier = (context: {
  targetName: string;
  url: string;
  caFile?: string;
  insecureSkipVerify?: boolean;
  storeLocked: boolean;
}) => RuntimeTargetObservedIdentity | Promise<RuntimeTargetObservedIdentity>;

export interface StoredRuntimeTarget {
  name: string;
  url: string;
  displayName?: string;
  caFile?: string;
  insecureSkipVerify?: boolean;
  insecureTlsConfirmationRequired?: boolean;
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
  caFile?: string;
  insecureSkipVerify?: boolean;
  insecureTlsConfirmationRequired?: boolean;
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

export interface RuntimeTargetBundleEntry {
  name: string;
  url: string;
  displayName?: string;
  caFile?: string;
  insecureSkipVerify?: boolean;
  observedIdentity?: RuntimeTargetObservedIdentity;
  lastVerifiedAt?: string;
}

export interface RuntimeTargetExportBundle {
  targetBundleVersion: 1;
  targets: RuntimeTargetBundleEntry[];
}

export interface RuntimeTargetImportAddition extends RuntimeTargetBundleEntry {}

export interface RuntimeTargetImportWarning {
  code: 'warning_missing_ca_file' | 'warning_insecure_tls_confirmation_required';
  targetName: string;
  message: string;
}

export interface RuntimeTargetImportValidationFact {
  code:
    | 'invalid_bundle_version'
    | 'invalid_bundle_schema'
    | 'invalid_target_entry'
    | 'invalid_target_name'
    | 'reserved_local_target'
    | 'duplicate_bundle_entry'
    | 'target_name_conflict'
    | 'invalid_url'
    | 'invalid_display_name'
    | 'invalid_tls_metadata'
    | 'invalid_observed_identity'
    | 'invalid_last_verified_at';
  targetName?: string;
  message: string;
}

export interface RuntimeTargetImportResult {
  additions: RuntimeTargetImportAddition[];
  validationFacts: RuntimeTargetImportValidationFact[];
  warnings: RuntimeTargetImportWarning[];
}

export type RuntimeTargetInsecureTlsOperation = 'use' | 'verify' | 'credentialed-attach';

export interface RuntimeTargetDoctorIssue {
  code:
    | 'metadata_parse_failed'
    | 'metadata_schema_invalid'
    | 'secrets_parse_failed'
    | 'secrets_schema_invalid'
    | 'current_context_missing'
    | 'reserved_local_stored_target'
    | 'orphaned_credentials'
    | 'secret_store_insecure_permissions';
  targetName?: string;
  message: string;
}

export interface RuntimeTargetDoctorRepair {
  code: 'fixed_secret_store_permissions' | 'pruned_orphaned_credentials';
  targetName?: string;
  message: string;
}

export interface RuntimeTargetDoctorResult {
  issues: RuntimeTargetDoctorIssue[];
  repairs: RuntimeTargetDoctorRepair[];
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
    public readonly details?: unknown,
    public readonly recoveryCommand?: string,
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

  useTarget(name: string, options: { acceptInsecureTls?: boolean } = {}): RuntimeTargetUseResult {
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
      const nextTarget = this.confirmInsecureTlsIfRequired(target, 'use', options.acceptInsecureTls);
      this.writeMetadata({
        ...metadata,
        current: name,
        targets: {
          ...metadata.targets,
          [name]: nextTarget,
        },
      });
      const entry = this.toListEntry(nextTarget, true);
      return {
        target: entry,
        warnings: verificationWarnings(entry),
      };
    });
  }

  requireInsecureTlsConfirmation(input: {
    name: string;
    operation: RuntimeTargetInsecureTlsOperation;
    acceptInsecureTls?: boolean;
  }): RuntimeTargetListEntry {
    if (input.name === 'local') {
      return this.localEntry(this.current().name === 'local');
    }

    return this.withLock(() => {
      const metadata = this.readMetadata();
      const target = metadata.targets[input.name];
      if (!target) {
        throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${input.name}" was not found`);
      }

      const nextTarget = this.confirmInsecureTlsIfRequired(target, input.operation, input.acceptInsecureTls);
      if (nextTarget !== target) {
        this.writeMetadata({
          ...metadata,
          targets: {
            ...metadata.targets,
            [input.name]: nextTarget,
          },
        });
      }
      return this.toListEntry(nextTarget, metadata.current === input.name);
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

  setOAuthTokenReference(name: string, runtimeScopeId: string, oauth: unknown): void {
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
      const bucket = byScope[runtimeScopeId] ?? {};
      this.writeSecrets({
        ...secrets,
        credentials: {
          ...secrets.credentials,
          [name]: {
            ...byScope,
            [runtimeScopeId]: {
              ...bucket,
              oauth,
            },
          },
        },
      });
    });
  }

  getOAuthTokenReference(name: string, runtimeScopeId: string): unknown | undefined {
    if (!runtimeScopeId) {
      throw new RuntimeTargetStoreError('identity_invalid', 'Runtime scope id is required for credential references');
    }

    const metadata = this.readMetadata();
    if (name !== 'local' && !metadata.targets[name]) {
      throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${name}" was not found`);
    }

    const secrets = this.readSecretsForCredentialUse();
    return secrets.credentials[name]?.[runtimeScopeId]?.oauth;
  }

  clearOAuthTokenReference(name: string, runtimeScopeId: string): void {
    if (!runtimeScopeId) {
      throw new RuntimeTargetStoreError('identity_invalid', 'Runtime scope id is required for credential references');
    }

    this.withLock(() => {
      const metadata = this.readMetadata();
      if (name !== 'local' && !metadata.targets[name]) {
        throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${name}" was not found`);
      }

      const secrets = this.readSecretsForCredentialUse();
      const byScope = secrets.credentials[name];
      const bucket = byScope?.[runtimeScopeId];
      if (!bucket || bucket.oauth === undefined) {
        return;
      }

      const { oauth: _oauth, ...nextBucket } = bucket;
      const nextScopes = { ...byScope };
      if (Object.keys(nextBucket).length === 0) {
        delete nextScopes[runtimeScopeId];
      } else {
        nextScopes[runtimeScopeId] = nextBucket;
      }

      const nextCredentials = { ...secrets.credentials };
      if (Object.keys(nextScopes).length === 0) {
        delete nextCredentials[name];
      } else {
        nextCredentials[name] = nextScopes;
      }

      this.writeSecrets({ ...secrets, credentials: nextCredentials });
    });
  }

  clearLocalOAuthTokenReferences(): number {
    return this.clearLocalCredentialReferences('oauth');
  }

  clearLocalAdminSessionReferences(): number {
    return this.clearLocalCredentialReferences('adminSession');
  }

  setAdminSessionReference(name: string, runtimeScopeId: string, adminSession: unknown): void {
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
      const bucket = byScope[runtimeScopeId] ?? {};
      this.writeSecrets({
        ...secrets,
        credentials: {
          ...secrets.credentials,
          [name]: {
            ...byScope,
            [runtimeScopeId]: {
              ...bucket,
              adminSession,
            },
          },
        },
      });
    });
  }

  getAdminSessionReference(name: string, runtimeScopeId: string): unknown | undefined {
    if (!runtimeScopeId) {
      throw new RuntimeTargetStoreError('identity_invalid', 'Runtime scope id is required for credential references');
    }

    const metadata = this.readMetadata();
    if (name !== 'local' && !metadata.targets[name]) {
      throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${name}" was not found`);
    }

    const secrets = this.readSecretsForCredentialUse();
    return secrets.credentials[name]?.[runtimeScopeId]?.adminSession;
  }

  clearAdminSessionReference(name: string, runtimeScopeId: string): void {
    if (!runtimeScopeId) {
      throw new RuntimeTargetStoreError('identity_invalid', 'Runtime scope id is required for credential references');
    }

    this.withLock(() => {
      const metadata = this.readMetadata();
      if (name !== 'local' && !metadata.targets[name]) {
        throw new RuntimeTargetStoreError('target_not_found', `Runtime target "${name}" was not found`);
      }

      const secrets = this.readSecretsForCredentialUse();
      const byScope = secrets.credentials[name];
      const bucket = byScope?.[runtimeScopeId];
      if (!bucket || bucket.adminSession === undefined) {
        return;
      }

      const { adminSession: _adminSession, ...nextBucket } = bucket;
      const nextScopes = { ...byScope };
      if (Object.keys(nextBucket).length === 0) {
        delete nextScopes[runtimeScopeId];
      } else {
        nextScopes[runtimeScopeId] = nextBucket;
      }

      const nextCredentials = { ...secrets.credentials };
      if (Object.keys(nextScopes).length === 0) {
        delete nextCredentials[name];
      } else {
        nextCredentials[name] = nextScopes;
      }

      this.writeSecrets({ ...secrets, credentials: nextCredentials });
    });
  }

  replaceVerifiedTarget(input: ReplaceVerifiedRuntimeTargetInput): RuntimeTargetListEntry {
    const name = validateRuntimeTargetName(input.name);
    const hasDisplayNameInput = Object.prototype.hasOwnProperty.call(input, 'displayName');
    const nextDisplayName = hasDisplayNameInput ? normalizeDisplayName(input.displayName) : undefined;
    const tlsMetadata = normalizeTlsMetadata({
      caFile: input.caFile,
      insecureSkipVerify: input.insecureSkipVerify,
    });
    const url = normalizeRuntimeTargetUrl(input.url, {
      allowInsecureHttp: tlsMetadata.insecureSkipVerify === true,
    });
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
        caFile: tlsMetadata.caFile,
        insecureSkipVerify: tlsMetadata.insecureSkipVerify,
        insecureTlsConfirmationRequired: undefined,
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
    const tlsMetadata = normalizeTlsMetadata({
      caFile: input.caFile,
      insecureSkipVerify: input.insecureSkipVerify,
    });
    const url = normalizeRuntimeTargetUrl(input.url, {
      allowInsecureHttp: tlsMetadata.insecureSkipVerify === true,
    });

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
      caFile: tlsMetadata.caFile,
      insecureSkipVerify: tlsMetadata.insecureSkipVerify,
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
        caFile: prepared.caFile,
        insecureSkipVerify: prepared.insecureSkipVerify,
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
      caFile: prepared.caFile,
      insecureSkipVerify: prepared.insecureSkipVerify,
      storeLocked: this.isLockedInThisProcess(),
    });
    return this.commitVerifiedAdd(prepared, observedIdentity);
  }

  exportTargetBundle(): RuntimeTargetExportBundle {
    const metadata = this.readMetadata();
    return {
      targetBundleVersion: 1,
      targets: Object.values(metadata.targets)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((target) => targetToBundleEntry(target)),
    };
  }

  previewImportTargetBundle(
    bundle: unknown,
    options: { caFileExists?: (caFile: string) => boolean } = {},
  ): RuntimeTargetImportResult {
    const metadata = this.readMetadata();
    return this.validateImportBundle(bundle, metadata, options);
  }

  importTargetBundle(
    bundle: unknown,
    options: { caFileExists?: (caFile: string) => boolean } = {},
  ): RuntimeTargetImportResult {
    return this.withLock(() => {
      const metadata = this.readMetadata();
      const result = this.validateImportBundle(bundle, metadata, options);
      const now = this.now().toISOString();
      const importedTargets = Object.fromEntries(
        result.additions.map((addition) => [
          addition.name,
          {
            name: addition.name,
            url: addition.url,
            displayName: addition.displayName,
            caFile: addition.caFile,
            insecureSkipVerify: addition.insecureSkipVerify,
            insecureTlsConfirmationRequired: addition.insecureSkipVerify === true ? true : undefined,
            observedIdentity: addition.observedIdentity,
            lastVerifiedAt: addition.lastVerifiedAt,
            createdAt: now,
            updatedAt: now,
          } satisfies StoredRuntimeTarget,
        ]),
      );

      this.writeMetadata({
        ...metadata,
        targets: {
          ...metadata.targets,
          ...importedTargets,
        },
      });
      return result;
    });
  }

  doctor(options: { fixSecrets?: boolean; pruneOrphans?: boolean } = {}): RuntimeTargetDoctorResult {
    return this.withLock(() => {
      const issues: RuntimeTargetDoctorIssue[] = [];
      const repairs: RuntimeTargetDoctorRepair[] = [];
      const metadataInspection = this.inspectMetadataFileForDoctor(issues);
      const secretsInspection = this.inspectSecretsFileForDoctor(issues);

      const hasInsecureSecretPermissions = secretsInspection.fileExists && !isOwnerOnly(this.secretsPath());
      if (hasInsecureSecretPermissions) {
        issues.push({
          code: 'secret_store_insecure_permissions',
          message: 'Runtime target secret store is readable or writable by non-owners',
        });
        if (options.fixSecrets) {
          fs.chmodSync(this.secretsPath(), 0o600);
          repairs.push({
            code: 'fixed_secret_store_permissions',
            message: 'Runtime target secret store permissions were repaired',
          });
        }
      }

      if (metadataInspection.metadata) {
        const currentName = metadataInspection.metadata.current;
        if (currentName && currentName !== 'local' && !metadataInspection.metadata.targets[currentName]) {
          issues.push({
            code: 'current_context_missing',
            targetName: currentName,
            message: `Current runtime target "${currentName}" does not exist`,
          });
        }
        if (metadataInspection.metadata.targets.local) {
          issues.push({
            code: 'reserved_local_stored_target',
            targetName: 'local',
            message: 'The reserved local target is stored as remote metadata',
          });
        }
      }

      if (metadataInspection.metadata && secretsInspection.secrets) {
        const orphanNames = Object.keys(secretsInspection.secrets.credentials).filter(
          (targetName) => targetName !== 'local' && !metadataInspection.metadata?.targets[targetName],
        );
        for (const targetName of orphanNames) {
          issues.push({
            code: 'orphaned_credentials',
            targetName,
            message: `Credential references exist for missing runtime target "${targetName}"`,
          });
        }
        if (options.pruneOrphans && orphanNames.length > 0 && (!hasInsecureSecretPermissions || options.fixSecrets)) {
          const credentials = { ...secretsInspection.secrets.credentials };
          for (const targetName of orphanNames) {
            delete credentials[targetName];
            repairs.push({
              code: 'pruned_orphaned_credentials',
              targetName,
              message: `Removed orphaned credential references for "${targetName}"`,
            });
          }
          this.writeSecrets({ ...secretsInspection.secrets, credentials });
        }
      }

      return { issues, repairs };
    });
  }

  private validateImportBundle(
    bundle: unknown,
    metadata: RuntimeTargetMetadataFile,
    options: { caFileExists?: (caFile: string) => boolean },
  ): RuntimeTargetImportResult {
    const validationFacts: RuntimeTargetImportValidationFact[] = [];
    const warnings: RuntimeTargetImportWarning[] = [];
    const additions: RuntimeTargetImportAddition[] = [];
    const caFileExists = options.caFileExists ?? ((caFile: string) => fs.existsSync(caFile));

    if (!isRecord(bundle)) {
      validationFacts.push({
        code: 'invalid_bundle_schema',
        message: 'Runtime target import bundle must be an object',
      });
      throwImportValidationFailed(validationFacts);
    }

    if (bundle.targetBundleVersion !== 1) {
      validationFacts.push({
        code: 'invalid_bundle_version',
        message: 'Runtime target import bundle version must be 1',
      });
    }
    if (!Array.isArray(bundle.targets)) {
      validationFacts.push({
        code: 'invalid_bundle_schema',
        message: 'Runtime target import bundle targets must be an array',
      });
      throwImportValidationFailed(validationFacts);
    }

    const seenNames = new Set<string>();
    for (const rawEntry of bundle.targets) {
      if (!isRecord(rawEntry)) {
        validationFacts.push({
          code: 'invalid_target_entry',
          message: 'Runtime target import entry must be an object',
        });
        continue;
      }

      const rawName = rawEntry.name;
      const targetName = typeof rawName === 'string' ? rawName : undefined;
      let normalizedName: string | undefined;
      if (!targetName) {
        validationFacts.push({
          code: 'invalid_target_name',
          message: 'Runtime target import entry name must be a string',
        });
      } else if (seenNames.has(targetName)) {
        validationFacts.push({
          code: 'duplicate_bundle_entry',
          targetName,
          message: `Runtime target "${targetName}" is duplicated in the import bundle`,
        });
      } else {
        seenNames.add(targetName);
      }

      if (targetName) {
        try {
          normalizedName = validateRuntimeTargetName(targetName);
        } catch (error) {
          const code =
            error instanceof RuntimeTargetStoreError && error.code === 'target_name_reserved'
              ? 'reserved_local_target'
              : 'invalid_target_name';
          validationFacts.push({
            code,
            targetName,
            message:
              code === 'reserved_local_target'
                ? 'The built-in local target cannot be imported as stored metadata'
                : 'Runtime target import entry name is invalid',
          });
        }
      }

      if (normalizedName && metadata.targets[normalizedName]) {
        validationFacts.push({
          code: 'target_name_conflict',
          targetName: normalizedName,
          message: `Runtime target "${normalizedName}" already exists`,
        });
      }

      let displayName: string | undefined;
      if (Object.prototype.hasOwnProperty.call(rawEntry, 'displayName')) {
        if (typeof rawEntry.displayName !== 'string' && rawEntry.displayName !== undefined) {
          validationFacts.push({
            code: 'invalid_display_name',
            targetName,
            message: 'Runtime target import displayName must be a string',
          });
        } else {
          try {
            displayName = normalizeDisplayName(rawEntry.displayName);
          } catch {
            validationFacts.push({
              code: 'invalid_display_name',
              targetName,
              message: 'Runtime target import displayName is invalid',
            });
          }
        }
      }

      let tlsMetadata: Pick<RuntimeTargetBundleEntry, 'caFile' | 'insecureSkipVerify'> | undefined;
      try {
        tlsMetadata = normalizeTlsMetadata({
          caFile: rawEntry.caFile,
          insecureSkipVerify: rawEntry.insecureSkipVerify,
        });
      } catch {
        validationFacts.push({
          code: 'invalid_tls_metadata',
          targetName,
          message: 'Runtime target import TLS metadata is invalid',
        });
      }

      let normalizedUrl: string | undefined;
      if (typeof rawEntry.url !== 'string') {
        validationFacts.push({
          code: 'invalid_url',
          targetName,
          message: 'Runtime target import entry URL must be a string',
        });
      } else {
        try {
          normalizedUrl = normalizeRuntimeTargetUrl(rawEntry.url, {
            allowInsecureHttp: tlsMetadata?.insecureSkipVerify === true,
          });
        } catch {
          validationFacts.push({
            code: 'invalid_url',
            targetName,
            message: 'Runtime target import entry URL is invalid',
          });
        }
      }

      let observedIdentity: RuntimeTargetObservedIdentity | undefined;
      if (Object.prototype.hasOwnProperty.call(rawEntry, 'observedIdentity')) {
        if (!isRecord(rawEntry.observedIdentity)) {
          validationFacts.push({
            code: 'invalid_observed_identity',
            targetName,
            message: 'Runtime target import observedIdentity must be an object',
          });
        } else {
          observedIdentity = {
            identityProtocolVersion: rawEntry.observedIdentity.identityProtocolVersion,
            runtimeScopeId: rawEntry.observedIdentity.runtimeScopeId,
            externalUrl: rawEntry.observedIdentity.externalUrl,
            runtimeVersion: rawEntry.observedIdentity.runtimeVersion,
            serverTime: rawEntry.observedIdentity.serverTime,
          } as RuntimeTargetObservedIdentity;
          try {
            validateRuntimeIdentity(observedIdentity);
          } catch {
            validationFacts.push({
              code: 'invalid_observed_identity',
              targetName,
              message: 'Runtime target import observedIdentity is invalid',
            });
          }
        }
      }

      let lastVerifiedAt: string | undefined;
      if (Object.prototype.hasOwnProperty.call(rawEntry, 'lastVerifiedAt')) {
        if (typeof rawEntry.lastVerifiedAt !== 'string' || Number.isNaN(Date.parse(rawEntry.lastVerifiedAt))) {
          validationFacts.push({
            code: 'invalid_last_verified_at',
            targetName,
            message: 'Runtime target import lastVerifiedAt must be an ISO-like timestamp string',
          });
        } else {
          lastVerifiedAt = rawEntry.lastVerifiedAt;
        }
      }

      if (normalizedName && normalizedUrl && tlsMetadata) {
        const addition = omitUndefined({
          name: normalizedName,
          url: normalizedUrl,
          displayName,
          caFile: tlsMetadata.caFile,
          insecureSkipVerify: tlsMetadata.insecureSkipVerify,
          observedIdentity,
          lastVerifiedAt,
        });
        additions.push(addition);
        if (addition.caFile && !caFileExists(addition.caFile)) {
          warnings.push({
            code: 'warning_missing_ca_file',
            targetName: addition.name,
            message: `CA bundle path "${addition.caFile}" does not exist on this machine`,
          });
        }
        if (addition.insecureSkipVerify) {
          warnings.push({
            code: 'warning_insecure_tls_confirmation_required',
            targetName: addition.name,
            message: `Runtime target "${addition.name}" will require insecure TLS confirmation before first use`,
          });
        }
      }
    }

    if (validationFacts.length > 0) {
      throwImportValidationFailed(validationFacts);
    }

    return {
      additions: additions.sort((left, right) => left.name.localeCompare(right.name)),
      validationFacts,
      warnings: warnings.sort((left, right) => left.targetName.localeCompare(right.targetName)),
    };
  }

  private confirmInsecureTlsIfRequired(
    target: StoredRuntimeTarget,
    operation: RuntimeTargetInsecureTlsOperation,
    acceptInsecureTls: boolean | undefined,
  ): StoredRuntimeTarget {
    if (!target.insecureTlsConfirmationRequired) {
      return target;
    }
    if (!acceptInsecureTls) {
      throw new RuntimeTargetStoreError(
        'target_insecure_tls_confirmation_required',
        `Runtime target "${target.name}" uses imported insecure TLS metadata and requires confirmation`,
        { operation, targetName: target.name },
        insecureTlsRecoveryCommand(target.name, operation),
      );
    }
    return {
      ...target,
      insecureTlsConfirmationRequired: false,
      updatedAt: this.now().toISOString(),
    };
  }

  private inspectMetadataFileForDoctor(issues: RuntimeTargetDoctorIssue[]): {
    metadata?: RuntimeTargetMetadataFile;
  } {
    const filePath = this.metadataPath();
    if (!fs.existsSync(filePath)) {
      return { metadata: { schemaVersion: STORE_SCHEMA_VERSION, targets: {} } };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      issues.push({
        code: 'metadata_parse_failed',
        message: 'Runtime target metadata file is not valid JSON',
      });
      return {};
    }

    if (!isRecord(parsed) || parsed.schemaVersion !== STORE_SCHEMA_VERSION || !isRecord(parsed.targets)) {
      issues.push({
        code: 'metadata_schema_invalid',
        message: 'Runtime target metadata file does not match schema version 1',
      });
      return {};
    }
    if (parsed.current !== undefined && typeof parsed.current !== 'string') {
      issues.push({
        code: 'metadata_schema_invalid',
        message: 'Runtime target metadata current pointer must be a string',
      });
    }
    for (const [targetName, rawTarget] of Object.entries(parsed.targets)) {
      inspectStoredTargetForDoctor(targetName, rawTarget, issues);
    }

    return {
      metadata: {
        schemaVersion: STORE_SCHEMA_VERSION,
        current: typeof parsed.current === 'string' ? parsed.current : undefined,
        targets: parsed.targets as Record<string, StoredRuntimeTarget>,
      },
    };
  }

  private inspectSecretsFileForDoctor(issues: RuntimeTargetDoctorIssue[]): {
    fileExists: boolean;
    secrets?: RuntimeTargetSecretsFile;
  } {
    const filePath = this.secretsPath();
    if (!fs.existsSync(filePath)) {
      return { fileExists: false, secrets: { schemaVersion: STORE_SCHEMA_VERSION, credentials: {} } };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      issues.push({
        code: 'secrets_parse_failed',
        message: 'Runtime target secrets file is not valid JSON',
      });
      return { fileExists: true };
    }

    if (!isRecord(parsed) || parsed.schemaVersion !== STORE_SCHEMA_VERSION || !isRecord(parsed.credentials)) {
      issues.push({
        code: 'secrets_schema_invalid',
        message: 'Runtime target secrets file does not match schema version 1',
      });
      return { fileExists: true };
    }
    for (const [targetName, rawScopes] of Object.entries(parsed.credentials)) {
      inspectCredentialScopesForDoctor(targetName, rawScopes, issues);
    }

    return {
      fileExists: true,
      secrets: {
        schemaVersion: STORE_SCHEMA_VERSION,
        credentials: parsed.credentials as Record<string, Record<string, RuntimeTargetCredentialBucket>>,
      },
    };
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
      caFile: target.caFile,
      insecureSkipVerify: target.insecureSkipVerify,
      insecureTlsConfirmationRequired: target.insecureTlsConfirmationRequired ?? false,
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

  private clearLocalCredentialReferences(kind: keyof RuntimeTargetCredentialBucket): number {
    return this.withLock(() => {
      const secrets = this.readSecretsForCredentialUse();
      const localScopes = secrets.credentials.local;
      if (!localScopes) {
        return 0;
      }

      let cleared = 0;
      const nextLocalScopes: Record<string, RuntimeTargetCredentialBucket> = {};
      for (const [runtimeScopeId, bucket] of Object.entries(localScopes)) {
        if (bucket[kind] === undefined) {
          nextLocalScopes[runtimeScopeId] = bucket;
          continue;
        }
        cleared += 1;
        const nextBucket: RuntimeTargetCredentialBucket = { ...bucket };
        delete nextBucket[kind];
        if (Object.keys(nextBucket).length > 0) {
          nextLocalScopes[runtimeScopeId] = nextBucket;
        }
      }

      if (cleared === 0) {
        return 0;
      }

      const nextCredentials = { ...secrets.credentials };
      if (Object.keys(nextLocalScopes).length === 0) {
        delete nextCredentials.local;
      } else {
        nextCredentials.local = nextLocalScopes;
      }
      this.writeSecrets({ ...secrets, credentials: nextCredentials });
      return cleared;
    });
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

export function normalizeRuntimeTargetUrl(url: string, options: { allowInsecureHttp?: boolean } = {}): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RuntimeTargetStoreError('target_url_invalid', 'Runtime target URL is invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RuntimeTargetStoreError('target_url_invalid', 'Runtime target URL must use http or https');
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname) && !options.allowInsecureHttp) {
    throw new RuntimeTargetStoreError(
      'target_url_invalid',
      'Runtime target URL must use https unless non-loopback HTTP is explicitly accepted with --insecure-skip-verify',
    );
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return true;
  }
  if (net.isIP(normalized) === 4) {
    return normalized.split('.')[0] === '127';
  }
  return false;
}

function normalizeTlsMetadata(input: { caFile?: unknown; insecureSkipVerify?: unknown }): {
  caFile?: string;
  insecureSkipVerify?: boolean;
} {
  let caFile: string | undefined;
  if (input.caFile !== undefined) {
    if (typeof input.caFile !== 'string') {
      throw new RuntimeTargetStoreError('target_tls_metadata_invalid', 'Runtime target CA file must be a string');
    }
    caFile = input.caFile.trim();
    if (caFile === '' || hasControlCodePoint(caFile)) {
      throw new RuntimeTargetStoreError('target_tls_metadata_invalid', 'Runtime target CA file is invalid');
    }
  }

  let insecureSkipVerify: boolean | undefined;
  if (input.insecureSkipVerify !== undefined) {
    if (typeof input.insecureSkipVerify !== 'boolean') {
      throw new RuntimeTargetStoreError(
        'target_tls_metadata_invalid',
        'Runtime target insecureSkipVerify must be a boolean',
      );
    }
    insecureSkipVerify = input.insecureSkipVerify === true ? true : undefined;
  }

  return omitUndefined({ caFile, insecureSkipVerify });
}

function targetToBundleEntry(target: StoredRuntimeTarget): RuntimeTargetBundleEntry {
  return omitUndefined({
    name: target.name,
    url: target.url,
    displayName: target.displayName,
    caFile: target.caFile,
    insecureSkipVerify: target.insecureSkipVerify,
    observedIdentity: target.observedIdentity,
    lastVerifiedAt: target.lastVerifiedAt,
  });
}

function throwImportValidationFailed(validationFacts: RuntimeTargetImportValidationFact[]): never {
  throw new RuntimeTargetStoreError(
    'target_import_validation_failed',
    'Runtime target import bundle failed validation',
    { validationFacts },
  );
}

function inspectStoredTargetForDoctor(
  targetName: string,
  rawTarget: unknown,
  issues: RuntimeTargetDoctorIssue[],
): void {
  const addIssue = (message: string) => {
    issues.push({ code: 'metadata_schema_invalid', targetName, message });
  };

  if (!isRecord(rawTarget)) {
    addIssue(`Runtime target "${targetName}" metadata must be an object`);
    return;
  }
  if (rawTarget.name !== targetName) {
    addIssue(`Runtime target "${targetName}" metadata name does not match its key`);
  }
  try {
    validateRuntimeTargetName(targetName);
  } catch {
    addIssue(`Runtime target "${targetName}" has an invalid or reserved name`);
  }
  let tlsMetadata: Pick<RuntimeTargetBundleEntry, 'caFile' | 'insecureSkipVerify'> | undefined;
  try {
    tlsMetadata = normalizeTlsMetadata({
      caFile: rawTarget.caFile,
      insecureSkipVerify: rawTarget.insecureSkipVerify,
    });
  } catch {
    addIssue(`Runtime target "${targetName}" TLS metadata is invalid`);
  }
  if (typeof rawTarget.url !== 'string') {
    addIssue(`Runtime target "${targetName}" URL must be a string`);
  } else {
    try {
      normalizeRuntimeTargetUrl(rawTarget.url, {
        allowInsecureHttp: tlsMetadata?.insecureSkipVerify === true,
      });
    } catch {
      addIssue(`Runtime target "${targetName}" URL is invalid`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(rawTarget, 'displayName')) {
    if (typeof rawTarget.displayName !== 'string' && rawTarget.displayName !== undefined) {
      addIssue(`Runtime target "${targetName}" displayName must be a string`);
    } else {
      try {
        normalizeDisplayName(rawTarget.displayName);
      } catch {
        addIssue(`Runtime target "${targetName}" displayName is invalid`);
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(rawTarget, 'insecureTlsConfirmationRequired')) {
    if (typeof rawTarget.insecureTlsConfirmationRequired !== 'boolean') {
      addIssue(`Runtime target "${targetName}" insecure TLS confirmation marker must be a boolean`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(rawTarget, 'observedIdentity')) {
    if (!isRecord(rawTarget.observedIdentity)) {
      addIssue(`Runtime target "${targetName}" observed identity must be an object`);
    } else {
      try {
        validateRuntimeIdentity(rawTarget.observedIdentity as unknown as RuntimeTargetObservedIdentity);
      } catch {
        addIssue(`Runtime target "${targetName}" observed identity is invalid`);
      }
    }
  }
  inspectTimestampForDoctor(targetName, rawTarget, 'lastVerifiedAt', issues);
  inspectTimestampForDoctor(targetName, rawTarget, 'createdAt', issues);
  inspectTimestampForDoctor(targetName, rawTarget, 'updatedAt', issues);
}

function inspectTimestampForDoctor(
  targetName: string,
  target: Record<string, unknown>,
  field: 'lastVerifiedAt' | 'createdAt' | 'updatedAt',
  issues: RuntimeTargetDoctorIssue[],
): void {
  if (!Object.prototype.hasOwnProperty.call(target, field)) {
    if (field === 'createdAt' || field === 'updatedAt') {
      issues.push({
        code: 'metadata_schema_invalid',
        targetName,
        message: `Runtime target "${targetName}" ${field} timestamp is missing`,
      });
    }
    return;
  }
  if (typeof target[field] !== 'string' || Number.isNaN(Date.parse(target[field]))) {
    issues.push({
      code: 'metadata_schema_invalid',
      targetName,
      message: `Runtime target "${targetName}" ${field} timestamp is invalid`,
    });
  }
}

function inspectCredentialScopesForDoctor(
  targetName: string,
  rawScopes: unknown,
  issues: RuntimeTargetDoctorIssue[],
): void {
  if (!isRecord(rawScopes)) {
    issues.push({
      code: 'secrets_schema_invalid',
      targetName,
      message: `Runtime target "${targetName}" credential scopes must be an object`,
    });
    return;
  }
  for (const [runtimeScopeId, rawBucket] of Object.entries(rawScopes)) {
    if (!runtimeScopeId) {
      issues.push({
        code: 'secrets_schema_invalid',
        targetName,
        message: `Runtime target "${targetName}" credential scope id must be non-empty`,
      });
    }
    if (!isRecord(rawBucket)) {
      issues.push({
        code: 'secrets_schema_invalid',
        targetName,
        message: `Runtime target "${targetName}" credential bucket for scope "${runtimeScopeId}" must be an object`,
      });
    }
  }
}

function insecureTlsRecoveryCommand(name: string, operation: RuntimeTargetInsecureTlsOperation): string {
  if (operation === 'use') {
    return `1mcp target use ${name} --accept-insecure-tls`;
  }
  return `1mcp target verify ${name} --accept-insecure-tls`;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
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
    typeof identity.runtimeScopeId !== 'string' ||
    identity.runtimeScopeId.length === 0 ||
    typeof identity.externalUrl !== 'string' ||
    identity.externalUrl.length === 0 ||
    typeof identity.runtimeVersion !== 'string' ||
    identity.runtimeVersion.length === 0 ||
    (identity.serverTime !== undefined && typeof identity.serverTime !== 'string')
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

function hasControlCodePoint(value: string): boolean {
  return Array.from(value).some((char) => {
    const codePoint = char.codePointAt(0);
    return codePoint === undefined || isControlCodePoint(codePoint);
  });
}

function isSurrogateCodePoint(codePoint: number): boolean {
  return codePoint >= 0xd800 && codePoint <= 0xdfff;
}
