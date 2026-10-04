import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ExpirableData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG, getGlobalConfigDir } from '@src/constants.js';
import {
  assertOwnerOnlyDirPermissions,
  enforceOwnerOnlyFilePermissions,
  openCredentialReadSync,
} from '@src/utils/filePermissions.js';

import { z, type ZodType } from 'zod';

import { FileStorageService } from './fileStorageService.js';
import {
  DockerNativeCredentialStore,
  type NativeCredentialStore,
  NativeCredentialStoreError,
} from './nativeCredentialStore.js';

export type UpstreamOAuthStoreMode = 'file' | 'native';
export interface UpstreamOAuthStorageOptions {
  baseDir?: string;
  mode: UpstreamOAuthStoreMode;
  nativeStore?: NativeCredentialStore;
  runtimeScope?: string;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const OwnerSchema = z.object({ version: z.literal(1), runtimeScope: z.string().regex(/^[a-f0-9]{64}$/) });
const StateSchema = z.object({ mode: z.enum(['file', 'native']), epoch: z.string().uuid() });
const ReferenceSchema = z.object({
  version: z.literal(1),
  scope: z.string().regex(/^[a-f0-9]{64}$/),
  record: z.string().regex(/^[a-f0-9]{64}$/),
  file: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  location: z.enum(['current', 'legacy']),
  revision: z.string().uuid(),
  chunks: z.number().int().positive().max(100000),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  epoch: z.string().uuid(),
  retired: z.boolean().default(false),
});
type Reference = z.infer<typeof ReferenceSchema>;
const IntentSchema = z.object({
  next: ReferenceSchema,
  previous: ReferenceSchema.optional(),
  sourceDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  fileSuperseded: z.boolean().optional(),
});
type Intent = z.infer<typeof IntentSchema>;
const ExportSchema = z.object({ reference: ReferenceSchema, digest: z.string().regex(/^[a-f0-9]{64}$/) });
const EnvelopeSchema = z.object({
  scope: z.string(),
  record: z.string(),
  revision: z.string(),
  payload: z.unknown(),
});

/** Deliberately contains neither helper output nor credential-bearing file contents. */
export class UpstreamOAuthStorageError extends Error {
  constructor(
    detail = 'Native credential migration or access is incomplete. Unlock the OS credential store and restart; file storage requires fresh authorization or explicit export.',
  ) {
    super(detail);
    this.name = 'UpstreamOAuthStorageError';
  }
}
interface Activation {
  promise: Promise<void>;
  storage: UpstreamOAuthStorage;
}
const activations = new Map<string, Activation>();

/** Startup calls this once after acquiring Runtime Scope ownership. Failure blocks OAuth, not unrelated servers. */
export async function activateUpstreamOAuthStore(options: UpstreamOAuthStorageOptions): Promise<void> {
  const storage = new UpstreamOAuthStorage(options);
  const promise = storage.activate();
  activations.set(storage.getActivationKey(), { storage, promise });
  await promise.catch(() => undefined);
}

export function createUpstreamOAuthStorage(options: UpstreamOAuthStorageOptions): UpstreamOAuthStorage {
  return new UpstreamOAuthStorage(options);
}

/**
 * Upstream-only storage. Entire records are secrets (including arbitrary registration/discovery fields).
 * References and intents are nonexpiring and outside generic JSON/temporary-file cleanup.
 * Every repository transaction uses one scope lock; reads are synchronous and never mutate storage.
 */
export class UpstreamOAuthStorage extends FileStorageService {
  private readonly mode: UpstreamOAuthStoreMode;
  private nativeStore?: NativeCredentialStore;
  private readonly metadataDir: string;
  private readonly legacyDir: string;
  private readonly scope: string;
  private readonly runtimeScope: string;
  private epoch?: string;
  private initialized = false;
  private activation?: Promise<void>;
  private locked = false;

  constructor(options: UpstreamOAuthStorageOptions) {
    super(options.baseDir, AUTH_CONFIG.CLIENT.SESSION.SUBDIR, { manageLifecycle: false });
    this.mode = options.mode;
    this.nativeStore = options.nativeStore;
    this.legacyDir = path.join(options.baseDir ?? getGlobalConfigDir(), 'clientSessions');
    this.metadataDir = path.join(this.getStorageDir(), '.native-oauth');
    fs.mkdirSync(this.metadataDir, { recursive: true, mode: 0o700 });
    assertOwnerOnlyDirPermissions(this.metadataDir);
    this.runtimeScope = hash(canonicalPath(options.runtimeScope ?? options.baseDir ?? getGlobalConfigDir()));
    this.scope = hash(JSON.stringify([fs.realpathSync(this.getStorageDir()), this.runtimeScope]));
    const existing = activations.get(this.getActivationKey());
    if (!this.nativeStore && existing) this.nativeStore = existing.storage.nativeStore;
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
    return this.initialized;
  }

