import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { z } from 'zod';

import {
  createSanitizedWireCapture,
  type SanitizedWireEvidenceFile,
  SanitizedWireEvidenceFileSchema,
  startHttpWireTap,
  type TrustedWireContext,
} from '../capture/index.js';

const SafeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const RevisionSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u);
const EraSchema = z.enum(['legacy', 'modern']);
const VariantSchema = z.enum(['typescript-baseline', 'alternate-inbound', 'alternate-upstream']);
const UpstreamTransportTypeSchema = z.enum(['stdio', 'sse', 'http', 'streamableHttp']);
const CommandSchema = z
  .object({
    command: z.string().min(1).max(4_096),
    args: z.array(z.string().max(16_384)).max(128),
  })
  .strict();
const TrustedContextSchema = z.object({ id: SafeIdSchema.max(64), negotiatedRevision: RevisionSchema }).strict();
const TimeoutsSchema = z
  .object({
    startupMs: z.number().int().min(100).max(120_000),
    probeMs: z.number().int().min(100).max(120_000),
    shutdownMs: z.number().int().min(100).max(30_000),
  })
  .strict();

const RuntimeOwnedReadinessSchema = z.object({ kind: z.literal('runtime-owned') }).strict();
const StdoutReadinessSchema = z.object({ kind: z.literal('stdout-json'), fixtureId: SafeIdSchema }).strict();

const MatrixExecutionOptionsSchema = z
  .object({
    assignmentId: SafeIdSchema,
    inboundProbe: CommandSchema,
    upstreamPeer: CommandSchema.extend({
      readiness: z.discriminatedUnion('kind', [RuntimeOwnedReadinessSchema, StdoutReadinessSchema]),
    }).strict(),
    upstreamTransport: z.object({ type: UpstreamTransportTypeSchema }).strict(),
    eras: z.object({ inbound: EraSchema, upstream: EraSchema }).strict(),
    revisions: z.object({ inbound: RevisionSchema, upstream: RevisionSchema }).strict(),
    captureContexts: z.object({ inbound: TrustedContextSchema, upstream: TrustedContextSchema }).strict(),
    builtEntryPath: z.string().min(1).max(4_096),
    gatewayArgs: z.array(z.string().max(16_384)).max(64).optional(),
    timeouts: TimeoutsSchema,
  })
  .strict();

const ProbeSuccessSchema = z
  .object({
    fixtureId: SafeIdSchema,
    transport: SafeIdSchema,
    initialized: z.literal(true),
    ping: z.literal(true),
    negotiatedRevision: RevisionSchema,
    operations: z
      .array(
        z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9][a-z0-9/._-]*$/u),
      )
      .min(1)
      .max(64),
    toolsCount: z.number().int().nonnegative().max(100_000),
    callError: z.boolean(),
  })
  .strict();

const ProbeUnsupportedSchema = z
  .object({
    fixtureId: SafeIdSchema,
    transport: SafeIdSchema,
    status: z.literal('unsupported'),
    unsupportedOperation: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9/._-]*$/u),
    negotiatedRevision: RevisionSchema,
    operations: z
      .array(z.enum(['server/discover', 'initialize', 'ping', 'tools/list', 'tools/call']))
      .min(1)
      .max(5),
  })
  .strict();

const ProbeRejectedSchema = z
  .object({
    fixtureId: SafeIdSchema,
    errorCode: z.enum([
      'initialize-failed',
      'protocol-probe-failed',
      'protocol-era-mismatch',
      'tools-list-failed',
      'tools-call-failed',
      'aggregated-tool-not-found',
      'gateway-probe-rejected',
      'removed-operation-mismatch',
    ]),
  })
  .strict();

