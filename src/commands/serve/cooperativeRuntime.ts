import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { MCP_SERVER_VERSION } from '@src/constants.js';
import { RuntimeIdentityService } from '@src/core/runtime/runtimeIdentityService.js';
import {
  runBackgroundRuntimeSupervisor,
  type SupervisedRuntimeWorker,
} from '@src/core/server/backgroundRuntimeSupervisor.js';
import {
  cleanupBackgroundSupervisorState,
  readBackgroundSupervisorState,
} from '@src/core/server/backgroundRuntimeSupervisorState.js';
import {
  cleanupPidFileIfMatches,
  readPidFile,
  type ServerPidInfo,
  serverPidInfoSchema,
} from '@src/core/server/pidFileManager.js';
import {
  connectRuntimeControl,
  type RuntimeControlDescription,
  startRuntimeControl,
} from '@src/core/server/runtimeControl.js';
import {
  admissionSnapshotSchema,
  type ReplacementDrainStatus,
  runtimeAdmission,
  RuntimeReplacementDrain,
} from '@src/core/server/runtimeDrain.js';
import {
  receiveRuntimeBootstrap,
  requestWorker,
  type RuntimeLaunchBootstrap,
  sendChild,
  sendRuntimeParent,
  waitForChildActivation,
} from '@src/core/server/runtimeLaunchIpc.js';
import { probeLoadingSummary, probeReadiness } from '@src/core/server/runtimeLifecycle.js';
import {
  activateRuntimeReplacementConfig,
  captureExplicitLaunchInputs,
  explicitLaunchInputsSchema,
  installRuntimeReplacementConfig,
  type PreparedRuntimeReplacementConfig,
  prepareRuntimeReplacementConfig,
} from '@src/core/server/runtimeReplacementConfig.js';
import {
  claimRuntimeScope,
  getRuntimeScopeOwnershipPath,
  readRuntimeScopeOwnership,
} from '@src/core/server/runtimeScopeOwnership.js';
import { normalizedArgv } from '@src/utils/cli/normalizedArgv.js';

import { z } from 'zod';

import { resolveServeConfigPaths } from './runtimeScope.js';
import type { ServeOptions } from './serve.js';
import { defaultBackgroundLogFile, resolveSelfInvocation } from './serveBackground.js';
import { parseInternalToolsList } from './serveOptions.js';
import { resolveTemplateContextTrust } from './templateContextTrust.js';

const activationSchema = z.object({
  type: z.literal('runtime-activated'),
  nonce: z.string().uuid(),
  claimId: z.string().uuid(),
  digest: z.string(),
  version: z.string(),
  runtime: serverPidInfoSchema,
});
const prepareSchema = z
  .object({ digest: z.string().regex(/^[a-f0-9]{64}$/), timeoutMs: z.number().int().positive().max(86400000) })
  .strict();
const commitSchema = prepareSchema.pick({ digest: true });
const statusSchema = z.object({
  operationId: z.string(),
  digest: z.string(),
  state: z.enum(['preparing', 'draining', 'drained', 'committing', 'aborted']),
  deadlineUnixMs: z.number(),
  active: z.number().int().nonnegative(),
});
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function assertEmptyScope(scope: string): void {
  for (const name of [
    'runtime.owner',
    'runtime.stop',
    'server.pid',
    'background-runtime.json',
    'background-launch.json',
    'runtime-control.json',
  ]) {
    if (fs.existsSync(path.join(scope, name)))
      throw new Error(
        'A runtime already owns this Runtime Scope or ownership is uncertain. Use serve --status and the original CLI or service manager for explicit migration/recovery; no takeover was attempted.',
      );
  }
}

function prepare(
  options: ServeOptions,
  previous: unknown = { version: 1, values: {} },
): PreparedRuntimeReplacementConfig {
  const { configFilePath, runtimeScope } = resolveServeConfigPaths(options);
  const prepared = prepareRuntimeReplacementConfig({
    configFilePath,
    runtimeScope,
    previousExplicitInputs: explicitLaunchInputsSchema.parse(previous),
    invocationExplicitInputs: captureExplicitLaunchInputs(normalizedArgv),
  });
  const effective = { ...options, ...prepared.effectiveOptions };
  const app = prepared.snapshot.appConfig;
  if ((effective.transport ?? app.transport) === 'stdio') throw new Error('Background runtime requires HTTP transport');
  resolveTemplateContextTrust({
    cliTrust: effective['template-context-trust'],
    configTrust: app.templateContext?.trust,
    host: effective.host ?? app.host ?? '127.0.0.1',
    confirmUntrusted: effective['confirm-untrusted-template-context'] ?? false,
    transport: 'http',
  });
  parseInternalToolsList(effective['internal-tools']);
  return prepared;
}