  private get native(): NativeCredentialStore {
    this.nativeStore ??= new DockerNativeCredentialStore();
    return this.nativeStore;
  }

  ready(): Promise<void> {
    if (this.activation) return this.activation;
    const existing = activations.get(this.getActivationKey());
    if (existing) {
      this.activation = existing.promise.then(() => {
        if (existing.storage.mode !== this.mode)
          throw new UpstreamOAuthStorageError('Credential-store selection changed; restart the runtime.');
        this.epoch = existing.storage.epoch;
        this.initialized = true;
      });
    } else {
      this.activation = this.activate();
      activations.set(this.getActivationKey(), { storage: this, promise: this.activation });
    }
    return this.activation;
  }

  /** Explicit startup boundary; unlike provider construction this fences previous runtime writers. */
  activate(): Promise<void> {
    this.initialized = false;
    this.activation = super.withExclusiveLock('upstream-oauth', () =>
      this.safe(() => {
        this.assertOwner(true);
        const previous = this.state();
        const next = { mode: this.mode, epoch: randomUUID() };
        // Retire native references before file credentials can be created. They remain exportable.
        for (const reference of this.references()) {
          reference.retired = previous?.mode !== 'native' || this.mode !== 'native' || reference.retired;
          reference.epoch = next.epoch;
          this.writeReference(reference);
        }
        this.atomic(this.meta('state'), next);
        this.epoch = next.epoch;
        if (this.mode === 'native') {
          this.recoverExports();
          this.recoverIntents();
          this.migrateInventory();
        } else {
          this.migrateLegacyFiles();
        }
        this.initialized = true;
      }),
    );
    return this.activation;
  }

  override async withExclusiveLock<T>(_name: string, operation: () => Promise<T> | T): Promise<T> {
    await this.ready();
    return super.withExclusiveLock('upstream-oauth', async () => {
      this.assertEpoch();
      this.locked = true;
      try {
        return await operation();
      } finally {
        this.locked = false;
      }
    });
  }

  override readData<T extends ExpirableData>(prefix: string, id: string, schema?: ZodType<T>): T | null {
    return this.safe(() => {
      this.assertEpoch();
      const file = path.basename(this.getFilePath(prefix, id));
      const record = this.recordKey('current', file);
      if (this.mode === 'native') {
        if (this.readJson(this.meta(record, 'intent')) !== null) throw new UpstreamOAuthStorageError();
        if (this.readJson(this.meta(record, 'delete')) !== null) throw new UpstreamOAuthStorageError();
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
        value = this.readJson(this.getFilePath(prefix, id));
      }
      if (value === null) return null;
      const data = schema ? schema.parse(value) : (value as T);
      if (typeof data.expires !== 'number') throw new UpstreamOAuthStorageError();
      return data.expires < Date.now() ? null : data;
    });
  }

  override writeData<T extends ExpirableData>(prefix: string, id: string, data: T): void {
    this.writeDataDurable(prefix, id, data);
  }

  override writeDataDurable<T extends ExpirableData>(prefix: string, id: string, data: T): void {
    this.safe(() => {
      this.assertEpoch();
      const destination = this.getFilePath(prefix, id);
      if (this.mode === 'file') {
        this.atomic(destination, data);
        // Fresh authorization supersedes a leftover migration source without consuming it.
        const record = this.recordKey('current', path.basename(destination));
        const reference = this.reference(record);
        if (reference) {
          reference.retired = true;
          this.writeReference(reference);
        }
        const pending = this.readJson(this.meta(record, 'intent'));
        if (pending) this.atomic(this.meta(record, 'intent'), { ...IntentSchema.parse(pending), fileSuperseded: true });
        return;
      }
      if (!this.locked) throw new UpstreamOAuthStorageError('Native OAuth writes require a repository transaction.');
      this.storeNative('current', path.basename(destination), data);
    });
  }

