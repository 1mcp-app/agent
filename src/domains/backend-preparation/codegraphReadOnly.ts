import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { codeGraphEnvironment } from './codegraphEnvironment.js';
import {
  type CodeGraphInstallation,
  resolveCodeGraphInstallation,
  VERIFIED_CODEGRAPH_VERSION,
} from './codegraphInstallation.js';
import { CodeGraphPreparationError, runCodeGraphNativeWork, runCodeGraphWorker } from './codegraphProcess.js';

const optionsSchema = z.object({
  executable: z.string().refine(path.isAbsolute, 'An absolute installed executable is required.'),
  checkoutPath: z.string().refine(path.isAbsolute, 'An absolute checkout path is required.'),
  expectedVersion: z.literal(VERIFIED_CODEGRAPH_VERSION).optional(),
});

const toolDefinitionSchema = z
  .object({ name: z.string(), inputSchema: z.record(z.string(), z.unknown()), description: z.string().optional() })
  .passthrough();

export type CodeGraphPreparationToolDefinition = z.infer<typeof toolDefinitionSchema>;

interface MetadataSnapshot {
  readonly controller: AbortController;
  readonly promise: Promise<CodeGraphPreparationToolDefinition[]>;
  waiters: number;
  settled: boolean;
}

const metadataSnapshots = new Map<string, MetadataSnapshot>();
let metadataEpoch = 0;
let metadataClosing: Promise<void> | undefined;

async function metadataIdentity(installation: CodeGraphInstallation, visibility: string): Promise<string> {
  const toolsPath = path.join(installation.libraryRoot, 'mcp', 'tools.js');
  const identities = await Promise.all(
    [installation.nodeExecutable, toolsPath, path.join(installation.libraryRoot, '..', 'package.json')].map(
      async (file) => {
        const resolved = await realpath(file);
        const stamp = await stat(resolved, { bigint: true });
        return [resolved, stamp.dev, stamp.ino, stamp.size, stamp.mtimeNs, stamp.ctimeNs].map(String);
      },
    ),
  );
  // This exact module defines native descriptors and getStaticTools visibility.
  // Cached schema authority never establishes checkout source freshness.
  const source = await readFile(toolsPath);
  return JSON.stringify([
    installation.libraryRoot,
    installation.version,
    visibility,
    identities,
    createHash('sha256').update(source).digest('hex'),
  ]);
}

function metadataWait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function snapshotFor(
  key: string,
  installation: CodeGraphInstallation,
  environment: Record<string, string | undefined>,
): MetadataSnapshot {
  const existing = metadataSnapshots.get(key);
  if (existing) {
    metadataSnapshots.delete(key);
    metadataSnapshots.set(key, existing);
    return existing;
  }
  // Reserve before awaiting the shared native gate. Bound cached schemas and
  // queued installations; never evict an in-flight owner's entry.
  if (metadataSnapshots.size >= 64) {
    for (const [cachedKey, snapshot] of metadataSnapshots) {
      if (!snapshot.settled) continue;
      metadataSnapshots.delete(cachedKey);
      break;
    }
  }
  if (metadataSnapshots.size >= 64)
    throw new CodeGraphPreparationError(
      'metadata_capacity',
      'Native metadata capacity reached; wait for owned lookups to finish.',
    );
  const controller = new AbortController();
  const snapshot: MetadataSnapshot = {
    controller,
    waiters: 0,
    settled: false,
    promise: runCodeGraphNativeWork(controller.signal, async () => {
      const result = await runCodeGraphWorker(installation, installation.libraryRoot, 'describe-tools', {
        signal: controller.signal,
        executionDeadlineMs: 5_000,
        environment,
      });
      if ((await metadataIdentity(installation, environment.CODEGRAPH_MCP_TOOLS ?? '')) !== key)
        throw new CodeGraphPreparationError(
          'installation_changed',
          'Installed CodeGraph schema bytes changed during lookup; explicitly retry against the current bundle.',
        );
      return z.object({ tools: z.array(toolDefinitionSchema) }).parse(result).tools;
    }).then(
      (tools) => {
        snapshot.settled = true;
        return tools;
      },
      (error) => {
        snapshot.settled = true;
        if (metadataSnapshots.get(key) === snapshot) metadataSnapshots.delete(key);
        throw error;
      },
    ),
  };
  metadataSnapshots.set(key, snapshot);
  return snapshot;
}