const PeerProbeSchema = z
  .object({
    fixtureId: SafeIdSchema,
    transport: SafeIdSchema,
    protocolEra: EraSchema,
    ok: z.boolean(),
    classification: z.literal('unsupported-operation').optional(),
    unsupported: z
      .array(
        z
          .object({
            operation: z.enum(['initialize', 'ping']),
            reason: z.enum(['modern-uses-server-discover', 'not-in-2026-07-28']),
          })
          .strict(),
      )
      .optional(),
    initialized: z.boolean(),
    ping: z.boolean(),
    negotiatedRevision: RevisionSchema,
    operations: z
      .array(z.enum(['server/discover', 'initialize', 'ping', 'tools/list', 'tools/call']))
      .min(1)
      .max(5),
    toolsCount: z.number().int().nonnegative().max(100_000),
    callError: z.boolean(),
  })
  .strict();

const UpstreamReadySchema = z.object({
  endpoint: z.string().url(),
  fixtureId: SafeIdSchema,
  ready: z.literal(true),
  transport: SafeIdSchema,
});

export const MatrixAssignmentDescriptorSchema = z
  .object({
    assignmentId: SafeIdSchema,
    inboundEra: EraSchema,
    upstreamEra: EraSchema,
    variant: VariantSchema,
    claimedProfiles: z.array(SafeIdSchema).min(1).max(64),
    executedProfiles: z.array(SafeIdSchema).max(64),
  })
  .strict();

export type MatrixAssignmentDescriptor = z.infer<typeof MatrixAssignmentDescriptorSchema>;
export type MatrixExecutionOptions = z.input<typeof MatrixExecutionOptionsSchema>;
export type ProbeFacts = z.infer<typeof ProbeSuccessSchema>;

export type MatrixExecutionResult =
  | {
      kind: 'product';
      status: 'pass';
      reason: 'probe_succeeded';
      assignmentId: string;
      firstAttempt: true;
      facts: ProbeFacts;
      evidence: { inbound: SanitizedWireEvidenceFile; upstream: SanitizedWireEvidenceFile };
    }
  | {
      kind: 'product';
      status: 'fail';
      reason: 'unsupported_operation';
      assignmentId: string;
      firstAttempt: true;
      facts: z.infer<typeof ProbeUnsupportedSchema>;
      evidence: { inbound: SanitizedWireEvidenceFile; upstream: SanitizedWireEvidenceFile };
    }
  | {
      kind: 'product';
      status: 'fail';
      reason: 'gateway_rejected';
      assignmentId: string;
      firstAttempt: true;
      facts: z.infer<typeof ProbeRejectedSchema>;
      evidence: { inbound: SanitizedWireEvidenceFile; upstream: SanitizedWireEvidenceFile };
    }
  | {
      kind: 'infrastructure';
      defect: 'fixture' | 'process' | 'harness';
      reason: InfrastructureReason;
      assignmentId: string;
    };

type InfrastructureReason =
  | 'input_invalid'
  | 'setup_failed'
  | 'upstream_process_failed'
  | 'upstream_readiness_timeout'
  | 'upstream_readiness_invalid'
  | 'gateway_process_failed'
  | 'gateway_readiness_timeout'
  | 'probe_process_failed'
  | 'probe_timeout'
  | 'probe_output_invalid'
  | 'wire_evidence_invalid'
  | 'wire_evidence_incomplete'
  | 'cleanup_failed';

class RuntimeFault extends Error {
  constructor(
    readonly defect: 'fixture' | 'process' | 'harness',
    readonly reason: InfrastructureReason,
  ) {
    super(reason);
  }
}

interface ManagedChild {
  process: ChildProcess;
  exit: Promise<{ code: number | null; signal: string | null; spawnFailed: boolean }>;
  hasExited(): boolean;
}

type Environment = Record<string, string | undefined>;

const EXPECTED_MATRIX_KEYS = new Set(
  (['legacy', 'modern'] as const).flatMap((inboundEra) =>
    (['legacy', 'modern'] as const).flatMap((upstreamEra) =>
      (['typescript-baseline', 'alternate-inbound', 'alternate-upstream'] as const).map(
        (variant) => `${inboundEra}:${upstreamEra}:${variant}`,
      ),
    ),
  ),
);

