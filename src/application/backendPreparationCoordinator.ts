import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ConfigManager } from '@src/config/configManager.js';
import { normalizeTags, resolveProjectContext } from '@src/config/projectConfigLoader.js';
import type { ProjectConfig } from '@src/config/projectConfigTypes.js';
import { invalidatePreparedToolProvider } from '@src/core/capabilities/capabilityPagination.js';
import { readConfiguredToolSnapshot } from '@src/core/capabilities/configuredToolSnapshot.js';
import { validateProjectPreparationAuthority } from '@src/core/context/projectPreparationAuthority.js';
import { resolveFilterSelection } from '@src/core/filtering/filterSelection.js';
import { TemplateFilteringService } from '@src/core/filtering/templateFilteringService.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { createConnectionResolver } from '@src/core/server/connectionResolver.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import type { InboundConnectionConfig } from '@src/core/types/server.js';
import { type MCPServerParams, transportConfigSchema } from '@src/core/types/transport.js';
import { PreparationAdapterRegistry } from '@src/domains/backend-preparation/adapterRegistry.js';
import { CodeGraphPreparationAdapter } from '@src/domains/backend-preparation/codegraphAdapter.js';
import { disposeCodeGraphPreparationToolMetadata } from '@src/domains/backend-preparation/codegraphReadOnly.js';
import type {
  BackendPolicy,
  BackendPreparationAdapter,
  BackendReadiness,
  PreparationAdmission,
  PreparationResult,
  PreparationStatus,
  PreparationTarget,
} from '@src/domains/backend-preparation/contracts.js';
import {
  BackendPolicySchema,
  preparationKey,
  PreparationOptionsSchema,
  PreparationTargetSchema,
} from '@src/domains/backend-preparation/policy.js';
import { BackendPreparationService } from '@src/domains/backend-preparation/service.js';
import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import { hasExplicitProjectFilterSelection } from '@src/domains/project-selection/projectPolicy.js';
import { requireProjectTarget } from '@src/domains/project-selection/projectSelection.js';
import {
  assertOwnerOnlyDirPermissions,
  enforceOwnerOnlyFilePermissions,
  openCredentialReadSync,
} from '@src/utils/filePermissions.js';

import { z } from 'zod';

type RuntimePreparationConfig = NonNullable<MCPServerParams['preparation']>;
type OwnedAdapter = BackendPreparationAdapter & { dispose?: () => void | Promise<void> };
export type PreparationControl = 'inspect' | 'prepare' | 'status' | 'wait' | 'cancel' | 'retry';
export interface PreparationGrant {
  readonly owner: string;
  readonly target: PreparationTarget;
  readonly policy: BackendPolicy;
  readonly preferences: NonNullable<ProjectConfig['preparation']>;
}
export interface PreparationControlRequest {
  readonly action: PreparationControl;
  readonly id?: string;
  readonly operation?: string;
  readonly waitMs?: number;
  readonly signal?: AbortSignal;
  readonly validateAdmission?: () => Promise<boolean>;
  readonly assertAdmission?: () => void;
}
export class PreparationAuthorizationChangedError extends Error {
  constructor() {
    super('Preparation authorization changed');
  }
}
export type PublicPreparationStatus = Omit<PreparationStatus, 'target'> & {
  readonly target: { readonly checkoutRoot: string; readonly backendName: string };
};
export type PublicPreparationResult =
  Exclude<PreparationResult, { state: 'job' }> | { readonly state: 'job'; readonly status: PublicPreparationStatus };
export type PublicPreparationAdmission =
  | PublicPreparationResult
  | {
      readonly state: 'pending';
      readonly status: PublicPreparationStatus;
      readonly operationExecuted: false;
      readonly operationQueued: false;
      readonly instructions: string;
    };
export type PreparationControlResult =
  BackendReadiness | PublicPreparationAdmission | PublicPreparationStatus | undefined;

const failureSchema = z
  .object({
    code: z.string().max(256),
    message: z.string().max(4096),
    retryable: z.boolean(),
    instructions: z.string().max(8192),
  })
  .strict();