  override deleteData(prefix: string, id: string): boolean {
    return this.safe(() => {
      this.assertEpoch();
      const destination = this.getFilePath(prefix, id);
      if (this.mode === 'file') return this.remove(destination);
      if (!this.locked) throw new UpstreamOAuthStorageError('Native OAuth deletion requires a repository transaction.');
      const reference = this.reference(this.recordKey('current', path.basename(destination)));
      if (!reference) return false;
      // Retire durably first: interrupted erasure never makes credentials eligible again.
      this.atomic(this.meta(reference.record, 'delete'), reference);
      reference.retired = true;
      this.writeReference(reference);
      this.finishDeletion(reference);
      return true;
    });
  }

  override listFiles(prefix?: string): string[] {
    return this.safe(() => {
      this.assertEpoch();
      if (this.mode === 'file') return super.listFiles(prefix);
      return this.references()
        .filter((reference) => !reference.retired && reference.location === 'current')
        .map((reference) => reference.file)
        .filter((file) => file.endsWith('.json') && (!prefix || file.startsWith(prefix)));
    });
  }

  override cleanupExpiredData(): number {
    return 0;
  }

  /** Caller owns explicit plaintext confirmation and exclusive stopped-runtime policy. */
  async exportToFile(): Promise<{ records: number }> {
    return super.withExclusiveLock('upstream-oauth', () =>
      this.safe(() => {
        this.assertOwner(true);
        let records = this.recoverExports();
        this.recoverIntents();
        for (const reference of this.references()) {
          const destination = this.sourcePath(reference);
          const existing = this.readJson(destination);
          if (existing !== null) {
            // A fresh file login wins; exporting a retired native generation must never overwrite it.
            if (!reference.retired)
              throw new UpstreamOAuthStorageError(
                'Export destination already exists. Preserve it and resolve the conflict before retrying export.',
              );
            this.deleteChunks(reference);
            this.remove(this.meta(reference.record, 'ref'));
            continue;
          }
          const value = this.readNative(reference);
          const digest = hash(JSON.stringify(value));
          this.atomic(this.meta(reference.record, 'export'), { reference, digest });
          this.atomic(destination, value);
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
    const destination = this.sourcePath(reference);
    const current = this.readJson(destination);
    if (current === null) this.atomic(destination, this.readNative(reference));
    if (hash(JSON.stringify(this.readJson(destination))) !== digest) {
      throw new UpstreamOAuthStorageError(
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
        const value = this.readJson(source);
        if (value === null) continue;
        this.storeNative(location, file, value, hash(JSON.stringify(value)));
      }
    }
  }

  private migrateLegacyFiles(): void {
    if (!fs.existsSync(this.legacyDir)) return;
    assertOwnerOnlyDirPermissions(this.legacyDir);
    for (const file of fs.readdirSync(this.legacyDir)) {
      if (!this.managedFile(file) || !file.endsWith('.json')) continue;
      const source = path.join(this.legacyDir, file);
      const destination = path.join(this.getStorageDir(), file);
      // Never replace a newer current-layout credential with legacy rollback data.
      if (this.readJson(destination) !== null) continue;
      const record = this.recordKey('legacy', file);
      if (this.reference(record) || this.readJson(this.meta(record, 'intent'))) continue;
      const value = this.readJson(source);
      this.atomic(destination, value);
      if (JSON.stringify(this.readJson(destination)) !== JSON.stringify(value)) throw new UpstreamOAuthStorageError();
      this.remove(source);
    }
  }

  private managedFile(file: string): boolean {
    if (!/^[A-Za-z0-9_.-]+$/.test(file)) return false;
    if (!file.endsWith('.json') && !file.endsWith('.tmp')) return false;
    return ['oauth-bound-', 'oauth-context-', 'oauth-quarantine-', AUTH_CONFIG.CLIENT.SESSION.FILE_PREFIX].some(
      (prefix) => file.startsWith(prefix),
    );
  }

  private storeNative(location: Reference['location'], file: string, payload: unknown, sourceDigest?: string): void {
    const record = this.recordKey(location, file);
    if (this.readJson(this.meta(record, 'intent'))) throw new UpstreamOAuthStorageError();
    const previous = this.reference(record) ?? undefined;
    const revision = randomUUID();
    const encoded = Buffer.from(JSON.stringify({ scope: this.scope, record, revision, payload })).toString('base64');
    const next: Reference = {
      version: 1,
      scope: this.scope,
      record,
      file,
      location,
      revision,
      chunks: Math.ceil(encoded.length / 1800),
      digest: hash(encoded),
      epoch: this.epoch ?? this.state()?.epoch ?? randomUUID(),
      retired: false,
    };
    const intent: Intent = { next, previous, sourceDigest };
    this.atomic(this.meta(record, 'intent'), intent);
    for (let index = 0; index < next.chunks; index++)
      this.native.write(this.chunkKey(next, index), encoded.slice(index * 1800, (index + 1) * 1800));
    this.readNative(next);
    this.writeReference(next);
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
    if (intent.sourceDigest && !intent.fileSuperseded) {
      const source = this.sourcePath(intent.next);
      const value = this.readJson(source);
      if (value !== null) {
        if (hash(JSON.stringify(value)) !== intent.sourceDigest)
          throw new UpstreamOAuthStorageError(
            'Migration source changed; credentials are retained for recovery. Restart to reconcile before OAuth use.',
          );
        this.remove(source);
      }
    }
    if (intent.previous) this.deleteChunks(intent.previous);
    this.remove(this.meta(intent.next.record, 'intent'));
  }

  private readNative(reference: Reference): unknown {
    this.validateReference(reference);
    let encoded = '';
    for (let index = 0; index < reference.chunks; index++) {
      const value = this.native.read(this.chunkKey(reference, index));
      if (!value || value.length > 1800 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new UpstreamOAuthStorageError();
      encoded += value;
    }
    if (hash(encoded) !== reference.digest) throw new UpstreamOAuthStorageError();
    const envelope = EnvelopeSchema.parse(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')));
    if (
      envelope.scope !== this.scope ||
      envelope.record !== reference.record ||
      envelope.revision !== reference.revision
    )
      throw new UpstreamOAuthStorageError();
    return envelope.payload;
  }

  private deleteChunks(reference: Reference): void {
    this.validateReference(reference);
    for (let index = 0; index < reference.chunks; index++) this.native.delete(this.chunkKey(reference, index));
  }
  private chunkKey(reference: Reference, index: number): string {
    return `https://oauth.1mcp.invalid/${this.scope}/${reference.record}/${reference.revision}/${index}`;
  }
  private recordKey(location: Reference['location'], file: string): string {
    return hash(`${location}/${file}`);
  }
  private sourcePath(reference: Reference): string {
    this.validateReference(reference);
    return path.join(reference.location === 'current' ? this.getStorageDir() : this.legacyDir, reference.file);
  }
  private validateReference(reference: Reference): void {
    ReferenceSchema.parse(reference);
    if (
      reference.scope !== this.scope ||
      reference.record !== this.recordKey(reference.location, reference.file) ||
      !this.managedFile(reference.file)
    )
      throw new UpstreamOAuthStorageError();
  }
  private reference(record: string): Reference | null {
    const value = this.readJson(this.meta(record, 'ref'));
    if (value === null) return null;
    const reference = ReferenceSchema.parse(value);
    this.validateReference(reference);
    if (reference.record !== record) throw new UpstreamOAuthStorageError();
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
        throw new UpstreamOAuthStorageError('OAuth storage ownership is not initialized. Restart the runtime.');
      this.atomic(this.meta('owner'), { version: 1, runtimeScope: this.runtimeScope });
      return;
    }
    if (OwnerSchema.parse(marker).runtimeScope !== this.runtimeScope) {
      throw new UpstreamOAuthStorageError(
        'This OAuth storage directory belongs to another Runtime Scope. Shared session-storage paths are not supported; choose a separate path for this Runtime Scope.',
      );
    }
  }

  private assertEpoch(): void {
    this.assertOwner();
    const state = this.state();
    if (!this.epoch || state?.epoch !== this.epoch || state.mode !== this.mode)
      throw new UpstreamOAuthStorageError('OAuth storage is not ready or its backend changed. Restart the runtime.');
  }
  private readJson(file: string): unknown | null {
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
      if (!fs.fstatSync(descriptor).isFile()) throw new UpstreamOAuthStorageError();
      return JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    } finally {
      fs.closeSync(descriptor);
    }
  }
  private atomic(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    assertOwnerOnlyDirPermissions(path.dirname(file));
    const temporary = `${file}.${randomUUID()}.tmp`;
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, JSON.stringify(value), { mode: 0o600 });
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
      if (error instanceof UpstreamOAuthStorageError || error instanceof NativeCredentialStoreError) throw error;
      throw new UpstreamOAuthStorageError();
    }
  }
}

/** Resolve existing symlink ancestors without creating or changing a Runtime Scope directory. */
function canonicalPath(directory: string): string {
  const resolved = path.resolve(directory);
  if (fs.existsSync(resolved)) return fs.realpathSync(resolved);
  return path.join(canonicalPath(path.dirname(resolved)), path.basename(resolved));
}