export function validateMatrixAssignments(input: readonly MatrixAssignmentDescriptor[]): MatrixAssignmentDescriptor[] {
  const parsed = z.array(MatrixAssignmentDescriptorSchema).safeParse(input);
  if (!parsed.success) throw new Error('matrix-assignment-invalid');

  const assignmentIds = new Set<string>();
  const keys = new Set<string>();
  for (const assignment of parsed.data) {
    if (assignmentIds.has(assignment.assignmentId)) throw new Error('matrix-assignment-id-duplicate');
    assignmentIds.add(assignment.assignmentId);
    const key = `${assignment.inboundEra}:${assignment.upstreamEra}:${assignment.variant}`;
    if (keys.has(key)) throw new Error('matrix-assignment-duplicate');
    keys.add(key);

    const executed = new Set(assignment.executedProfiles);
    if (assignment.claimedProfiles.some((profile) => !executed.has(profile))) {
      throw new Error('matrix-profile-unexecuted');
    }
  }
  if (keys.size !== EXPECTED_MATRIX_KEYS.size || [...EXPECTED_MATRIX_KEYS].some((key) => !keys.has(key))) {
    throw new Error('matrix-assignment-missing');
  }
  return parsed.data;
}

function infrastructure(
  assignmentId: string,
  defect: 'fixture' | 'process' | 'harness',
  reason: InfrastructureReason,
): MatrixExecutionResult {
  return { kind: 'infrastructure', defect, reason, assignmentId };
}

function minimalEnvironment(home: string, runtimeScope: string): Environment {
  return {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    NODE_ENV: 'test',
    ONE_MCP_CONFIG_DIR: runtimeScope,
    ONE_MCP_LOG_LEVEL: 'error',
    ONE_MCP_ENABLE_AUTH: 'false',
  };
}