const savedSchema = z
  .object({
    key: z.string().length(64),
    target: PreparationTargetSchema.extend({
      checkoutRoot: z.string().min(1).max(8192),
      backendName: z.string().min(1).max(256),
      backendIdentity: z.string().min(1).max(128),
      configurationKey: z.string().min(1).max(128),
    }),
    operation: z.string().min(1).max(256),
    policy: BackendPolicySchema,
    action: z.enum(['initialize', 'sync', 'rebuild', 'install', 'paid']),
    state: z.enum(['queued', 'running', 'cancelling', 'ready', 'failed', 'cancelled']),
    previousJobId: z.string().min(1).max(256),
    failure: failureSchema.optional(),
  })
  .strict();
type SavedPreparation = z.infer<typeof savedSchema>;

/** Only advisory operation data is persisted. No PID or saved flag can authorize process control. */
class PreparationSnapshotStore {
  private readonly records = new Map<string, SavedPreparation>();
  private readonly reservations = new Map<string, number>();
  private static readonly maximumBytes = 128 * 1024 * 1024;
  constructor(
    private readonly file: string | undefined,
    private readonly capacity: number,
  ) {
    if (!file) return;
    if (!fs.existsSync(file)) return;
    assertOwnerOnlyDirPermissions(path.dirname(file));
    const fd = openCredentialReadSync(file);
    try {
      enforceOwnerOnlyFilePermissions(fd, file);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > PreparationSnapshotStore.maximumBytes)
        throw new Error('Invalid preparation recovery storage');
      const records = z
        .array(savedSchema)
        .max(capacity)
        .parse(JSON.parse(fs.readFileSync(fd, 'utf8')));
      for (const record of records) this.records.set(record.key, record);
    } finally {
      fs.closeSync(fd);
    }
  }
  get(key: string): SavedPreparation | undefined {
    return this.records.get(key);
  }
  assertCapacity(key: string): void {
    if (!this.file || this.records.has(key) || this.reservations.has(key)) return;
    const size = new Set([...this.records.keys(), ...this.reservations.keys()]).size;
    // Reserve a bounded worst-case advisory record before admitting work, including UTF-8 text.
    if (size >= this.capacity || (size + 1) * 96 * 1024 > PreparationSnapshotStore.maximumBytes)
      throw new Error('Preparation recovery storage is full');
  }
  reserve(key: string): () => void {
    this.assertCapacity(key);
    this.reservations.set(key, (this.reservations.get(key) ?? 0) + 1);
    return () => {
      const remaining = (this.reservations.get(key) ?? 1) - 1;
      if (remaining === 0) this.reservations.delete(key);
      else this.reservations.set(key, remaining);
    };
  }
  save(key: string, status: PreparationStatus, policy: BackendPolicy): void {
    if (!this.file) return;
    if (status.state === 'ready' || status.state === 'cancelled') {
      this.delete(key);
      return;
    }
    this.assertCapacity(key);
    this.records.set(
      key,
      savedSchema.parse({
        key,
        target: status.target,
        operation: status.operation,
        policy: { ...policy, executionDeadlineMs: status.executionDeadlineMs },
        action: status.action,
        state: status.state,
        previousJobId: status.id,
        failure: status.failure,
      }),
    );
    this.flush();
  }
  delete(key: string): void {
    if (this.records.delete(key)) this.flush();
  }
  private flush(): void {
    if (!this.file) return;
    const directory = path.dirname(this.file);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    assertOwnerOnlyDirPermissions(directory);
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify([...this.records.values()]), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** One coordinator and scheduler per Aggregated Runtime, independent of advertised tools. */
export class BackendPreparationCoordinator {
  private readonly grantInputs = new WeakMap<
    PreparationGrant,
    { backendName: string; checkoutPath: string; owner: string; filterConfig: InboundConnectionConfig }
  >();
  readonly service: BackendPreparationService;
  private readonly registry = new PreparationAdapterRegistry();
  private readonly adapters = new Map<string, OwnedAdapter>();
  private readonly registered = new Set<string>();
  private readonly handles = new Map<string, { owner: string; key: string; serviceId: string }>();
  private readonly monitored = new Set<string>();
  private readonly refreshedJobs = new Set<string>();
  private readonly readinessRefreshes = new Map<string, Promise<void>>();
  private readonly latestAdapters = new Map<string, string>();
  private readonly adapterCalls = new Map<string, number>();
  private readonly failureAdapters = new WeakMap<object, OwnedAdapter>();
  private readonly disposing = new Set<Promise<void>>();
  private readonly disposalFailures: unknown[] = [];
  private readonly store: PreparationSnapshotStore;
  private closed = false;
  private shutdownPromise?: Promise<void>;

  constructor(
    private readonly ports: {
      options?: Partial<z.infer<typeof PreparationOptionsSchema>>;
      storagePath?: string;
      adapterFactory?: (config: RuntimePreparationConfig) => OwnedAdapter;
      onReady?: (target: PreparationTarget) => Promise<void>;
    } = {},
  ) {
    this.service = new BackendPreparationService(this.registry, ports.options);
    this.store = new PreparationSnapshotStore(
      ports.storagePath ? path.join(ports.storagePath, 'backend-preparation.json') : undefined,
      this.service.options.maxRecords,
    );
  }

  /** Caller must authorize the target context before this function performs any filesystem access. */
  async resolveGrant(input: {
    backendName: string;
    checkoutPath: string;
    owner: string;
    filterConfig: InboundConnectionConfig;
  }): Promise<PreparationGrant> {
    if (this.closed) throw new Error('Preparation coordinator is stopped');
    // Live inbound connections also carry SDK adapters and notification callbacks.
    // Capture only the selector data used by preparation, before any asynchronous reads.
    const filter = input.filterConfig;
    input = {
      backendName: input.backendName,
      checkoutPath: input.checkoutPath,
      owner: input.owner,
      filterConfig: structuredClone({
        tags: filter.tags,
        tagExpression: filter.tagExpression,
        tagQuery: filter.tagQuery,
        tagFilterMode: filter.tagFilterMode,
        presetName: filter.presetName,
        projectFilterMode: filter.projectFilterMode,
      }),
    };
    const declared = ConfigManager.getInstance().loadDeclaredServerConfigs();
    if (declared.errors.length) throw new Error('Runtime backend configuration is unavailable');
    const definition = declared.templateServers[input.backendName] ?? declared.staticServers[input.backendName];
    if (!definition || definition.disabled) throw new Error('Backend is unavailable for this selection');
    if (
      TemplateFilteringService.getMatchingTemplates([[input.backendName, definition]], input.filterConfig).length !== 1
    )
      throw new Error('Backend is unavailable for this selection');
    // Runtime-owned settings are read from the unrendered definition. Context cannot interpolate executable or permissions.
    const config = definition.preparation;
    const checkoutRoot = await fs.promises.realpath(input.checkoutPath);
    if (!(await fs.promises.stat(checkoutRoot)).isDirectory()) throw new Error('Project Checkout is not a directory');
    const { projectConfig } = await resolveProjectContext(checkoutRoot);
    if (!hasExplicitProjectFilterSelection(input.filterConfig)) {
      let projectDefaults = {};
      if (projectConfig?.preset !== undefined) projectDefaults = { preset: projectConfig.preset };
      else if (projectConfig?.filter !== undefined) projectDefaults = { filter: projectConfig.filter };
      else if (projectConfig?.tags !== undefined)
        projectDefaults = { tags: normalizeTags(projectConfig.tags)?.join(',') };
      const projectFilter = resolveFilterSelection(projectDefaults, {
        presetLookup: { getPreset: (name) => PresetManager.getInstance().getPreset(name) ?? undefined },
      });
      if (!projectFilter.ok) throw new Error('Project filter configuration is invalid');
      if (
        TemplateFilteringService.getMatchingTemplates(
          [[input.backendName, definition]],
          projectFilter.selection.compatibility,
        ).length !== 1
      )
        throw new Error('Backend is unavailable for this checkout');
    }
    const configurationKey = digest(config ?? { unsupported: true });
    if (config) this.register(input.backendName, configurationKey, config);
    const grant: PreparationGrant = {
      owner: input.owner,
      target: { checkoutRoot, backendName: input.backendName, backendIdentity: digest(definition), configurationKey },
      policy: config
        ? {
            allowedActions: config.allowedActions,
            executionDeadlineMs: config.executionDeadlineMs,
            transientRetryLimit: config.transientRetryLimit,
          }
        : { allowedActions: [] },
      preferences: projectConfig?.preparation ?? {},
    };
    this.grantInputs.set(grant, structuredClone(input));
    return grant;
  }

  async control(grant: PreparationGrant, request: PreparationControlRequest): Promise<PreparationControlResult> {
    if (this.closed) throw new Error('Preparation coordinator is stopped');
    const operation = request.operation ?? 'query';
    const expiresAt = Date.now() + (request.waitMs ?? this.service.options.requestWaitMs);
    const probeOptions = () => ({ waitMs: Math.max(0, expiresAt - Date.now()), signal: request.signal });
    const validateAdmission = () =>
      this.revalidateGrant(grant, request.validateAdmission, false, expiresAt, request.signal);
    const key = digest(preparationKey(grant.target, grant.policy, this.service.options));
    if (!request.id && request.action !== 'inspect') {
      const current = this.currentStatus(key);
      if (current) {
        if (
          request.action === 'status' &&
          ['queued', 'running', 'cancelling'].includes(current.state) &&
          current.operation === operation
        )
          return this.publishStatus(grant, key, current);
        if (request.action === 'retry') {
          return this.withReservation(
            key,
            async (beforeAdmission) =>
              this.publish(
                grant,
                key,
                await this.service.retry(current.id, grant.policy, {
                  ...probeOptions(),
                  beforeAdmission,
                  validateAdmission,
                }),
              ),
            grant,
            request.assertAdmission,
          );
        }
        if (request.action === 'prepare' && current.state !== 'ready')
          return this.publish(grant, key, { state: 'job', status: current });
      }
    }
    if (request.id) {
      const handle = this.handles.get(request.id);
      if (!handle || handle.owner !== grant.owner || handle.key !== key)
        throw new Error('Unknown preparation operation for this grant and checkout');
      if (request.action === 'cancel') return this.publishStatus(grant, key, this.service.cancel(handle.serviceId));
      if (request.action === 'retry') {
        return this.withReservation(
          key,
          async (beforeAdmission) =>
            this.publish(
              grant,
              key,
              await this.service.retry(handle.serviceId, grant.policy, {
                ...probeOptions(),
                beforeAdmission,
                validateAdmission,
              }),
            ),
          grant,
          request.assertAdmission,
        );
      }
      if (request.action === 'wait' || request.action === 'status') {
        const status =
          request.action === 'wait'
            ? await this.service.wait(handle.serviceId, { waitMs: request.waitMs, signal: request.signal })
            : this.service.status(handle.serviceId);
        if (status?.state === 'ready') await this.refreshReadyStatus(status);
        return this.publishStatus(grant, key, status);
      }
      throw new Error('Job id is not accepted for this action');
    }
    const saved = this.store.get(key);
    if (saved) {
      const readiness = await this.service.recover(
        grant.target,
        operation,
        {
          previousJobId: saved.previousJobId,
          previousState: saved.state,
        },
        probeOptions(),
      );
      if (readiness.state === 'ready') {
        this.service.clearResolvedFailure(grant.target, operation, grant.policy, readiness);
        this.recycle();
        if (saved.operation === operation) this.store.delete(key);
        return { state: 'ready', readiness };
      }
      if (saved.state === 'failed' && saved.failure) {
        const restored =
          this.service.importFailure(
            grant.target,
            saved.operation,
            { ...grant.policy, executionDeadlineMs: saved.policy.executionDeadlineMs },
            saved.action,
            saved.failure,
          ) ?? this.currentStatus(key);
        if (restored) {
          if (request.action === 'retry')
            return this.withReservation(
              key,
              async (beforeAdmission) =>
                this.publish(
                  grant,
                  key,
                  await this.service.retry(restored.id, grant.policy, {
                    ...probeOptions(),
                    beforeAdmission,
                    validateAdmission,
                  }),
                ),
              grant,
              request.assertAdmission,
            );
          return this.publish(grant, key, { state: 'job', status: restored });
        }
      }
      if (readiness.state !== 'required') return readiness;
      if (request.action === 'inspect' || request.action === 'status') return readiness;
      if (request.action === 'retry') this.store.delete(key);
    }
    if (request.action === 'inspect' || request.action === 'status') {
      const readiness = await this.service.inspect(grant.target, operation, probeOptions());
      if (readiness.state === 'ready') {
        this.service.clearResolvedFailure(grant.target, operation, grant.policy, readiness);
        this.recycle();
        const saved = this.store.get(key);
        if (saved?.operation === operation) this.store.delete(key);
      }
      return readiness;
    }
    if (request.action !== 'prepare' && request.action !== 'retry')
      throw new Error('This action requires a preparation operation id');
    return this.withReservation(
      key,
      async (beforeAdmission) =>
        this.publish(
          grant,
          key,
          await this.service.prepare(grant.target, operation, grant.policy, undefined, {
            ...probeOptions(),
            beforeAdmission,
            validateAdmission,
          }),
        ),
      grant,
      request.assertAdmission,
    );
  }

  async admit(
    grant: PreparationGrant,
    operation: string,
    options: {
      waitMs?: number;
      signal?: AbortSignal;
      validateAdmission?: () => Promise<boolean>;
      assertAdmission?: () => void;
    } = {},
  ): Promise<PublicPreparationAdmission | BackendReadiness> {
    if (this.closed) throw new Error('Preparation coordinator is stopped');
    const expiresAt = Date.now() + (options.waitMs ?? this.service.options.requestWaitMs);
    const key = digest(preparationKey(grant.target, grant.policy, this.service.options));
    const recovered = this.store.get(key);
    if (recovered && !this.currentStatus(key)) {
      const status = await this.control(grant, {
        action: 'status',
        operation,
        waitMs: Math.max(0, expiresAt - Date.now()),
        signal: options.signal,
      });
      if (!status) throw new Error('Preparation recovery status is unavailable');
      if (status.state === 'ready' && 'readiness' in status && status.readiness?.state === 'ready') {
        if (!('operation' in status) || status.operation === operation)
          return { state: 'ready', readiness: status.readiness };
      }
      if (this.store.get(recovered.key)) {
        if ('id' in status) return { state: 'job', status };
        return status;
      }
    }
    return this.withReservation(
      key,
      async (beforeAdmission) => {
        const result = await this.service.admit(grant.target, operation, grant.policy, grant.preferences, {
          ...options,
          waitMs: Math.max(0, expiresAt - Date.now()),
          beforeAdmission,
          validateAdmission: () =>
            this.revalidateGrant(grant, options.validateAdmission, true, expiresAt, options.signal),
        });
        if (result.state === 'ready') {
          const current = this.currentStatus(key);
          if (current?.state === 'ready') await this.refreshReadyStatus(current);
          const saved = this.store.get(key);
          if (saved?.operation === operation) this.store.delete(key);
          this.recycle();
          return result;
        }
        if (result.state === 'pending') return { ...result, status: this.publishStatus(grant, key, result.status) };
        return this.publish(grant, key, result);
      },
      grant,
      options.assertAdmission,
    );
  }

  private async withReservation<T>(
    key: string,
    action: (beforeAdmission: () => void) => Promise<T>,
    grant: PreparationGrant,
    assertAdmission?: () => void,
  ): Promise<T> {
    let release: (() => void) | undefined;
    try {
      return await action(() => {
        this.assertGrantCurrent(grant);
        assertAdmission?.();
        release ??= this.store.reserve(key);
      });
    } finally {
      release?.();
    }
  }

  private assertGrantCurrent(grant: PreparationGrant): void {
    const input = this.grantInputs.get(grant);
    const current = ConfigManager.getInstance().loadDeclaredServerConfigs();
    const definition =
      current.templateServers[grant.target.backendName] ?? current.staticServers[grant.target.backendName];
    if (
      !input ||
      current.errors.length ||
      !definition ||
      definition.disabled ||
      digest(definition) !== grant.target.backendIdentity ||
      TemplateFilteringService.getMatchingTemplates([[grant.target.backendName, definition]], input.filterConfig)
        .length !== 1
    )
      throw new PreparationAuthorizationChangedError();
  }

  private async revalidateGrant(
    grant: PreparationGrant,
    validate: (() => Promise<boolean>) | undefined,
    automatic: boolean,
    expiresAt: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const input = this.grantInputs.get(grant);
    if (!input || signal?.aborted || Date.now() >= expiresAt) throw new PreparationAuthorizationChangedError();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => undefined;
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(new PreparationAuthorizationChangedError());
      timer = setTimeout(abort, Math.max(0, expiresAt - Date.now()));
      signal?.addEventListener('abort', abort, { once: true });
    });
    try {
      await Promise.race([
        stopped,
        (async () => {
          if (validate && !(await validate())) throw new PreparationAuthorizationChangedError();
          let fresh: PreparationGrant;
          try {
            fresh = await this.resolveGrant(input);
          } catch {
            throw new PreparationAuthorizationChangedError();
          }
          if (
            JSON.stringify(fresh.target) !== JSON.stringify(grant.target) ||
            JSON.stringify(fresh.policy) !== JSON.stringify(grant.policy) ||
            (automatic && !fresh.preferences[grant.target.backendName]?.enabled)
          )
            throw new PreparationAuthorizationChangedError();
          if (validate && !(await validate())) throw new PreparationAuthorizationChangedError();
          if (signal?.aborted || Date.now() >= expiresAt) throw new PreparationAuthorizationChangedError();
        })(),
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.stop();
    return this.shutdownPromise;
  }

  private async stop(): Promise<void> {
    this.closed = true;
    await this.service.shutdown();
    await Promise.allSettled(this.readinessRefreshes.values());
    await Promise.all(
      [...this.adapters.values()].map(async (adapter) => {
        await adapter.dispose?.();
      }),
    );
    await Promise.all(this.disposing);
    if (this.disposalFailures.length)
      throw new AggregateError(this.disposalFailures, 'Preparation source observer cleanup failed');
    this.handles.clear();
  }

  private register(backendName: string, configurationKey: string, config: RuntimePreparationConfig): void {
    transportConfigSchema.shape.preparation.parse(config);
    const adapterKey = `${backendName}:${configurationKey}`;
    this.latestAdapters.set(backendName, adapterKey);
    this.recycle();
    if (!this.adapters.has(adapterKey)) {
      if (this.adapters.size >= this.service.options.maxRecords)
        throw new Error('Preparation adapter capacity reached');
      this.adapters.set(
        adapterKey,
        this.ports.adapterFactory?.(config) ??
          new CodeGraphPreparationAdapter({
            executable: config.executable,
            expectedVersion: config.expectedVersion,
            ...(config.sourceMonitor ? { sourceMonitor: config.sourceMonitor } : {}),
          }),
      );
    }
    if (this.registered.has(backendName)) return;
    const adapterFor = (target: PreparationTarget): OwnedAdapter => {
      const adapter = this.adapters.get(`${target.backendName}:${target.configurationKey}`);
      if (!adapter) throw new Error('Preparation backend configuration changed');
      return adapter;
    };
    this.registry.register(backendName, {
      inspect: (target, operation, options) =>
        this.trackAdapter(target, () => adapterFor(target).inspect(target, operation, options)),
      prepare: (target, action, options) =>
        this.trackAdapter(target, () => adapterFor(target).prepare(target, action, options)),
      classifyFailure: (error) => {
        const adapter = error !== null && typeof error === 'object' ? this.failureAdapters.get(error) : undefined;
        return (
          adapter?.classifyFailure(error) ?? {
            code: 'adapter_unavailable',
            message: 'Preparation adapter is unavailable.',
            retryable: false,
            instructions: 'Inspect runtime backend configuration and explicitly retry.',
          }
        );
      },
      reconcile: (target, operation, advisory, options) =>
        this.trackAdapter(target, () => {
          const adapter = adapterFor(target);
          return (
            adapter.reconcile?.(target, operation, advisory, options) ??
            Promise.resolve({
              state: 'conflict',
              instructions: 'Native recovery is unavailable; reconcile ownership before retrying.',
            })
          );
        }),
    });
    this.registered.add(backendName);
  }

  private publish(
    grant: PreparationGrant,
    key: string,
    result: PreparationResult | PreparationAdmission,
  ): PublicPreparationAdmission {
    if (result.state === 'pending') return { ...result, status: this.publishStatus(grant, key, result.status) };
    if (result.state !== 'job') return result;
    return { ...result, status: this.publishStatus(grant, key, result.status) };
  }
  private publishStatus(grant: PreparationGrant, key: string, status: PreparationStatus): PublicPreparationStatus;
  private publishStatus(
    grant: PreparationGrant,
    key: string,
    status: PreparationStatus | undefined,
  ): PublicPreparationStatus | undefined;
  private publishStatus(
    grant: PreparationGrant,
    key: string,
    status: PreparationStatus | undefined,
  ): PublicPreparationStatus | undefined {
    if (!status) return undefined;
    this.recycle();
    this.store.save(key, status, grant.policy);
    let handle = [...this.handles].find(
      ([, value]) => value.owner === grant.owner && value.key === key && value.serviceId === status.id,
    )?.[0];
    if (!handle) {
      if (this.handles.size >= this.service.options.maxRecords * 4)
        throw new Error('Preparation control capacity reached');
      handle = randomUUID();
      this.handles.set(handle, { owner: grant.owner, key, serviceId: status.id });
    }
    this.monitor(grant, key, status);
    return {
      ...status,
      id: handle,
      target: { checkoutRoot: status.target.checkoutRoot, backendName: status.target.backendName },
    };
  }
  private currentStatus(key: string): PreparationStatus | undefined {
    for (const value of [...this.handles.values()].reverse()) {
      if (value.key !== key) continue;
      const status = this.service.status(value.serviceId);
      if (status) return status;
    }
    return undefined;
  }
  private async trackAdapter<T>(target: PreparationTarget, action: () => Promise<T>): Promise<T> {
    const key = `${target.backendName}:${target.configurationKey}`;
    const adapter = this.adapters.get(key);
    this.adapterCalls.set(key, (this.adapterCalls.get(key) ?? 0) + 1);
    try {
      return await action();
    } catch (error) {
      const wrapped = error !== null && typeof error === 'object' ? error : new Error(String(error));
      if (adapter) this.failureAdapters.set(wrapped, adapter);
      throw wrapped;
    } finally {
      this.adapterCalls.set(key, (this.adapterCalls.get(key) ?? 1) - 1);
    }
  }
  private recycle(): void {
    for (const [id, handle] of this.handles) {
      const status = this.service.status(handle.serviceId);
      if (!status) {
        this.handles.delete(id);
        continue;
      }
      if (this.handles.size >= this.service.options.maxRecords * 4 && ['ready', 'cancelled'].includes(status.state))
        this.handles.delete(id);
    }
    for (const [key, adapter] of this.adapters) {
      if ([...this.latestAdapters.values()].includes(key)) continue;
      if ((this.adapterCalls.get(key) ?? 0) > 0) continue;
      const pending = [...this.handles.values()].some((handle) => {
        const status = this.service.status(handle.serviceId);
        if (!status || !['queued', 'running', 'cancelling'].includes(status.state)) return false;
        return `${status.target.backendName}:${status.target.configurationKey}` === key;
      });
      if (pending) continue;
      const disposing = Promise.resolve().then(async () => {
        await adapter.dispose?.();
      });
      this.disposing.add(disposing);
      void disposing.then(
        () => this.disposing.delete(disposing),
        (error: unknown) => {
          this.disposalFailures.push(error);
          this.disposing.delete(disposing);
        },
      );
      this.adapters.delete(key);
      this.adapterCalls.delete(key);
    }
  }
  private monitor(grant: PreparationGrant, key: string, status: PreparationStatus): void {
    if (this.monitored.has(status.id)) return;
    if (['ready', 'failed', 'cancelled'].includes(status.state)) return;
    this.monitored.add(status.id);
    void (async () => {
      while (true) {
        const finished = await this.service.wait(status.id, { waitMs: 3_600_000 });
        if (!finished) return;
        this.store.save(key, finished, grant.policy);
        if (finished.state === 'ready') await this.refreshReadyStatus(finished);
        if (['ready', 'failed', 'cancelled'].includes(finished.state)) return;
      }
    })()
      .catch(() => {
        /* Status remains available through explicit controls; no implicit retry. */
      })
      .finally(() => this.monitored.delete(status.id));
  }

  private async refreshReadyStatus(status: PreparationStatus): Promise<void> {
    if (this.refreshedJobs.has(status.id)) return;
    const existing = this.readinessRefreshes.get(status.id);
    if (existing) return existing;
    const refresh = Promise.resolve()
      .then(() => this.ports.onReady?.(status.target))
      .then(() => {
        this.refreshedJobs.add(status.id);
        if (this.refreshedJobs.size > this.service.options.maxRecords)
          this.refreshedJobs.delete(this.refreshedJobs.values().next().value!);
      });
    this.readinessRefreshes.set(status.id, refresh);
    try {
      await refresh;
    } finally {
      this.readinessRefreshes.delete(status.id);
    }
  }
}

const runtimeCoordinators = new WeakMap<ServerManager, BackendPreparationCoordinator>();

export async function refreshPreparedBackendCapabilities(
  serverManager: ServerManager,
  target: PreparationTarget,
  options: { missingTool?: string; onlyEmptyInventory?: boolean } = {},
): Promise<void> {
  const declared = ConfigManager.getInstance().loadDeclaredServerConfigs();
  const definition = declared.templateServers[target.backendName] ?? declared.staticServers[target.backendName];
  if (declared.errors.length || !definition || definition.disabled || digest(definition) !== target.backendIdentity)
    return;
  const manager = serverManager.getTemplateServerManager();
  const bindingContexts = manager.getBindingContexts();
  const resolver = createConnectionResolver(serverManager.getClients(), {
    getBindingContext: (bindingId) => bindingContexts.get(bindingId),
    getBindingPolicies: (bindingId) => manager.getBindingPolicies(bindingId),
    getRenderedHashForSession: (bindingId, backendName) => manager.getRenderedHashForSession(bindingId, backendName),
    getAllRenderedHashesForSession: (bindingId) => manager.getAllRenderedHashesForSession(bindingId),
  });
  const connections = new Set<NonNullable<ReturnType<typeof resolver.resolve>>>();
  for (const [bindingId, context] of bindingContexts) {
    const filter = manager.getBindingConfiguration(bindingId);
    if (
      !filter ||
      TemplateFilteringService.getMatchingTemplates([[target.backendName, definition]], filter).length !== 1
    )
      continue;
    const authority = manager.getBindingAuthority(bindingId);
    if (
      !authority ||
      !context.sessionId ||
      !validateProjectPreparationAuthority(authority, { bindingId, context, ownerSessionId: context.sessionId })
    )
      continue;
    let checkoutPath: string;
    try {
      checkoutPath = requireProjectTarget(context, 'single')[0].path;
    } catch {
      continue;
    }
    // Only live verified binding contexts may authorize these canonicalization reads.
    try {
      if ((await fs.promises.realpath(checkoutPath)) !== target.checkoutRoot) continue;
    } catch {
      continue;
    }
    const connection = resolver.resolve(target.backendName, bindingId);
    if (!connection) continue;
    if (options.onlyEmptyInventory) {
      const tools = readConfiguredToolSnapshot(connection);
      // The pinned read-only helper's source schemas are independent of index contents.
      // Syncing source preserves an existing declaration/header; initialization changes an empty inventory.
      if (!tools || tools.length) continue;
    }
    if (options.missingTool) {
      const tools = readConfiguredToolSnapshot(connection);
      // An absent snapshot will be enumerated by the actual invocation catalog. Preserve already-declared header fences.
      if (!tools || tools.some((tool) => tool.name === options.missingTool)) continue;
    }
    connections.add(connection);
  }
  for (const connection of connections) await invalidatePreparedToolProvider(connection);
  if (connections.size) await serverManager.getLazyLoadingOrchestrator()?.refreshCapabilities();
}

export function getBackendPreparationCoordinator(serverManager: ServerManager): BackendPreparationCoordinator {
  let coordinator = runtimeCoordinators.get(serverManager);
  if (coordinator) return coordinator;
  coordinator = new BackendPreparationCoordinator({
    options: ConfigManager.getInstance().getAppConfig().preparation,
    storagePath: AgentConfigManager.getInstance().get('runtimeScopeStoragePath'),
    onReady: (target) => refreshPreparedBackendCapabilities(serverManager, target, { onlyEmptyInventory: true }),
  });
  runtimeCoordinators.set(serverManager, coordinator);
  serverManager.registerOwnedCleanup(async () => {
    const outcomes = await Promise.allSettled([coordinator!.shutdown(), disposeCodeGraphPreparationToolMetadata()]);
    const failures: unknown[] = [];
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        const reason: unknown = outcome.reason;
        failures.push(reason);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Backend preparation shutdown failed');
  });
  return coordinator;
}