/** Only an empty scope can be launched; the spawned supervisor still performs the atomic claim. */
export async function launchCooperativeRuntime(
  options: ServeOptions,
  prepared?: PreparedRuntimeReplacementConfig,
): Promise<void> {
  const paths = resolveServeConfigPaths(options);
  const runtimeScope = paths.runtimeScope;
  const configFilePath = prepared?.snapshot.configFilePath ?? paths.configFilePath;
  assertEmptyScope(runtimeScope);
  fs.mkdirSync(runtimeScope, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(configFilePath))
    fs.writeFileSync(configFilePath, '{"mcpServers":{}}\n', { flag: 'wx', mode: 0o600 });
  prepared ??= prepare(options);
  const effective = { ...options, ...prepared.effectiveOptions, config: configFilePath, 'config-dir': runtimeScope };
  if ((effective.transport ?? prepared.snapshot.appConfig.transport) === 'stdio')
    throw new Error('Background runtime requires HTTP transport');
  effective.transport = 'http';
  effective['log-file'] ??=
    prepared.snapshot.appConfig.logging?.file ??
    prepared.snapshot.appConfig.logFile ??
    defaultBackgroundLogFile(runtimeScope);
  fs.mkdirSync(path.dirname(effective['log-file']), { recursive: true, mode: 0o700 });
  const { command, baseArgs } = resolveSelfInvocation();
  const child = spawn(
    command,
    [...baseArgs, 'serve', '--cooperative-bootstrap=supervisor', '--config', configFilePath],
    { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
  );
  const bootstrap: RuntimeLaunchBootstrap = {
    type: 'runtime-bootstrap',
    nonce: randomUUID(),
    digest: prepared.digest,
    snapshot: prepared.snapshot,
    options: effective,
  };
  process.stderr.write(`Starting background runtime supervisor (PID ${child.pid ?? 'pending'})…\n`);
  try {
    const activated = activationSchema.parse(await waitForChildActivation(child, bootstrap));
    const owner = readRuntimeScopeOwnership(runtimeScope);
    if (
      activated.nonce !== bootstrap.nonce ||
      activated.digest !== bootstrap.digest ||
      activated.version !== MCP_SERVER_VERSION ||
      owner?.claimId !== activated.claimId ||
      owner.pid !== child.pid
    )
      throw new Error('Runtime activation did not match the spawned generation');
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Supervisor exited during activation');
    const summary = await probeLoadingSummary(activated.runtime);
    const control = await connectRuntimeControl(runtimeScope);
    const current = await control?.request<RuntimeControlDescription>('describe');
    if (
      !current ||
      current.runtime?.pid !== activated.runtime.pid ||
      current.digest !== activated.digest ||
      current.version !== activated.version ||
      control?.descriptor.claimId !== activated.claimId
    )
      throw new Error('Worker exited or changed during activation verification');
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('Supervisor exited during activation verification');
    process.stdout.write(
      `Runtime activated (version ${activated.version}).\nBackground runtime started.\nSupervisor PID: ${child.pid}\nRuntime PID: ${activated.runtime.pid}\nGeneration: ${activated.claimId}\nConfiguration: ${activated.digest}\nURL: ${activated.runtime.url}\nBackend health: ${summary ? JSON.stringify(summary) : 'loading or unavailable; see serve --status'}\n`,
    );
    process.exitCode = 0;
  } finally {
    if (child.connected) child.disconnect();
    child.unref();
  }
}

/** Preflight precedes the first mutation. Lost commit responses are reconciled, never resent. */
export async function restartCooperativeRuntime(options: ServeOptions): Promise<void> {
  const { runtimeScope } = resolveServeConfigPaths(options);
  const client = await connectRuntimeControl(runtimeScope);
  if (!client) {
    assertEmptyScope(runtimeScope);
    await launchCooperativeRuntime(options);
    return;
  }
  const description = await client.request<RuntimeControlDescription>('describe');
  if (!explicitLaunchInputsSchema.safeParse(description.explicitInputs).success)
    throw new Error(
      'Incompatible runtime: explicit launch provenance is missing. Stop with the original CLI or service manager before activating this installation.',
    );
  const prepared = prepare(options, description.explicitInputs);
  const timeoutMs = (options['drain-timeout'] ?? 30) * 1000;
  prepareSchema.parse({ digest: prepared.digest, timeoutMs });
  const operationId = randomUUID();
  process.stderr.write('Draining background runtime before activation…\n');
  let operation: ReplacementDrainStatus;
  try {
    operation = statusSchema.parse(
      await client.request('prepare-replacement', { digest: prepared.digest, timeoutMs }, operationId),
    );
  } catch {
    operation = statusSchema.parse(await client.request('operation-status', {}, operationId));
  }
  while (operation.state === 'draining' || operation.state === 'preparing') {
    await sleep(100);
    operation = statusSchema.parse(await client.request('operation-status', {}, operationId));
  }
  if (operation.state === 'aborted')
    throw new Error('Runtime upgrade aborted at the drain deadline; the old runtime resumed admission');
  if (operation.state !== 'drained') throw new Error('Runtime replacement is not ready to commit');
  try {
    await client.request('commit-replacement', { digest: prepared.digest }, operationId);
  } catch {
    // An unreachable control endpoint is not proof of retirement. Exclusive ownership below is authoritative.
    let reconciled: ReplacementDrainStatus | undefined;
    try {
      reconciled = statusSchema.parse(await client.request('operation-status', {}, operationId));
    } catch {
      process.stderr.write('Commit response unavailable; waiting for observed owner retirement.\n');
    }
    if (reconciled && reconciled.state !== 'committing')
      throw new Error('Runtime commit was not accepted; existing owner retained');
  }
  const until = Date.now() + 30_000;
  while (fs.existsSync(getRuntimeScopeOwnershipPath(runtimeScope)) && Date.now() < until) {
    if (readRuntimeScopeOwnership(runtimeScope)?.claimId !== client.descriptor.claimId)
      throw new Error('Another runtime won ownership; replacement not started');
    await sleep(100);
  }
  if (fs.existsSync(getRuntimeScopeOwnershipPath(runtimeScope)))
    throw new Error('Old runtime has not retired. Ownership retained; inspect status for explicit recovery');
  try {
    await launchCooperativeRuntime(options, prepared);
  } catch (error) {
    throw new Error(
      `Runtime activation failed after retirement; no rollback was attempted. Retry serve --restart after resolving the cause: ${error instanceof Error ? error.message : 'launch failure'}`,
    );
  }
}

export async function runCooperativeSupervisor(): Promise<void> {
  const bootstrap = await receiveRuntimeBootstrap();
  const scope = bootstrap.snapshot.runtimeScope;
  installRuntimeReplacementConfig(bootstrap.snapshot, bootstrap.digest, scope);
  assertEmptyScope(scope);
  const ownership = claimRuntimeScope(scope, { kind: 'background-supervisor', cooperative: true });
  let worker: ChildProcess | undefined;
  const spawnedWorkerPids = new Set<number>();
  let runtime: ServerPidInfo | null = null;
  let activated = false;
  let stopping = false;
  let failed = false;
  let admissionClosed = false;
  let stop!: () => void;
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const requestStop = () => {
    stopping = true;
    stop();
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(signal, requestStop);
  const requireWorker = (): ChildProcess => {
    if (!worker || worker.exitCode !== null || !worker.connected)
      throw new Error('Runtime worker unavailable; ownership retained');
    return worker;
  };
  const activations = new WeakMap<SupervisedRuntimeWorker, Promise<boolean>>();
  const controlWorker = async (action: 'close' | 'resume' | 'commit') => {
    const child = requireWorker();
    try {
      const activation = activations.get(child as unknown as SupervisedRuntimeWorker);
      if (!activation) throw new Error('Worker private launch authorization is unavailable');
      await activation;
    } catch (error) {
      if (action === 'resume' && worker !== child) return;
      throw error;
    }
    if (worker !== child) {
      if (action === 'resume') return;
      throw new Error('Worker changed during replacement preparation');
    }
    return requestWorker(child, action);
  };
  const drain = new RuntimeReplacementDrain({
    close: async () => {
      admissionClosed = true;
      if (!worker) return { closed: true, active: 0, committed: false };
      return admissionSnapshotSchema.parse(await controlWorker('close'));
    },
    resume: async () => {
      admissionClosed = false;
      if (worker) await controlWorker('resume');
    },
    commit: async () => {
      if (!worker) return { closed: admissionClosed, active: 0, committed: true };
      return admissionSnapshotSchema.parse(await controlWorker('commit'));
    },
  });
  const control = await startRuntimeControl(scope, ownership.record.claimId, async (method, payload, operationId) => {
    switch (method) {
      case 'describe':
        return {
          runtime,
          runtimeScopeId: new RuntimeIdentityService({ storageDir: scope }).getRuntimeScopeId(),
          version: MCP_SERVER_VERSION,
          explicitInputs: bootstrap.snapshot.explicitInputs,
          digest: bootstrap.digest,
          supervisorPid: process.pid,
          state: stopping
            ? 'stopping'
            : failed
              ? 'crash-loop'
              : admissionClosed
                ? 'draining'
                : (readBackgroundSupervisorState(scope)?.status ?? 'starting'),
        } satisfies RuntimeControlDescription;
      case 'prepare-replacement': {
        const input = prepareSchema.parse(payload);
        if (stopping) throw new Error('Runtime is retiring');
        return drain.prepare(operationId, input.digest, input.timeoutMs);
      }
      case 'operation-status':
        return drain.status(operationId);
      case 'commit-replacement': {
        const input = commitSchema.parse(payload);
        const result = await drain.commit(operationId, input.digest);
        if (!stopping) setImmediate(requestStop);
        return result;
      }
      case 'stop':
        if (!stopping) setImmediate(requestStop);
        return { accepted: true };
    }
  }).catch((error: unknown) => {
    // No worker has been spawned, so this process can safely release its own failed launch.
    ownership.release();
    throw error;
  });
  const { command, baseArgs } = resolveSelfInvocation();
  try {
    try {
      await runBackgroundRuntimeSupervisor(
        {
          configDir: scope,
          claimId: ownership.record.claimId,
          workerCommand: command,
          workerArgs: [
            ...baseArgs,
            'serve',
            '--cooperative-bootstrap=worker',
            '--config',
            bootstrap.snapshot.configFilePath,
          ],
        },
        {
          waitForStop: () => stopped,
          beforeSpawn: async () => {
            while (admissionClosed && !stopping) await sleep(50);
          },
          spawnWorker: (cmd, args) => {
            if (stopping) throw new Error('Supervisor is retiring; worker restart refused');
            runtime = null;
            const child = spawn(cmd, [...args], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
            worker = child;
            if (child.pid) spawnedWorkerPids.add(child.pid);
            const launch = { ...bootstrap, nonce: randomUUID(), claimId: ownership.record.claimId };
            const ready = waitForChildActivation(child, launch).then((message) => {
              const value = activationSchema.parse(message);
              if (
                value.nonce !== launch.nonce ||
                value.claimId !== ownership.record.claimId ||
                value.digest !== bootstrap.digest ||
                value.version !== MCP_SERVER_VERSION ||
                value.runtime.pid !== child.pid
              )
                throw new Error('Worker activation binding failed');
              runtime = value.runtime;
              if (!activated && process.connected) sendRuntimeParent({ ...value, nonce: bootstrap.nonce });
              activated = true;
              sendChild(child, { type: 'runtime-activation-recorded', digest: bootstrap.digest });
              return true;
            });
            // Keep a rejection handled while the supervisor installs its readiness race.
            void ready.catch(() => undefined);
            activations.set(child as unknown as SupervisedRuntimeWorker, ready);
            child.on('message', (message) => {
              if (
                worker === child &&
                message &&
                typeof message === 'object' &&
                'type' in message &&
                message.type === 'runtime-admission' &&
                'snapshot' in message
              ) {
                const parsed = admissionSnapshotSchema.safeParse(message.snapshot);
                if (parsed.success) drain.update(parsed.data);
              }
            });
            child.once('exit', () => {
              if (worker === child) {
                worker = undefined;
                runtime = null;
                if (drain.workerExited()) requestStop();
              }
            });
            return child as unknown as SupervisedRuntimeWorker;
          },
          waitForReady: (child) => activations.get(child)!,
        },
      );
    } catch {
      // The supervisor loop observes tracked worker close before rejecting. Keep explicit stop available.
      failed = true;
      worker = undefined;
      runtime = null;
      if (drain.workerExited()) requestStop();
      if (process.connected) sendRuntimeParent({ type: 'runtime-failed' });
      await stopped;
    }
    await control.close();
    const retiredRuntime = readPidFile(scope);
    if (retiredRuntime) {
      if (retiredRuntime.ownerClaimId !== ownership.record.claimId || !spawnedWorkerPids.has(retiredRuntime.pid))
        throw new Error('Runtime metadata changed during retirement; ownership retained');
      if (!cleanupPidFileIfMatches(scope, retiredRuntime))
        throw new Error('Runtime metadata cleanup failed; ownership retained');
    }
    if (!cleanupBackgroundSupervisorState(scope, process.pid, ownership.record.claimId))
      throw new Error('Supervisor generation changed during retirement; ownership retained');
    ownership.release();
  } finally {
    // Do not release ownership in a failure path unless the tracked worker has retired.
    if (process.connected) process.disconnect?.();
  }
}

let activationRecorded = false;
let initialLoadingSettled = false;
let workerBootstrapDigest: string | undefined;

function releaseWorkerBootstrap(): void {
  if (!activationRecorded || !initialLoadingSettled || !workerBootstrapDigest) return;
  const digest = workerBootstrapDigest;
  workerBootstrapDigest = undefined;
  activateRuntimeReplacementConfig(digest);
}

export function settleCooperativeInitialLoading(): void {
  initialLoadingSettled = true;
  releaseWorkerBootstrap();
}

export async function authorizeCooperativeWorker(): Promise<RuntimeLaunchBootstrap> {
  const bootstrap = await receiveRuntimeBootstrap();
  const owner = readRuntimeScopeOwnership(bootstrap.snapshot.runtimeScope);
  if (
    !bootstrap.claimId ||
    owner?.claimId !== bootstrap.claimId ||
    owner.kind !== 'background-supervisor' ||
    owner.pid !== process.ppid ||
    !owner.cooperative
  )
    throw new Error('Private worker launch does not match scope ownership');
  installRuntimeReplacementConfig(bootstrap.snapshot, bootstrap.digest, bootstrap.snapshot.runtimeScope);
  workerBootstrapDigest = bootstrap.digest;
  const requestSchema = z.object({
    type: z.literal('runtime-request'),
    id: z.string().uuid(),
    action: z.enum(['close', 'resume', 'commit']),
  });
  runtimeAdmission.subscribe((snapshot) => {
    if (process.connected) sendRuntimeParent({ type: 'runtime-admission', snapshot });
  });
  process.on('message', (message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === 'runtime-activation-recorded' &&
      'digest' in message &&
      message.digest === bootstrap.digest
    ) {
      activationRecorded = true;
      releaseWorkerBootstrap();
      return;
    }
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success) return;
    const { id, action } = parsed.data;
    try {
      if (action === 'close') runtimeAdmission.close();
      if (action === 'resume') runtimeAdmission.resume();
      if (action === 'commit') runtimeAdmission.commit();
      sendRuntimeParent({ type: 'runtime-reply', id, value: runtimeAdmission.snapshot() });
    } catch {
      sendRuntimeParent({ type: 'runtime-reply', id, value: null, error: 'Runtime admission transition rejected' });
    }
  });
  // A lost supervisor cannot authorize new work or a competing owner. Keep evidence for explicit recovery.
  process.once('disconnect', () => {
    runtimeAdmission.close();
  });
  return bootstrap;
}

export function acknowledgeCooperativeWorker(bootstrap: RuntimeLaunchBootstrap): void {
  const runtime = readPidFile(bootstrap.snapshot.runtimeScope);
  if (runtime?.pid !== process.pid || runtime.ownerClaimId !== bootstrap.claimId)
    throw new Error('Worker metadata does not match activation');
  sendRuntimeParent({
    type: 'runtime-activated',
    nonce: bootstrap.nonce,
    claimId: bootstrap.claimId,
    digest: bootstrap.digest,
    version: MCP_SERVER_VERSION,
    runtime,
  });
}

export async function stopCooperativeRuntime(scope: string): Promise<boolean> {
  const client = await connectRuntimeControl(scope);
  if (!client) return false;
  await client.request('describe');
  try {
    await client.request('stop');
  } catch {
    /* Verify retirement below even if the response was lost. */
  }
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const owner = readRuntimeScopeOwnership(scope);
    if (!owner || owner.claimId !== client.descriptor.claimId) {
      process.stdout.write('Stopped supervised background runtime.\n');
      process.exitCode = 0;
      return true;
    }
    await sleep(100);
  }
  throw new Error('Runtime did not retire; ownership retained. Use explicit recovery after inspecting status');
}

export async function cooperativeRuntimeStatus(
  scope: string,
): Promise<{ description: RuntimeControlDescription; ready: boolean } | null> {
  const client = await connectRuntimeControl(scope);
  if (!client) return null;
  const description = await client.request<RuntimeControlDescription>('describe');
  return { description, ready: description.runtime ? await probeReadiness(description.runtime) : false };
}