/** Cancel/drain only this module's owned metadata jobs on runtime shutdown.
 * A later runtime may obtain new snapshots after shutdown settles. */
export function disposeCodeGraphPreparationToolMetadata(): Promise<void> {
  if (metadataClosing) return metadataClosing;
  metadataEpoch += 1;
  const snapshots = [...metadataSnapshots.values()];
  metadataSnapshots.clear();
  for (const snapshot of snapshots) snapshot.controller.abort();
  metadataClosing = Promise.allSettled(snapshots.map((snapshot) => snapshot.promise)).then(() => {
    metadataClosing = undefined;
  });
  return metadataClosing;
}

/** Native tool schemas require no checkout. The host never imports the SDK;
 * metadata uses the same bounded, owned child lifecycle as other probes. */
export async function getCodeGraphPreparationToolDefinition(
  options: {
    executable: string;
    expectedVersion?: typeof VERIFIED_CODEGRAPH_VERSION;
    toolName: string;
    /** Effective CODEGRAPH_MCP_TOOLS from trusted configured backend env only. */
    toolVisibility?: string;
  },
  probe: { signal?: AbortSignal; executionDeadlineMs?: number } = {},
): Promise<CodeGraphPreparationToolDefinition | undefined> {
  const configuration = optionsSchema
    .omit({ checkoutPath: true })
    .extend({ toolName: z.string().min(1).max(256), toolVisibility: z.string().max(4096).optional() })
    .parse(options);
  const budget = z
    .number()
    .positive()
    .finite()
    .parse(probe.executionDeadlineMs ?? 2_000);
  const deadline = performance.now() + budget;
  const epoch = metadataEpoch;
  const caller = new AbortController();
  const abort = () => caller.abort(new CodeGraphPreparationError('cancelled', 'Native metadata caller cancelled.'));
  const expire = () =>
    caller.abort(
      new CodeGraphPreparationError('deadline_exceeded', 'CodeGraph native tool metadata exceeded its caller budget.'),
    );
  probe.signal?.addEventListener('abort', abort, { once: true });
  if (probe.signal?.aborted) abort();
  const timer = setTimeout(expire, budget);
  try {
    if (metadataClosing) throw new CodeGraphPreparationError('cancelled', 'Native metadata is shutting down.');
    // Revalidate installed/configured authority before every cached lookup.
    const installation = await metadataWait(resolveCodeGraphInstallation(configuration.executable), caller.signal);
    const environment = { ...codeGraphEnvironment() };
    if (configuration.toolVisibility !== undefined) environment.CODEGRAPH_MCP_TOOLS = configuration.toolVisibility;
    const key = await metadataWait(
      metadataIdentity(installation, environment.CODEGRAPH_MCP_TOOLS ?? ''),
      caller.signal,
    );
    if (metadataClosing || epoch !== metadataEpoch)
      throw new CodeGraphPreparationError('cancelled', 'Native metadata runtime owner shut down during resolution.');
    if (performance.now() >= deadline) expire();
    caller.signal.throwIfAborted();
    const snapshot = snapshotFor(key, installation, environment);
    snapshot.waiters += 1;
    try {
      const tools = await metadataWait(snapshot.promise, caller.signal);
      const tool = tools.find((definition) => definition.name === configuration.toolName);
      // Caller edits cannot alter another waiter's/cache consumer's authority.
      return tool ? structuredClone(tool) : undefined;
    } finally {
      snapshot.waiters -= 1;
      if (snapshot.waiters === 0 && !snapshot.settled) {
        snapshot.controller.abort();
        await snapshot.promise.catch(() => undefined); // Verify owned exit.
      }
    }
  } finally {
    clearTimeout(timer);
    probe.signal?.removeEventListener('abort', abort);
  }
}

/** Explicit first-party stdio launcher. execve replaces the CLI process image,
 * retaining the runtime supervisor's exact PID; it adds no MCP supervisor or
 * daemon and never silently changes an existing configured command.
 */
export async function runCodeGraphReadOnlyServer(options: z.input<typeof optionsSchema>): Promise<void> {
  const configuration = optionsSchema.parse(options);
  if (process.platform !== 'darwin' || !process.execve)
    throw new Error('CodeGraph read-only launcher requires verified Darwin process.execve support.');
  const root = await realpath(configuration.checkoutPath);
  const installation = await resolveCodeGraphInstallation(configuration.executable);
  const environment = codeGraphEnvironment();
  environment.CODEGRAPH_NO_UPDATE_CHECK = '1';
  const strings = Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  process.execve(
    installation.nodeExecutable,
    [
      installation.nodeExecutable,
      '--liftoff-only',
      '--disable-warning=ExperimentalWarning',
      '-e',
      CODEGRAPH_READ_ONLY_SOURCE,
      installation.libraryRoot,
      root,
    ],
    strings,
  );
}

