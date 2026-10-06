import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ExpirableData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG, getGlobalConfigDir } from '@src/constants.js';
import logger from '@src/logger/logger.js';
import { errorFacts } from '@src/observability/privacy/fields.js';
import {
  assertOwnerOnlyDirPermissions,
  enforceOwnerOnlyFilePermissions,
  openCredentialReadSync,
} from '@src/utils/filePermissions.js';

import { z, type ZodType } from 'zod';

import { FileStorageService, StorageLockBusyError } from './fileStorageService.js';
import {
  DockerNativeCredentialStore,
  type NativeCredentialStore,
  NativeCredentialStoreError,
} from './nativeCredentialStore.js';

export type ProtectedRecordStoreMode = 'file' | 'native';
export interface ProtectedRecordStorageOptions {
  baseDir?: string;
  mode: ProtectedRecordStoreMode;
  nativeStore?: NativeCredentialStore;
  runtimeScope?: string;
  layout: ProtectedRecordLayout;
}
/** Domain-specific inventory and identity; platform storage remains shared. */
export interface ProtectedRecordLayout {
  domain: string;
  subDir: string;
  legacySubDir: string;
  prefixes: readonly string[];
  opaqueFileNames?: boolean;
  synchronousWrites?: boolean;
  manageExpiration?: boolean;
}
// Deterministic namespace fingerprints of non-secret identity metadata; never credential contents.
// codeql[js/insufficient-password-hash]
const namespaceDigest = (value: string) => createHash('sha256').update(value).digest('hex');
const nativeDigest = (encoded: string, nonce: string) =>
  createHmac('sha256', Buffer.from(nonce, 'base64url')).update(encoded).digest('hex');
// Only explicit, confirmed export creates this journal beside an intentionally plaintext
// destination. The checksum detects changed destinations after native chunks are deleted;
// it is not a credential-protection mechanism and is removed after export cleanup.
const exportedPlaintextChecksum = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const OwnerSchema = z.object({ version: z.literal(1), runtimeScope: z.string().regex(/^[a-f0-9]{64}$/) });
const StateSchema = z.object({ mode: z.enum(['file', 'native']), epoch: z.string().uuid() });
const ReferenceSchema = z.object({
  version: z.literal(1),
  scope: z.string().regex(/^[a-f0-9]{64}$/),
  record: z.string().regex(/^[a-f0-9]{64}$/),
  file: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  category: z.string().max(64).optional(),
  location: z.enum(['current', 'legacy']),
  revision: z.string().uuid(),
  chunks: z.number().int().positive().max(100000),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  epoch: z.string().uuid(),
  retired: z.boolean().default(false),
});
type Reference = z.infer<typeof ReferenceSchema>;
const IntentSchema = z
  .object({
    next: ReferenceSchema,
    previous: ReferenceSchema.optional(),
    migrationSource: z.boolean().optional(),
    fileSuperseded: z.boolean().optional(),
  })
  .strict();