function startChild(command: string, args: readonly string[], environment: Environment, cwd: string): ManagedChild {
  const child = spawn(command, args, {
    cwd,
    env: environment,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let hasExited = false;
  const exit = new Promise<{ code: number | null; signal: string | null; spawnFailed: boolean }>((resolve) => {
    let settled = false;
    const finish = (result: { code: number | null; signal: string | null; spawnFailed: boolean }) => {
      if (settled) return;
      settled = true;
      hasExited = true;
      resolve(result);
    };
    child.once('error', () => finish({ code: null, signal: null, spawnFailed: true }));
    child.once('exit', (code, signal) => finish({ code, signal, spawnFailed: false }));
  });
  return { process: child, exit, hasExited: () => hasExited };
}

async function stopChild(child: ManagedChild, timeoutMs: number): Promise<void> {
  if (child.hasExited()) {
    await child.exit;
    return;
  }
  child.process.kill('SIGTERM');
  const stopped = await Promise.race([
    child.exit.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  if (stopped) return;
  child.process.kill('SIGKILL');
  const killed = await Promise.race([
    child.exit.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  if (!killed) throw new RuntimeFault('harness', 'cleanup_failed');
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new RuntimeFault('harness', 'setup_failed');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

function parseLoopbackEndpoint(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') return null;
    return endpoint;
  } catch {
    return null;
  }
}

async function waitForUpstreamReady(child: ManagedChild, fixtureId: string, timeoutMs: number): Promise<URL> {
  if (!child.process.stdout) throw new RuntimeFault('process', 'upstream_process_failed');
  const lines = createInterface({ input: child.process.stdout, crlfDelay: Infinity });
  const readiness = new Promise<URL>((resolve, reject) => {
    lines.on('line', (line) => {
      if (line.length > 16_384) {
        reject(new RuntimeFault('fixture', 'upstream_readiness_invalid'));
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        reject(new RuntimeFault('fixture', 'upstream_readiness_invalid'));
        return;
      }
      const parsed = UpstreamReadySchema.safeParse(value);
      if (!parsed.success || parsed.data.fixtureId !== fixtureId) {
        reject(new RuntimeFault('fixture', 'upstream_readiness_invalid'));
        return;
      }
      const endpoint = parseLoopbackEndpoint(parsed.data.endpoint);
      if (!endpoint) {
        reject(new RuntimeFault('fixture', 'upstream_readiness_invalid'));
        return;
      }
      resolve(endpoint);
    });
  });

  try {
    return await Promise.race([
      readiness,
      child.exit.then(() => {
        throw new RuntimeFault('process', 'upstream_process_failed');
      }),
      new Promise<URL>((_, reject) =>
        setTimeout(() => reject(new RuntimeFault('process', 'upstream_readiness_timeout')), timeoutMs),
      ),
    ]);
  } finally {
    lines.close();
    child.process.stdout.resume();
  }
}

async function waitForGatewayReady(child: ManagedChild, origin: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.hasExited()) throw new RuntimeFault('process', 'gateway_process_failed');
    try {
      const response = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) return;
      await response.body?.cancel();
    } catch {
      // Readiness polling is not a conformance attempt.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new RuntimeFault('process', 'gateway_readiness_timeout');
}

async function runProbe(
  command: string,
  args: readonly string[],
  environment: Environment,
  cwd: string,
  timeoutMs: number,
): Promise<
  z.infer<typeof ProbeSuccessSchema> | z.infer<typeof ProbeUnsupportedSchema> | z.infer<typeof ProbeRejectedSchema>
> {
  const child = startChild(command, args, environment, cwd);
  const chunks: Buffer[] = [];
  let bytes = 0;
  child.process.stdout?.on('data', (chunk: Buffer | string) => {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    bytes += buffer.byteLength;
    if (bytes <= 65_536) chunks.push(Buffer.from(buffer));
  });

  const completion = await Promise.race([
    child.exit,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  if (completion === null) {
    await stopChild(child, Math.min(timeoutMs, 1_000));
    throw new RuntimeFault('process', 'probe_timeout');
  }
  if (completion.spawnFailed) throw new RuntimeFault('process', 'probe_process_failed');
  if (completion.code !== 0 && bytes === 0) throw new RuntimeFault('process', 'probe_process_failed');
  if (bytes === 0 || bytes > 65_536) throw new RuntimeFault('fixture', 'probe_output_invalid');

  const output = Buffer.concat(chunks);
  let value: unknown;
  try {
    const lines = output
      .toString('utf8')
      .split(/\r?\n/u)
      .filter((line) => line.length > 0);
    if (lines.length !== 1) throw new Error('invalid');
    value = JSON.parse(lines[0]);
  } catch {
    output.fill(0);
    throw new RuntimeFault('fixture', 'probe_output_invalid');
  }
  output.fill(0);

  const rejected = ProbeRejectedSchema.safeParse(value);
  if (completion.code !== 0) {
    if (rejected.success) return rejected.data;
    throw new RuntimeFault('process', 'probe_process_failed');
  }
  if (rejected.success) throw new RuntimeFault('fixture', 'probe_output_invalid');

  const success = ProbeSuccessSchema.safeParse(value);
  if (success.success) return success.data;
  const unsupported = ProbeUnsupportedSchema.safeParse(value);
  if (unsupported.success) return unsupported.data;
  const peer = PeerProbeSchema.safeParse(value);
  if (peer.success) {
    if (!peer.data.ok) {
      const unsupportedOperation = peer.data.unsupported?.[0]?.operation;
      if (peer.data.classification !== 'unsupported-operation' || !unsupportedOperation) {
        throw new RuntimeFault('fixture', 'probe_output_invalid');
      }
      return {
        fixtureId: peer.data.fixtureId,
        transport: peer.data.transport,
        status: 'unsupported',
        unsupportedOperation,
        negotiatedRevision: peer.data.negotiatedRevision,
        operations: peer.data.operations,
      };
    }
    if (peer.data.classification || peer.data.unsupported?.length || !peer.data.initialized || !peer.data.ping) {
      throw new RuntimeFault('fixture', 'probe_output_invalid');
    }
    return {
      fixtureId: peer.data.fixtureId,
      transport: peer.data.transport,
      initialized: true,
      ping: true,
      negotiatedRevision: peer.data.negotiatedRevision,
      operations: peer.data.operations,
      toolsCount: peer.data.toolsCount,
      callError: peer.data.callError,
    };
  }
  throw new RuntimeFault('fixture', 'probe_output_invalid');
}

function validatesJsonRpcEnvelope(envelope: Record<string, unknown>): boolean {
  if (envelope.jsonrpc !== '2.0') return false;
  if (typeof envelope.method === 'string') return true;
  return Object.hasOwn(envelope, 'id') && (Object.hasOwn(envelope, 'result') || Object.hasOwn(envelope, 'error'));
}

function evidenceIsValid(evidence: SanitizedWireEvidenceFile): boolean {
  return (
    SanitizedWireEvidenceFileSchema.safeParse(evidence).success &&
    evidence.records.every((record) => record.schemaResult !== 'infrastructure_error')
  );
}

function transportConfig(
  type: z.infer<typeof UpstreamTransportTypeSchema>,
  peer: z.infer<typeof CommandSchema>,
  tappedEndpoint?: string,
): Record<string, unknown> {
  if (type === 'stdio') return { type, command: peer.command, args: peer.args };
  if (!tappedEndpoint) throw new RuntimeFault('harness', 'setup_failed');
  return { type, url: tappedEndpoint };
}

function tappedUrl(tapOrigin: string, endpoint: URL): string {
  return `${tapOrigin}${endpoint.pathname}${endpoint.search}`;
}

function normalizeFault(error: unknown): RuntimeFault {
  return error instanceof RuntimeFault ? error : new RuntimeFault('harness', 'setup_failed');
}

export async function executeMatrixAssignment(input: MatrixExecutionOptions): Promise<MatrixExecutionResult> {
  const parsed = MatrixExecutionOptionsSchema.safeParse(input);
  const assignmentId = parsed.success ? parsed.data.assignmentId : 'invalid-assignment';
  if (!parsed.success) return infrastructure(assignmentId, 'harness', 'input_invalid');
  const options = parsed.data;
  if (
    options.captureContexts.inbound.negotiatedRevision !== options.revisions.inbound ||
    options.captureContexts.upstream.negotiatedRevision !== options.revisions.upstream ||
    (options.upstreamTransport.type === 'stdio') !== (options.upstreamPeer.readiness.kind === 'runtime-owned')
  ) {
    return infrastructure(options.assignmentId, 'harness', 'input_invalid');
  }

  const cleanup: Array<() => Promise<void>> = [];
  let scratch: string | undefined;
  let outcome: MatrixExecutionResult | undefined;
  let cleanupFailed = false;
  try {
    scratch = await mkdtemp(join(tmpdir(), 'one-mcp-matrix-'));
    const home = join(scratch, 'home');
    const runtimeScope = join(scratch, 'runtime-scope');
    await Promise.all([mkdir(home), mkdir(runtimeScope)]);
    const environment = minimalEnvironment(home, runtimeScope);

    const inboundCapture = createSanitizedWireCapture({
      contexts: [options.captureContexts.inbound as TrustedWireContext],
      validateEnvelope: validatesJsonRpcEnvelope,
    });
    const upstreamCapture = createSanitizedWireCapture({
      contexts: [options.captureContexts.upstream as TrustedWireContext],
      validateEnvelope: validatesJsonRpcEnvelope,
    });

    let upstreamEndpoint: URL | undefined;
    if (options.upstreamPeer.readiness.kind === 'stdout-json') {
      const upstream = startChild(options.upstreamPeer.command, options.upstreamPeer.args, environment, runtimeScope);
      cleanup.push(() => stopChild(upstream, options.timeouts.shutdownMs));
      upstreamEndpoint = await waitForUpstreamReady(
        upstream,
        options.upstreamPeer.readiness.fixtureId,
        options.timeouts.startupMs,
      );
    }

    let configuredEndpoint: string | undefined;
    if (upstreamEndpoint) {
      const upstreamTap = await startHttpWireTap({
        target: upstreamEndpoint.href,
        capture: upstreamCapture,
        contextId: options.captureContexts.upstream.id,
        hop: 'upstream',
      });
      cleanup.push(upstreamTap.close);
      configuredEndpoint = tappedUrl(upstreamTap.url, upstreamEndpoint);
    }

    await writeFile(
      join(runtimeScope, 'mcp.json'),
      `${JSON.stringify({
        mcpServers: {
          conformance_peer: transportConfig(options.upstreamTransport.type, options.upstreamPeer, configuredEndpoint),
        },
      })}\n`,
      { mode: 0o600 },
    );

    const port = await reserveLoopbackPort();
    const gatewayOrigin = `http://127.0.0.1:${port}`;
    const gateway = startChild(
      process.execPath,
      [
        options.builtEntryPath,
        'serve',
        '--transport',
        'http',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--config-dir',
        runtimeScope,
        '--async-max-retries',
        '0',
        '--no-async-background-retry',
        ...(options.gatewayArgs ?? []),
      ],
      environment,
      runtimeScope,
    );
    gateway.process.stdout?.resume();
    cleanup.push(() => stopChild(gateway, options.timeouts.shutdownMs));
    await waitForGatewayReady(gateway, gatewayOrigin, options.timeouts.startupMs);

    const inboundTap = await startHttpWireTap({
      target: gatewayOrigin,
      capture: inboundCapture,
      contextId: options.captureContexts.inbound.id,
      hop: 'inbound',
    });
    cleanup.push(inboundTap.close);
    const probeEndpoint = `${inboundTap.url}/mcp`;
    const probeArgs = options.inboundProbe.args.map((argument) =>
      argument === '{{gatewayEndpoint}}' ? probeEndpoint : argument,
    );
    if (!options.inboundProbe.args.includes('{{gatewayEndpoint}}')) {
      throw new RuntimeFault('harness', 'input_invalid');
    }

    const probeFacts = await runProbe(
      options.inboundProbe.command,
      probeArgs,
      environment,
      runtimeScope,
      options.timeouts.probeMs,
    );
    if ('negotiatedRevision' in probeFacts && probeFacts.negotiatedRevision !== options.revisions.inbound) {
      throw new RuntimeFault('harness', 'wire_evidence_invalid');
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    const evidence = { inbound: inboundCapture.snapshot(), upstream: upstreamCapture.snapshot() };
    if (!evidenceIsValid(evidence.inbound) || !evidenceIsValid(evidence.upstream)) {
      throw new RuntimeFault('harness', 'wire_evidence_invalid');
    }

    if ('errorCode' in probeFacts) {
      outcome = {
        kind: 'product',
        status: 'fail',
        reason: 'gateway_rejected',
        assignmentId: options.assignmentId,
        firstAttempt: true,
        facts: probeFacts,
        evidence,
      };
    } else if ('status' in probeFacts) {
      outcome = {
        kind: 'product',
        status: 'fail',
        reason: 'unsupported_operation',
        assignmentId: options.assignmentId,
        firstAttempt: true,
        facts: probeFacts,
        evidence,
      };
    } else {
      if (evidence.inbound.records.length === 0 || evidence.upstream.records.length === 0) {
        throw new RuntimeFault('harness', 'wire_evidence_incomplete');
      }
      outcome = {
        kind: 'product',
        status: 'pass',
        reason: 'probe_succeeded',
        assignmentId: options.assignmentId,
        firstAttempt: true,
        facts: probeFacts,
        evidence,
      };
    }
  } catch (error) {
    const fault = normalizeFault(error);
    outcome = infrastructure(options.assignmentId, fault.defect, fault.reason);
  } finally {
    for (const close of cleanup.reverse()) {
      try {
        await close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (scratch) {
      try {
        await rm(scratch, { recursive: true, force: true });
      } catch {
        cleanupFailed = true;
      }
    }
  }

  if (cleanupFailed) return infrastructure(options.assignmentId, 'harness', 'cleanup_failed');
  return outcome ?? infrastructure(options.assignmentId, 'harness', 'setup_failed');
}