export const CODEGRAPH_READ_ONLY_SOURCE = String.raw`
const fs = require('node:fs'), path = require('node:path');
const [libraryRoot, root] = process.argv.slice(1);
if (require(path.join(libraryRoot, '..', 'package.json')).version !== '1.6.2') throw new Error('Only verified CodeGraph1.6.2 read-only serving is supported.');
const sdk = require(path.join(libraryRoot, 'index.js'));
const directory = require(path.join(libraryRoot, 'directory.js'));
function exactDatabase() {
  const index = path.join(root, '.codegraph');
  if (fs.existsSync(index) && fs.lstatSync(index).isSymbolicLink()) throw new Error('Symlinked CodeGraph index is unsupported.');
  const file = path.join(index, 'codegraph.db');
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Symlinked CodeGraph database is unsupported.');
  return file;
}
function openReadOnly(project) {
  if (fs.realpathSync(project) !== root) throw new Error('Read-only CodeGraph serving is confined to its configured checkout.');
  const database = sdk.DatabaseConnection.open(exactDatabase(), { readOnly: true });
  const graph = new sdk.CodeGraph(database, new sdk.QueryBuilder(database.getDb()), root);
  if (graph.getIndexState() !== 'complete' || graph.isIndexStale()) {
    graph.close(); throw new Error('Configured CodeGraph index is incomplete or incompatible; explicitly prepare/recover it.');
  }
  return graph;
}
// The facade's nominal readOnly open also repairs .gitignore. Route the pinned
// engine through published read-only storage instead, only in this process.
sdk.CodeGraph.openSync = openReadOnly;
sdk.CodeGraph.open = async project => openReadOnly(project);
directory.resolveServerRoot = () => ({ root: fs.existsSync(exactDatabase()) ? root : null, candidates: [], viaSubScan: false });
const { MCPEngine } = require(path.join(libraryRoot, 'mcp/engine.js'));
const { MCPSession } = require(path.join(libraryRoot, 'mcp/session.js'));
const { StdioTransport } = require(path.join(libraryRoot, 'mcp/transport.js'));
const engine = new MCPEngine({ readOnly: true, watch: false, queryPool: false });
engine.setProjectPathHint(root);
// First-party availability policy: native1.6.2 always advertises its tools even
// without an index. This explicit wrapper exposes none until its exact target
// opens compatibly. Freshness admission remains the runtime adapter's job.
const handler = engine.getToolHandler();
const nativeTools = handler.getTools.bind(handler);
handler.getTools = () => engine.hasDefaultCodeGraph() ? nativeTools() : [];
let stopping;
let session;
function stop() {
  if (stopping) return stopping;
  if (session) session.stop();
  stopping = engine.stop().then(() => process.exit(0));
  return stopping;
}
const transport = new StdioTransport({ exitOnClose: false, onClose: () => { void stop(); } });
session = new MCPSession(transport, engine, { explicitProjectPath: root });
const nativeCall = session.handleToolsCall.bind(session);
session.handleToolsCall = async request => {
  const supplied = request.params && request.params.arguments && request.params.arguments.projectPath;
  if (supplied !== undefined && (typeof supplied !== 'string' || !path.isAbsolute(supplied) || path.resolve(supplied) !== root)) {
    // Check the lexical canonical target before retry initialization or native
    // dispatch. Do not stat/realpath an untrusted different checkout.
    transport.sendResult(request.id, { isError: true, content: [{ type: 'text', text: 'projectPath must equal this server\'s canonical configured checkout, or be omitted.' }] });
    return;
  }
  await session.retryInitIfNeeded();
  if (!engine.hasDefaultCodeGraph()) {
    transport.sendResult(request.id, { isError: true, content: [{ type: 'text', text: 'Configured checkout is unprepared. Use the independent runtime preparation control, then refresh the tool catalog.' }] });
    return;
  }
  return nativeCall(request);
};
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
process.stdin.on('error', () => { void stop(); });
session.start();
`;