type Intent = z.infer<typeof IntentSchema>;
const ExportSchema = z.object({ reference: ReferenceSchema, digest: z.string().regex(/^[a-f0-9]{64}$/) });
const EnvelopeSchema = z.object({
  scope: z.string(),
  record: z.string(),
  revision: z.string(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  file: z.string().optional(),
  payload: z.unknown(),
});

/** Deliberately contains neither helper output nor credential-bearing file contents. */
export class ProtectedRecordStorageError extends Error {
  constructor(
    detail = 'Native credential migration or access is incomplete. Unlock the OS credential store and restart; file storage requires fresh authorization or explicit export.',
  ) {
    super(detail);
    this.name = 'ProtectedRecordStorageError';
  }
}
class StorageEpochError extends ProtectedRecordStorageError {}
class StorageBusyError extends ProtectedRecordStorageError {}

interface Activation {
  promise: Promise<void>;
  storage: ProtectedRecordStorage;
}
const activations = new Map<string, Activation>();
const failedScopes = new Set<string>();
const TransactionSchema = z.object({
  version: z.literal(1),
  writes: z.array(IntentSchema),
  deletes: z.array(ReferenceSchema),
});
const FileTransactionSchema = z.object({
  version: z.literal(1),
  phase: z.enum(['apply', 'cleanup']),
  stages: z.array(z.string().regex(/^[A-Za-z0-9_.-]+\.tmp$/)),
});
const FileStageSchema = z.object({
  file: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  deleted: z.boolean(),
  payload: z.unknown(),
});
interface Transaction {
  active: boolean;
  writes: Map<string, { file: string; payload: unknown }>;
  deletes: Map<string, Reference>;
}
const transactionOwners = new AsyncLocalStorage<{ scope: string; transaction: Transaction }>();

/** Startup calls this once after acquiring Runtime Scope ownership. Failure blocks OAuth, not unrelated servers. */
export async function activateProtectedRecordStore(options: ProtectedRecordStorageOptions): Promise<void> {
  const storage = new ProtectedRecordStorage(options);
  const promise = storage.activate();
  activations.set(storage.getActivationKey(), { storage, promise });
  await promise.catch(() => undefined);
}

export function createProtectedRecordStorage(options: ProtectedRecordStorageOptions): ProtectedRecordStorage {
  return new ProtectedRecordStorage(options);
}

/** Cached readiness only: health requests never query helpers or expose failure payloads. */
export function getProtectedRecordStoreReadiness(options: ProtectedRecordStorageOptions): {
  mode: ProtectedRecordStoreMode;
  ready: boolean;
} {
  const base = options.baseDir ?? getGlobalConfigDir();
  try {
    const runtimeScope = namespaceDigest(canonicalPath(options.runtimeScope ?? base));
    const identity = [
      canonicalPath(path.join(base, AUTH_CONFIG.SERVER.STORAGE.DIR, options.layout.subDir)),
      runtimeScope,
    ];
    if (options.layout.domain !== 'upstream-oauth') identity.push(options.layout.domain);
    const activation = activations.get(namespaceDigest(JSON.stringify(identity)));
    return { mode: options.mode, ready: activation?.storage.mode === options.mode && activation.storage.isReady() };
  } catch {
    return { mode: options.mode, ready: false };
  }
}

/**
 * Domain-neutral protected record storage. Entire records are secrets (including arbitrary registration/discovery fields).
 * References and intents are nonexpiring and outside generic JSON/temporary-file cleanup.
 * Every repository transaction uses one scope lock; reads are synchronous and never mutate storage.
 */
export class ProtectedRecordStorage extends FileStorageService {
  readonly mode: ProtectedRecordStoreMode;
  private nativeStore?: NativeCredentialStore;
  private readonly metadataDir: string;
  private readonly legacyDir: string;
  private readonly scope: string;
  private readonly runtimeScope: string;
  private epoch?: string;
  private initialized = false;
  private activation?: Promise<void>;
  private busy = false;
  private failed = false;
  private readonly layout: ProtectedRecordLayout;
  private constructionFailed = false;
  private expirationTimer?: ReturnType<typeof setInterval>;
  private verifiedCategories = new Map<string, { revision: string; category: string }>();

  constructor(options: ProtectedRecordStorageOptions) {
    super(options.baseDir, options.layout.subDir, { manageLifecycle: false, initializeDirectory: false });
    this.layout = options.layout;
    this.mode = options.mode;
    this.nativeStore = options.nativeStore;
    this.legacyDir = path.join(options.baseDir ?? getGlobalConfigDir(), options.layout.legacySubDir);
    this.metadataDir = path.join(this.getStorageDir(), '.native-oauth');
    let runtimeDirectory: string;
    let storageDirectory: string;
    try {
      runtimeDirectory = canonicalPath(options.runtimeScope ?? options.baseDir ?? getGlobalConfigDir());
      storageDirectory = canonicalPath(this.getStorageDir());
    } catch {
      this.constructionFailed = true;
      runtimeDirectory = path.resolve(options.runtimeScope ?? options.baseDir ?? getGlobalConfigDir());
      storageDirectory = path.resolve(this.getStorageDir());
    }
    this.runtimeScope = namespaceDigest(runtimeDirectory);
    // Preserve the delivered upstream namespace exactly; other domains have an explicit discriminator.
    const identity = [storageDirectory, this.runtimeScope];
    if (this.layout.domain !== 'upstream-oauth') identity.push(this.layout.domain);
    this.scope = namespaceDigest(JSON.stringify(identity));
    const existing = activations.get(this.getActivationKey());
    if (!this.nativeStore && existing) this.nativeStore = existing.storage.nativeStore;
    if (existing) this.verifiedCategories = existing.storage.verifiedCategories;
    if (existing)
      this.activation = existing.promise.then(() => {
        if (existing.storage.mode !== this.mode)
          throw new StorageEpochError('Credential-store selection changed; restart the runtime.');
        if (!existing.storage.isReady()) throw new ProtectedRecordStorageError();
        this.epoch = existing.storage.epoch;
        this.initialized = true;
      });
    if (this.activation) void this.activation.catch(() => undefined);
    if (existing?.storage.initialized && existing.storage.mode === this.mode) {
      this.epoch = existing.storage.epoch;
      this.initialized = true;
      this.activation = existing.promise;
    }
  }

  getActivationKey(): string {
    return this.scope;
  }

  isReady(): boolean {
    return this.initialized && !this.failed && !failedScopes.has(this.scope);
  }

  private get native(): NativeCredentialStore {
    this.nativeStore ??= new DockerNativeCredentialStore();
    return this.nativeStore;
  }

  ready(): Promise<void> {
    if (this.activation)
      return this.activation.then(() => {
        if (!this.isReady()) throw new ProtectedRecordStorageError();
      });
    const existing = activations.get(this.getActivationKey());
    if (existing) {
      this.activation = existing.promise.then(() => {
        if (existing.storage.mode !== this.mode)
          throw new ProtectedRecordStorageError('Credential-store selection changed; restart the runtime.');
        this.epoch = existing.storage.epoch;
        this.initialized = true;
      });
    } else {
      this.activation = this.activate();
      activations.set(this.getActivationKey(), { storage: this, promise: this.activation });
    }
    return this.activation;
  }

  /** File callers historically write synchronously; native readiness remains explicit. */
  initializeFileMode(): void {
    if (this.initialized || this.activation || this.mode !== 'file') return;
    try {
      this.safe(() => this.prepareDirectory());
      super.withExclusiveLockSync(this.layout.domain, () => this.safe(() => this.initialize()));
      this.activation = Promise.resolve();
    } catch (error) {
      this.failed = true;
      failedScopes.add(this.scope);
      this.activation = Promise.reject(error);
      void this.activation.catch(() => undefined);
    }
    activations.set(this.getActivationKey(), { storage: this, promise: this.activation });
  }

  getExportDestinations(): string[] {
    return [this.getStorageDir(), this.legacyDir];
  }

  /** Explicit startup boundary fences previous runtime writers. */
  activate(): Promise<void> {
    this.initialized = false;
    this.activation = Promise.resolve()
      .then(() => {
        this.safe(() => this.prepareDirectory());
        return super.withExclusiveLock(this.layout.domain, () => this.safe(() => this.initialize()));
      })
      .catch((error) => {
        this.failed = true;
        failedScopes.add(this.scope);
        throw error;
      });
    return this.activation;
  }

  private prepareDirectory(): void {
    if (this.constructionFailed) throw new ProtectedRecordStorageError();
    fs.mkdirSync(this.getStorageDir(), { recursive: true, mode: 0o700 });
    assertOwnerOnlyDirPermissions(this.getStorageDir());
    fs.mkdirSync(this.metadataDir, { recursive: true, mode: 0o700 });
    assertOwnerOnlyDirPermissions(this.metadataDir);
  }

  private initialize(): void {
    this.assertOwner(true);
    this.failed = false;
    this.verifiedCategories.clear();
    failedScopes.delete(this.scope);
    const previous = this.state();
    // A committed mutation is always completed before changing its generation or storage mode.
    this.recoverTransaction();
    const next = { mode: this.mode, epoch: randomUUID() };
    for (const reference of this.references()) {
      reference.retired = previous?.mode !== 'native' || this.mode !== 'native' || reference.retired;
      reference.epoch = next.epoch;
      this.writeReference(reference);
    }
    this.atomic(this.meta('state'), next);
    this.epoch = next.epoch;
    if (this.mode === 'native') {
      this.native.read(`https://oauth.1mcp.invalid/${this.scope}/readiness`);
      this.recoverExports();
      this.recoverIntents();
      this.migrateInventory();
      this.backfillReferenceCategories();
    } else {
      this.migrateLegacyFiles();
    }
    this.initialized = true;
    if (this.layout.manageExpiration && this.mode === 'file' && !this.expirationTimer) {
      this.expirationTimer = setInterval(() => this.cleanupExpiredData(), 5 * 60 * 1000);
      this.expirationTimer.unref();
    }
  }

  override shutdown(): void {
    if (this.expirationTimer) clearInterval(this.expirationTimer);
    this.expirationTimer = undefined;
    super.shutdown();
  }

  override async withExclusiveLock<T>(_name: string, operation: () => Promise<T> | T): Promise<T> {
    await this.ready();
    const owner = transactionOwners.getStore();
    if (owner?.scope === this.scope) {
      if (!owner.transaction.active)
        throw new StorageEpochError('OAuth transaction has already finished. Retry the request.');
      return operation();
    }
    return super.withExclusiveLock(this.layout.domain, async () => {
      this.assertEpoch();
      return this.runTransaction(operation);
    });
  }

  private async runTransaction<T>(operation: () => Promise<T> | T): Promise<T> {
    const transaction: Transaction = { active: true, writes: new Map(), deletes: new Map() };
    this.busy = true;
    try {
      return await transactionOwners.run({ scope: this.scope, transaction }, async () => {
        const result = await operation();
        this.safe(() => this.commitTransaction(transaction));
        return result;
      });
    } finally {
      transaction.active = false;
      this.busy = false;
    }
  }

  private mutate<T>(operation: (transaction: Transaction) => T): T {
    const owner = transactionOwners.getStore();
    if (owner?.scope === this.scope) {
      if (!owner.transaction.active)
        throw new StorageEpochError('OAuth transaction has already finished. Retry the request.');
      return operation(owner.transaction);
    }
    if (this.mode === 'native' && !this.layout.synchronousWrites)
      throw new ProtectedRecordStorageError('Native OAuth writes require a repository transaction.');
    if (this.busy)
      throw new StorageBusyError('OAuth storage is busy. Retry the request after the current transaction completes.');
    return super.withExclusiveLockSync(this.layout.domain, () => {
      this.assertEpoch();
      const transaction: Transaction = { active: true, writes: new Map(), deletes: new Map() };
      return transactionOwners.run({ scope: this.scope, transaction }, () => {
        try {
          const result = operation(transaction);
          this.safe(() => this.commitTransaction(transaction));
          return result;
        } finally {
          transaction.active = false;
        }
      });
    });
  }

  private commitTransaction(transaction: Transaction): void {
    if (!transaction.writes.size && !transaction.deletes.size) return;
    if (this.mode === 'file') {
      try {
        this.commitFileTransaction(transaction);
      } catch (error) {
        if (transaction.deletes.size)
          logger.error('fileStorageService.failed.to.delete.data.for.391c9b0b', { error: this.logSafeError(error) });
        this.failed = true;
        failedScopes.add(this.scope);
        throw error;
      }
      return;
    }
    try {
      const writes = [...transaction.writes.values()].map(({ file, payload }) =>
        this.prepareNative('current', file, payload),
      );
      const manifest = { version: 1 as const, writes, deletes: [...transaction.deletes.values()] };
      // Only metadata is published here; every staged protected revision has been read back.
      this.atomic(this.meta('transaction', 'commit'), manifest);
      this.finishTransaction(manifest);
    } catch (error) {
      this.failed = true;
      failedScopes.add(this.scope);
      throw error;
    }
  }

  private commitFileTransaction(transaction: Transaction): void {
    const changes = [
      ...[...transaction.writes.values()].map(({ file, payload }) => ({ file, payload, deleted: false })),
      ...[...transaction.deletes.values()].map(({ file }) => ({ file, payload: null, deleted: true })),
    ];
    const stages = changes.map((change) => {
      const prefix = this.layout.prefixes.find((prefix) => prefix && change.file.startsWith(prefix)) ?? 'oauth-';
      const stage = `${prefix}transaction-${randomUUID()}.tmp`;
      this.atomic(path.join(this.getStorageDir(), stage), change);
      const verified = FileStageSchema.parse(this.readJson(path.join(this.getStorageDir(), stage)));
      if (JSON.stringify(verified) !== JSON.stringify(FileStageSchema.parse(change)))
        throw new ProtectedRecordStorageError();
      return stage;
    });
    const manifest = { version: 1 as const, phase: 'apply' as const, stages };
    this.atomic(this.meta('file-transaction', 'commit'), manifest);
    this.finishFileTransaction(manifest);
  }

  private finishFileTransaction(manifest: z.infer<typeof FileTransactionSchema>): void {
    for (const stage of manifest.stages) {
      if (!this.managedFile(stage)) throw new ProtectedRecordStorageError();
    }
    if (manifest.phase === 'apply') {
      const changes = manifest.stages.map((stage) =>
        FileStageSchema.parse(this.readJson(path.join(this.getStorageDir(), stage))),
      );
      for (const change of changes) {
        if (!this.managedFile(change.file) || !change.file.endsWith('.json')) throw new ProtectedRecordStorageError();
      }
      for (const change of changes) {
        if (change.deleted) this.remove(path.join(this.getStorageDir(), change.file));
        else this.writeFileRecord(change.file, change.payload);
      }
      this.atomic(this.meta('file-transaction', 'commit'), { ...manifest, phase: 'cleanup' });
    }
    for (const stage of manifest.stages) this.remove(path.join(this.getStorageDir(), stage));
    this.remove(this.meta('file-transaction', 'commit'));
  }

  private recoverTransaction(): void {
    const fileManifest = this.readJson(this.meta('file-transaction', 'commit'));
    if (fileManifest !== null) this.finishFileTransaction(FileTransactionSchema.parse(fileManifest));
    const manifest = this.readJson(this.meta('transaction', 'commit'));
    if (manifest !== null) this.finishTransaction(TransactionSchema.parse(manifest));
  }

  private finishTransaction(manifest: z.infer<typeof TransactionSchema>): void {
    // Validate every destination before any publication or cleanup. A committed transaction
    // can only roll forward; read paths stay closed until the commit marker disappears.
    for (const intent of manifest.writes) this.readNative(intent.next);
    for (const reference of manifest.deletes) this.validateReference(reference);
    for (const intent of manifest.writes) this.writeReference(intent.next);
    for (const reference of manifest.deletes) {
      const retired = { ...reference, retired: true };
      this.writeReference(retired);
    }
    for (const intent of manifest.writes) this.finishIntent(intent);
    for (const reference of manifest.deletes) this.finishDeletion(reference);
    this.remove(this.meta('transaction', 'commit'));
  }

  private writeFileRecord(file: string, data: unknown): void {
    this.atomic(path.join(this.getStorageDir(), file), data);
    const record = this.recordKey('current', file);
    this.atomic(this.meta(record, 'fresh'), { epoch: this.epoch });
    const reference = this.reference(record);
    if (reference) {
      reference.retired = true;
      this.writeReference(reference);
    }
    const pending = this.readJson(this.meta(record, 'intent'));
    if (pending) this.atomic(this.meta(record, 'intent'), { ...IntentSchema.parse(pending), fileSuperseded: true });
  }

  override readData<T extends ExpirableData>(prefix: string, id: string, schema?: ZodType<T>): T | null {
    return this.safe(() => {
      this.assertEpoch();
      let file: string;
      try {
        file = path.basename(this.getFilePath(prefix, id));
      } catch {
        return null;
      }
      const record = this.recordKey('current', file);
      const owner = transactionOwners.getStore();
      if (owner?.scope === this.scope) {
        if (!owner.transaction.active)
          throw new StorageEpochError('OAuth transaction has already finished. Retry the request.');
        if (owner.transaction.deletes.has(record)) return null;
        const staged = owner.transaction.writes.get(record);
        if (staged) {
          const data = schema ? schema.parse(staged.payload) : (staged.payload as T);
          return data.expires < Date.now() ? null : data;
        }
      }
      if (this.mode === 'native') {
        if (this.readJson(this.meta(record, 'intent')) !== null) throw new ProtectedRecordStorageError();
        if (this.readJson(this.meta(record, 'delete')) !== null) throw new ProtectedRecordStorageError();
      }
      const reference = this.reference(record);
      let value: unknown;
      if (this.mode === 'native') {
        if (!reference || reference.retired) return null;
        value = this.readNative(reference);
      } else {
        // A migration source left behind is recovery data, never a file-mode fallback.
        const pending = this.readJson(this.meta(record, 'intent'));
        if (pending && !IntentSchema.parse(pending).fileSuperseded) return null;
        if (reference && !this.readJson(this.meta(record, 'fresh'))) return null;
        value = this.readJson(this.getFilePath(prefix, id));
      }
      if (value === null) return null;
      const data = schema ? schema.parse(value) : (value as T);
      if (typeof data.expires !== 'number') throw new ProtectedRecordStorageError();
      if (data.expires < Date.now()) {
        if (this.mode === 'file' && !this.busy) this.deleteData(prefix, id);
        return null;
      }
      return data;
    });
  }

  override writeData<T extends ExpirableData>(prefix: string, id: string, data: T): void {
    this.writeDataDurable(prefix, id, data);
  }

  override writeDataDurable<T extends ExpirableData>(prefix: string, id: string, data: T): void {
    this.safe(() => {
      this.assertEpoch();
      const file = path.basename(this.getFilePath(prefix, id));
      const record = this.recordKey('current', file);
      this.mutate((transaction) => {
        transaction.deletes.delete(record);
        transaction.writes.set(record, { file, payload: structuredClone(data) });
      });
    });
  }

  override deleteData(prefix: string, id: string): boolean {
    return this.safe(() => {
      this.assertEpoch();
      let file: string;
      try {
        file = path.basename(this.getFilePath(prefix, id));
      } catch {
        return false;
      }
      const record = this.recordKey('current', file);
      return this.mutate((transaction) => {
        const staged = transaction.writes.delete(record);
        const reference = this.reference(record);
        if (this.mode === 'native') {
          if (reference) transaction.deletes.set(record, reference);
          return staged || !!reference;
        }
        const exists = fs.existsSync(path.join(this.getStorageDir(), file));
        if (exists) transaction.deletes.set(record, this.fileReference(file));
        return staged || exists;
      });
    });
  }

  private fileReference(file: string): Reference {
    return {
      version: 1,
      scope: this.scope,
      record: this.recordKey('current', file),
      file,
      location: 'current',
      revision: randomUUID(),
      chunks: 1,
      digest: '0'.repeat(64),
      epoch: this.epoch!,
      retired: false,
    };
  }

  override listFiles(prefix?: string): string[] {
    return this.safe(() => {
      this.assertEpoch();
      if (this.mode === 'file') return super.listFiles(prefix);
      return this.references()
        .filter(
          (reference) => !reference.retired && reference.location === 'current' && reference.file.endsWith('.json'),
        )
        .filter((reference) => this.matchesCategory(reference, prefix))
        .map((reference) => this.logicalFile(reference))
        .filter((file) => file.endsWith('.json') && (!prefix || file.startsWith(prefix)));
    });
  }

  override cleanupExpiredData(): number {
    if (!this.layout.manageExpiration || this.mode !== 'file' || this.busy) return 0;
    try {
      return super.withExclusiveLockSync(this.layout.domain, () => {
        this.assertEpoch();
        let cleaned = 0;
        for (const file of fs.readdirSync(this.getStorageDir())) {
          if (!this.managedFile(file)) continue;
          const target = path.join(this.getStorageDir(), file);
          if (file.endsWith('.tmp')) {
            try {
              const stat = fs.lstatSync(target);
              if (stat.isFile() && Date.now() - stat.mtimeMs >= 60_000 && this.remove(target)) cleaned++;
            } catch (error) {
              logger.warn('fileStorageService.failed.to.clean.temporary.file.48c7fb76', {
                error: this.logSafeError(error),
              });
            }
            continue;
          }
          try {
            const value = this.readJson(target) as ExpirableData | null;
            if (value && Number.isFinite(value.expires) && value.expires < Date.now() && this.remove(target)) {
              cleaned++;
              logger.debug('fileStorageService.cleaned.up.expired.file.c453faef');
            }
          } catch (error) {
            // Malformed authoritative records are retained for recovery, never erased by a timer.
            logger.warn('fileStorageService.skipping.unreadable.credential.file.b0d290a8', {
              error: this.logSafeError(error),
            });
          }
        }
        return cleaned;
      });
    } catch (error) {
      if (!(error instanceof StorageLockBusyError))
        logger.warn('fileStorageService.failed.to.cleanup.expired.data.59c8a76e', { error: this.logSafeError(error) });
      return 0;
    }
  }

  private logSafeError(error: unknown): { kind: string; code: string } {
    const facts = errorFacts(error);
    return { kind: facts.error_kind, code: facts.error_code };
  }

  /** Caller owns explicit plaintext confirmation and exclusive stopped-runtime policy. */
  async exportToFile(): Promise<{ records: number }> {
    this.safe(() => this.prepareDirectory());
    return super.withExclusiveLock(this.layout.domain, () =>
      this.safe(() => {
        this.assertOwner(true);
        this.recoverTransaction();
        let records = this.recoverExports();
        this.recoverIntents();
        for (const reference of this.references()) {
          const existing = this.readSource(reference);
          if (existing !== null) {
            // A fresh file login wins; exporting a retired native generation must never overwrite it.
            if (!reference.retired)
              throw new ProtectedRecordStorageError(
                'Export destination already exists. Preserve it and resolve the conflict before retrying export.',
              );
            this.deleteChunks(reference);
            this.remove(this.meta(reference.record, 'ref'));
            continue;
          }
          const value = this.readNative(reference);
          // The user authorized plaintext export; retain destination provenance only until
          // native cleanup succeeds, including retries after partial chunk deletion.
          const digest = exportedPlaintextChecksum(value);
          this.atomic(this.meta(reference.record, 'export'), { reference, digest });
          this.writeSource(reference, value);
          this.finishExport(reference, digest);
          records++;
        }
        return { records };
      }),
    );
  }

  private recoverExports(): number {
    let records = 0;
    for (const file of fs.readdirSync(this.metadataDir).filter((file) => file.endsWith('.export'))) {
      const pending = ExportSchema.parse(this.readJson(path.join(this.metadataDir, file)));
      this.finishExport(pending.reference, pending.digest);
      records++;
    }
    return records;
  }

  private finishExport(reference: Reference, digest: string): void {
    this.validateReference(reference);
    const current = this.readSource(reference);
    if (current === null) this.writeSource(reference, this.readNative(reference));
    if (exportedPlaintextChecksum(this.readSource(reference)) !== digest) {
      throw new ProtectedRecordStorageError(
        'Export destination changed. Native recovery records were retained; resolve the conflict before retrying.',
      );
    }
    this.deleteChunks(reference);
    if (this.reference(reference.record)?.revision === reference.revision)
      this.remove(this.meta(reference.record, 'ref'));
    this.remove(this.meta(reference.record, 'export'));
  }

  private migrateInventory(): void {
    for (const location of ['current', 'legacy'] as const) {
      const directory = location === 'current' ? this.getStorageDir() : this.legacyDir;
      if (!fs.existsSync(directory)) continue;
      assertOwnerOnlyDirPermissions(directory);
      for (const file of fs.readdirSync(directory)) {
        if (!this.managedFile(file)) continue;
        const source = path.join(directory, file);
        // Interrupted atomic writes are recovery fragments, not authoritative JSON records.
        const value = file.endsWith('.tmp') ? this.readText(source) : this.readJson(source);
        if (value === null) throw new ProtectedRecordStorageError();
        if (this.layout.opaqueFileNames && file.endsWith('.json')) {
          if (
            typeof value !== 'object' ||
            !Number.isFinite((value as ExpirableData).expires) ||
            !Number.isFinite((value as ExpirableData).createdAt)
          )
            throw new ProtectedRecordStorageError(
              'OAuth record is malformed. Preserve its source and repair it before restarting.',
            );
        }
        if (this.layout.opaqueFileNames && location === 'legacy' && file.endsWith('.json')) {
          const current = path.join(this.getStorageDir(), file);
          const currentRecord = this.recordKey('current', file);
          const migrated = fs.existsSync(path.join(this.legacyDir, `.migrated-to-${this.layout.subDir}`));
          if (!migrated && !this.reference(currentRecord) && this.readJson(current) === null) {
            this.atomic(current, value);
            this.storeNative('current', file, value, true);
          } else {
            // Duplicate legacy credentials are recovery bytes, never another live authority.
            // Export retains them as .tmp so a later file-layout migration cannot revive a code/session.
            const artifact = `${file}.legacy-recovery.tmp`;
            const recovery = this.reference(this.recordKey('legacy', artifact));
            if (!recovery) this.storeNative('legacy', artifact, JSON.stringify(value));
          }
          this.remove(source);
          continue;
        }
        // Existing references win over retained recovery fragments from an older migration.
        const existing = this.reference(this.recordKey(location, file));
        if (this.layout.opaqueFileNames && existing && !this.readJson(this.meta(existing.record, 'fresh'))) {
          const retained = this.readNative(existing);
          if (JSON.stringify(retained) !== JSON.stringify(value)) throw new ProtectedRecordStorageError();
          this.remove(source);
          continue;
        }
        this.storeNative(location, file, value, true);
      }
    }
  }

  private migrateLegacyFiles(): void {
    if (!fs.existsSync(this.legacyDir)) return;
    assertOwnerOnlyDirPermissions(this.legacyDir);
    const fence = path.join(this.legacyDir, `.migrated-to-${this.layout.subDir}`);
    const completed = this.layout.opaqueFileNames && fs.existsSync(fence);
    for (const file of fs.readdirSync(this.legacyDir)) {
      if (!this.managedFile(file) || !file.endsWith('.json')) continue;
      const source = path.join(this.legacyDir, file);
      const destination = path.join(this.getStorageDir(), file);
      const current = this.readJson(destination);
      if (this.layout.opaqueFileNames && (completed || current !== null)) {
        const artifact = `${source}.legacy-recovery.tmp`;
        const bytes = this.readText(source);
        if (bytes === null) continue;
        if (!fs.existsSync(artifact)) this.atomicBytes(artifact, bytes);
        if (this.readText(artifact) !== bytes) throw new ProtectedRecordStorageError();
        this.remove(source);
        continue;
      }
      // Never replace a newer current-layout credential with legacy rollback data.
      if (current !== null) continue;
      const record = this.recordKey('legacy', file);
      if (this.reference(record) || this.readJson(this.meta(record, 'intent'))) continue;
      const value = this.readJson(source);
      this.atomic(destination, value);
      if (JSON.stringify(this.readJson(destination)) !== JSON.stringify(value)) throw new ProtectedRecordStorageError();
      this.remove(source);
    }
    if (this.layout.opaqueFileNames && !completed)
      this.atomic(fence, { migrated: true, targetSubDir: this.layout.subDir });
  }

  private managedFile(file: string): boolean {
    if (!/^[A-Za-z0-9_.-]+$/.test(file)) return false;
    if (!file.endsWith('.json') && !file.endsWith('.tmp')) return false;
    return this.layout.prefixes.some((prefix) => file.startsWith(prefix));
  }

  private prepareNative(
    location: Reference['location'],
    file: string,
    payload: unknown,
    migrationSource?: boolean,
  ): Intent {
    const record = this.recordKey(location, file);
    if (this.readJson(this.meta(record, 'intent'))) throw new ProtectedRecordStorageError();
    const previous = this.reference(record) ?? undefined;
    const revision = randomUUID();
    // Keep the random nonce only in the OS store: readable reference digests must not
    // provide an offline oracle for guessing low-entropy client-registration secrets.
    const nonce = randomBytes(32).toString('base64url');
    const encoded = Buffer.from(
      JSON.stringify({
        scope: this.scope,
        record,
        revision,
        nonce,
        file: this.layout.opaqueFileNames ? file : undefined,
        payload,
      }),
    ).toString('base64');
    const next: Reference = {
      version: 1,
      scope: this.scope,
      record,
      file: this.layout.opaqueFileNames ? `${record}${file.endsWith('.tmp') ? '.tmp' : '.json'}` : file,
      category: this.fileCategory(file),
      location,
      revision,
      chunks: Math.ceil(encoded.length / 1800),
      digest: nativeDigest(encoded, nonce),
      epoch: this.epoch ?? this.state()?.epoch ?? randomUUID(),
      retired: false,
    };
    const intent: Intent = { next, previous, migrationSource };
    this.atomic(this.meta(record, 'intent'), intent);
    for (let index = 0; index < next.chunks; index++)
      this.native.write(this.chunkKey(next, index), encoded.slice(index * 1800, (index + 1) * 1800));
    this.readNative(next);
    return intent;
  }

  private storeNative(
    location: Reference['location'],
    file: string,
    payload: unknown,
    migrationSource?: boolean,
  ): void {
    const intent = this.prepareNative(location, file, payload, migrationSource);
    this.writeReference(intent.next);
    this.remove(this.meta(intent.next.record, 'fresh'));
    this.finishIntent(intent);
  }

  private finishDeletion(reference: Reference): void {
    this.deleteChunks(reference);
    if (this.reference(reference.record)?.revision === reference.revision)
      this.remove(this.meta(reference.record, 'ref'));
    this.remove(this.meta(reference.record, 'delete'));
  }

  private recoverIntents(): void {
    for (const file of fs.readdirSync(this.metadataDir).filter((file) => file.endsWith('.delete'))) {
      this.finishDeletion(ReferenceSchema.parse(this.readJson(path.join(this.metadataDir, file))));
    }
    for (const file of fs.readdirSync(this.metadataDir).filter((file) => file.endsWith('.intent'))) {
      const intent = IntentSchema.parse(this.readJson(path.join(this.metadataDir, file)));
      this.validateReference(intent.next);
      const current = this.reference(intent.next.record);
      if (current?.revision === intent.next.revision) {
        this.readNative(current);
        this.finishIntent(intent);
        continue;
      }
      // An unpublished native write is disposable. Migration retries from the retained source.
      // A newer published revision is never replaced by an older intent.
      this.deleteChunks(intent.next);
      this.remove(path.join(this.metadataDir, file));
    }
  }

  private finishIntent(intent: Intent): void {
    if (intent.migrationSource && !intent.fileSuperseded) {
      const source = this.sourcePath(intent.next);
      const value = this.readSource(intent.next);
      if (value !== null) {
        if (JSON.stringify(value) !== JSON.stringify(this.readNative(intent.next)))
          throw new ProtectedRecordStorageError(
            'Migration source changed; credentials are retained for recovery. Restart to reconcile before OAuth use.',
          );
        this.remove(source);
      }
    }
    if (intent.previous) this.deleteChunks(intent.previous);
    this.remove(this.meta(intent.next.record, 'intent'));
  }

  private nativeEnvelope(reference: Reference): z.infer<typeof EnvelopeSchema> {
    this.validateReference(reference);
    let encoded = '';
    for (let index = 0; index < reference.chunks; index++) {
      const value = this.native.read(this.chunkKey(reference, index));
      if (!value || value.length > 1800 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
        throw new ProtectedRecordStorageError();
      encoded += value;
    }
    const envelope = EnvelopeSchema.parse(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')));
    if (nativeDigest(encoded, envelope.nonce) !== reference.digest) throw new ProtectedRecordStorageError();
    if (
      envelope.scope !== this.scope ||
      envelope.record !== reference.record ||
      envelope.revision !== reference.revision
    )
      throw new ProtectedRecordStorageError();
    if (this.layout.opaqueFileNames) {
      if (
        !envelope.file ||
        !this.managedFile(envelope.file) ||
        this.recordKey(reference.location, envelope.file) !== reference.record
      )
        throw new ProtectedRecordStorageError();
    }
    const category = this.fileCategory(this.layout.opaqueFileNames ? envelope.file! : reference.file);
    if (reference.category !== undefined && reference.category !== category) throw new ProtectedRecordStorageError();
    return envelope;
  }
  private readNative(reference: Reference): unknown {
    return this.nativeEnvelope(reference).payload;
  }
  private logicalFile(reference: Reference): string {
    return this.layout.opaqueFileNames ? this.nativeEnvelope(reference).file! : reference.file;
  }

  private fileCategory(file: string): string {
    if (!this.managedFile(file)) throw new ProtectedRecordStorageError();
    if (file.endsWith('.tmp')) return 'temporary';
    const prefix = this.layout.prefixes.find((prefix) => file.startsWith(prefix));
    if (prefix === undefined) throw new ProtectedRecordStorageError();
    return prefix;
  }

  private matchesCategory(reference: Reference, prefix?: string): boolean {
    if (!prefix) return true;
    if (!this.layout.opaqueFileNames) return reference.file.startsWith(prefix);
    if (reference.category === undefined) throw new ProtectedRecordStorageError();
    // Public callers may use a partial category or a more specific filename prefix.
    return reference.category.startsWith(prefix) || prefix.startsWith(reference.category);
  }

  private backfillReferenceCategories(): void {
    for (const reference of this.references()) {
      const envelope = this.nativeEnvelope(reference);
      const category = this.fileCategory(this.layout.opaqueFileNames ? envelope.file! : reference.file);
      if (reference.category === undefined) {
        reference.category = category;
        this.writeReference(reference);
      }
    }
  }

  private deleteChunks(reference: Reference): void {
    this.validateReference(reference);
    for (let index = 0; index < reference.chunks; index++) this.native.delete(this.chunkKey(reference, index));
  }
  private chunkKey(reference: Reference, index: number): string {
    return `https://oauth.1mcp.invalid/${this.scope}/${reference.record}/${reference.revision}/${index}`;
  }
  private recordKey(location: Reference['location'], file: string): string {
    return namespaceDigest(`${location}/${file}`);
  }
  private sourcePath(reference: Reference): string {
    if (this.mode === 'file' && !/^[a-f0-9]{64}\.(json|tmp)$/.test(reference.file))
      return path.join(this.getStorageDir(), reference.file);
    this.validateReference(reference);
    return path.join(
      reference.location === 'current' ? this.getStorageDir() : this.legacyDir,
      this.sourceFile(reference),
    );
  }
  private sourceFile(reference: Reference): string {
    if (!this.layout.opaqueFileNames) return reference.file;
    const directory = reference.location === 'current' ? this.getStorageDir() : this.legacyDir;
    if (fs.existsSync(directory)) {
      const candidates = fs
        .readdirSync(directory)
        .filter((file) => this.managedFile(file) && this.recordKey(reference.location, file) === reference.record);
      if (candidates.length === 1) return candidates[0];
    }
    return this.logicalFile(reference);
  }
  private readSource(reference: Reference): unknown | null {
    const source = this.sourcePath(reference);
    return source.endsWith('.tmp') ? this.readText(source) : this.readJson(source);
  }
  private writeSource(reference: Reference, value: unknown): void {
    const source = this.sourcePath(reference);
    if (source.endsWith('.tmp')) {
      if (typeof value !== 'string') throw new ProtectedRecordStorageError();
      this.atomicBytes(source, value);
      return;
    }
    this.atomic(source, value);
  }
  private validateReference(reference: Reference): void {
    ReferenceSchema.parse(reference);
    if (
      reference.category !== undefined &&
      reference.category !== 'temporary' &&
      !this.layout.prefixes.includes(reference.category)
    )
      throw new ProtectedRecordStorageError();
    if (
      reference.scope !== this.scope ||
      reference.record !==
        (this.layout.opaqueFileNames
          ? reference.file.split('.')[0]
          : this.recordKey(reference.location, reference.file)) ||
      !(this.layout.opaqueFileNames
        ? /^[a-f0-9]{64}\.(json|tmp)$/.test(reference.file)
        : this.managedFile(reference.file))
    )
      throw new ProtectedRecordStorageError();
  }
  private reference(record: string): Reference | null {
    const value = this.readJson(this.meta(record, 'ref'));
    if (value === null) return null;
    const reference = ReferenceSchema.parse(value);
    this.validateReference(reference);
    if (reference.record !== record) throw new ProtectedRecordStorageError();
    const verified = this.verifiedCategories.get(record);
    if (verified && (verified.revision !== reference.revision || verified.category !== reference.category))
      throw new ProtectedRecordStorageError();
    return reference;
  }
  private references(): Reference[] {
    return fs
      .readdirSync(this.metadataDir)
      .filter((file) => /^[a-f0-9]{64}\.ref$/.test(file))
      .map((file) => this.reference(file.slice(0, -4))!);
  }
  private writeReference(reference: Reference): void {
    this.atomic(this.meta(reference.record, 'ref'), reference);
    if (reference.retired) this.verifiedCategories.delete(reference.record);
    else if (reference.category !== undefined)
      this.verifiedCategories.set(reference.record, { revision: reference.revision, category: reference.category });
  }
  private meta(key: string, extension = 'meta'): string {
    return path.join(this.metadataDir, `${key}.${extension}`);
  }
  private state(): z.infer<typeof StateSchema> | null {
    const value = this.readJson(this.meta('state'));
    return value === null ? null : StateSchema.parse(value);
  }
  private assertOwner(claim = false): void {
    const marker = this.readJson(this.meta('owner'));
    if (marker === null) {
      if (!claim)
        throw new ProtectedRecordStorageError('OAuth storage ownership is not initialized. Restart the runtime.');
      this.atomic(this.meta('owner'), { version: 1, runtimeScope: this.runtimeScope });
      return;
    }
    if (OwnerSchema.parse(marker).runtimeScope !== this.runtimeScope) {
      throw new ProtectedRecordStorageError(
        'This OAuth storage directory belongs to another Runtime Scope. Shared session-storage paths are not supported; choose a separate path for this Runtime Scope.',
      );
    }
  }

  private assertEpoch(): void {
    this.assertOwner();
    const state = this.state();
    if (
      this.failed ||
      failedScopes.has(this.scope) ||
      this.readJson(this.meta('transaction', 'commit')) !== null ||
      this.readJson(this.meta('file-transaction', 'commit')) !== null
    )
      throw new ProtectedRecordStorageError();
    if (!this.epoch || state?.epoch !== this.epoch || state.mode !== this.mode)
      throw new StorageEpochError('OAuth storage is not ready or its backend changed. Restart the runtime.');
  }
  private readJson(file: string): unknown | null {
    const text = this.readText(file);
    return text === null ? null : JSON.parse(text);
  }
  private readText(file: string): string | null {
    if (!fs.existsSync(path.dirname(file))) return null;
    assertOwnerOnlyDirPermissions(path.dirname(file));
    let descriptor: number;
    try {
      descriptor = openCredentialReadSync(file);
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw error;
    }
    try {
      enforceOwnerOnlyFilePermissions(descriptor, file);
      if (!fs.fstatSync(descriptor).isFile()) throw new ProtectedRecordStorageError();
      const bytes = fs.readFileSync(descriptor);
      const text = bytes.toString('utf8');
      // Never discard byte sequences through replacement decoding during migration.
      if (!Buffer.from(text, 'utf8').equals(bytes))
        throw new ProtectedRecordStorageError(
          'OAuth recovery data is not valid UTF-8. Preserve the source and repair its encoding before restarting.',
        );
      return text;
    } finally {
      fs.closeSync(descriptor);
    }
  }
  private atomic(file: string, value: unknown): void {
    this.atomicBytes(file, JSON.stringify(value));
  }
  private atomicBytes(file: string, text: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    assertOwnerOnlyDirPermissions(path.dirname(file));
    const temporary = `${file}.${randomUUID()}.tmp`;
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, text, { mode: 0o600 });
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, file);
    this.flush(path.dirname(file));
  }
  private remove(file: string): boolean {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return false;
      throw error;
    }
    this.flush(path.dirname(file));
    if (path.dirname(file) === this.metadataDir && /^[a-f0-9]{64}\.ref$/.test(path.basename(file)))
      this.verifiedCategories.delete(path.basename(file).slice(0, -4));
    return true;
  }
  private flush(directory: string): void {
    if (process.platform === 'win32') return;
    const descriptor = fs.openSync(directory, 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }
  private safe<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof StorageLockBusyError)
        throw new StorageBusyError('OAuth storage is busy. Retry the request after the current transaction completes.');
      if (error instanceof StorageEpochError || error instanceof StorageBusyError) throw error;
      if (this.mode === 'native') {
        this.failed = true;
        failedScopes.add(this.scope);
      }
      if (error instanceof ProtectedRecordStorageError || error instanceof NativeCredentialStoreError) throw error;
      throw new ProtectedRecordStorageError();
    }
  }
}

/** Resolve existing symlink ancestors without creating or changing a Runtime Scope directory. */
function canonicalPath(directory: string): string {
  const resolved = path.resolve(directory);
  if (fs.existsSync(resolved)) return fs.realpathSync(resolved);
  return path.join(canonicalPath(path.dirname(resolved)), path.basename(resolved));
}
