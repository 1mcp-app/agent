/** Executed only by the configured, already-installed CodeGraph bundle's Node.
 * Keeping the SDK in this short-lived child isolates native extraction and makes
 * cancellation awaitable without supervising the runtime's MCP transport.
 */
export const CODEGRAPH_WORKER_SOURCE = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const [libraryRoot, root, action, claimId] = process.argv.slice(1);
if (require(path.join(libraryRoot, '..', 'package.json')).version !== '1.6.2') {
  process.stdout.write('1MCP_CODEGRAPH_RESULT ' + JSON.stringify({ error: { code: 'unsupported_version', message: 'Installed CodeGraph bundle changed; only verified 1.6.2 is supported.' } }) + '\n');
  process.exit(1);
}
// Static native schemas deliberately stay before the heavy SDK/open/ownership
// paths. Native base descriptors preserve configured-default projectPath
// semantics: ToolHandler(null).getTools() instead requires projectPath and
// filters visibility for a no-default server. The runtime owns tool grants;
// native visibility still filters these schemas. This mode cannot open a
// checkout, start a watcher, or widen any tool grant.
if (action === 'describe-tools') {
  try {
    const { tools, getStaticTools } = require(path.join(libraryRoot, 'mcp/tools.js'));
    const visible = new Set(getStaticTools().map(tool => tool.name));
    process.stdout.write('1MCP_CODEGRAPH_RESULT ' + JSON.stringify({ tools: tools.filter(tool => visible.has(tool.name)) }) + '\n');
    process.exit(0);
  } catch (error) {
    process.stdout.write('1MCP_CODEGRAPH_RESULT ' + JSON.stringify({ error: { code: 'backend_failed', message: error.message || String(error) } }) + '\n');
    process.exit(1);
  }
}
const sdk = require(path.join(libraryRoot, 'index.js'));
const directory = require(path.join(libraryRoot, 'directory.js'));
const locks = require(path.join(libraryRoot, 'mcp/writer-lock.js'));
const extraction = require(path.join(libraryRoot, 'extraction/extraction-version.js'));
const utils = require(path.join(libraryRoot, 'utils.js'));
let ownershipFailure;
// The pinned SDK's default acquire reclaims malformed/dead lock files. Override
// acquisition only in this isolated child: EEXIST always means conflict, with
// the same native PID format and ownership-checked release implementation.
utils.FileLock.prototype.acquire = function () {
  try { fs.writeFileSync(this.lockPath, String(process.pid), { flag: 'wx' }); this.held = true; }
  catch (cause) {
    if (cause.code !== 'EEXIST') throw cause;
    const error = new Error('Native CodeGraph database ownership is occupied; foreign locks are never reclaimed.');
    error.code = 'ownership_conflict'; ownershipFailure = error; throw error;
  }
};
const controller = new AbortController();
let graph;
const held = [];
const report = (value) => process.stdout.write('1MCP_CODEGRAPH_RESULT ' + JSON.stringify(value) + '\n');
process.on('SIGTERM', () => controller.abort());
process.on('SIGINT', () => controller.abort());

function assertUnlocked() {
  const dir = sdk.getCodeGraphDir(root);
  for (const name of ['rebuild.pid', 'writer.pid', 'codegraph.lock']) {
    if (fs.existsSync(path.join(dir, name))) {
      if (action === 'inspect' && name === 'writer.pid') {
        try {
          const owner = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
          if (Number.isInteger(owner.pid) && owner.pid > 0 && owner.ready === true) {
            try { process.kill(owner.pid, 0); continue; }
            catch (error) { if (error.code === 'EPERM') continue; }
          }
        } catch { /* Unknown ownership remains a conflict. */ }
      }
      const error = new Error('CodeGraph ownership exists at ' + path.join(dir, name) + '; reconcile the owning process before preparing.');
      error.code = 'ownership_conflict';
      throw error;
    }
  }
}

function snapshot() {
  // Cold-only scope audit uses the backend's exact configured candidate list.
  // An unreadable file is not silently treated as current. Source symlinks are
  // unsupported because their external target may escape the journal's scope.
  const scanner = require(path.join(libraryRoot, 'extraction/index.js'));
  const scope = scanner.buildScopeIgnore(root);
  function auditDirectories(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const rel = relative + entry.name;
      const scoped = entry.isDirectory() ? rel + '/' : rel;
      if (scope.ignores(scoped)) continue;
      if (entry.isSymbolicLink()) throw new Error('In-scope source symlink is unsupported for native journal readiness: ' + rel);
      if (entry.isDirectory()) auditDirectories(path.join(directory, entry.name), rel + '/');
    }
  }
  auditDirectories(root);
  const candidates = scanner.scanDirectory(root);
  for (const candidate of candidates) {
    const absolute = path.resolve(root, candidate);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Native source candidate escaped the checkout.');
    let current = root;
    for (const component of relative.split(path.sep)) {
      current = path.join(current, component);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Source symlink scope is unsupported for native journal readiness: ' + relative);
    }
    require(path.join(libraryRoot, 'file-limits.js')).readBoundedSourceSync(absolute); // Prove readability without unbounded allocations.
  }
  // Cold validation must cover every native candidate even if Git's dirty
  // fast path declines to name an ignored or scope-changed file. Force the
  // pinned native fallback only in this read-only child, without DB mutation.
  const getMetadata = graph.queries.getMetadata.bind(graph.queries);
  graph.queries.getMetadata = key => key === scanner.INDEXED_AT_COMMIT_KEY ? null : getMetadata(key);
  const changes = graph.getChangedFiles();
  const build = graph.getIndexBuildInfo();
  return {
    initialized: true, projectPath: root, indexPath: sdk.getCodeGraphDir(root),
    fileCount: graph.getStats().fileCount,
    pendingChanges: { added: changes.added.length, modified: changes.modified.length, removed: changes.removed.length },
    index: { builtWithVersion: build.version, builtWithExtractionVersion: build.extractionVersion,
      currentExtractionVersion: extraction.EXTRACTION_VERSION, reindexRecommended: graph.isIndexStale(),
      state: graph.getIndexState(), pendingRefs: graph.getPendingReferenceCount() },
  };
}

(async () => {
  try {
    assertUnlocked();
    const dbPath = sdk.getDatabasePath(root);
    if (action === 'inspect') {
      // Exact root only: never resolve the nearest ancestor's index. A malformed
      // existing DB is incompatible, rather than an invitation to overwrite it.
      if (!fs.existsSync(dbPath)) {
        report({ initialized: false, projectPath: root, indexPath: sdk.getCodeGraphDir(root) });
        return;
      }
      // open(readOnly) through the facade validates/repairs .gitignore. The
      // published storage API avoids that mutation and schema repair entirely.
      const db = sdk.DatabaseConnection.open(dbPath, { readOnly: true });
      graph = new sdk.CodeGraph(db, new sdk.QueryBuilder(db.getDb()), root);
      report(snapshot());
      return;
    }
    const unsafe = directory.unsafeIndexRootReason(root);
    if (unsafe) throw new Error('Refusing CodeGraph preparation for unsafe root: ' + unsafe);
    // The native writer protocol also excludes a concurrent MCP writer/rebuild.
    // We do not reclaim ANY pre-existing lock, including malformed/dead owners.
    for (const name of ['rebuild.pid', 'writer.pid']) {
      const pidPath = locks.getWriterPidPath(root, name);
      fs.mkdirSync(path.dirname(pidPath), { recursive: true });
      // Use the backend's documented O_EXCL protocol, without its dead/malformed
      // holder reclamation. A racer cannot cause us to delete a foreign lock.
      try {
        const fd = fs.openSync(pidPath, 'wx', 0o600);
        held.push(name);
        try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, mode: '1mcp-preparation', startedAt: Date.now(), ready: false, claimId }) + '\n'); }
        finally { fs.closeSync(fd); }
      } catch (cause) {
        const error = new Error('CodeGraph native writer ownership could not be established: ' + cause.message);
        error.code = 'ownership_conflict';
        throw error;
      }
    }
    if (controller.signal.aborted) throw new Error('Preparation cancelled before indexing.');
    let result;
    if (action === 'initialize') {
      if (fs.existsSync(dbPath)) throw new Error('Initialization requires an absent database; existing or interrupted state requires explicit recovery.');
      graph = await sdk.CodeGraph.init(root, { index: false });
      result = await graph.indexAll({ signal: controller.signal });
    } else if (action === 'sync') {
      graph = await sdk.CodeGraph.open(root);
      if (graph.getIndexState() !== 'complete' || graph.isIndexStale()) {
        throw new Error('Incremental synchronization requires a complete compatible index; explicit rebuild permission is needed.');
      }
      result = await graph.sync({ signal: controller.signal });
    } else {
      throw new Error('Unsupported CodeGraph preparation action: ' + action);
    }
    if (ownershipFailure) throw ownershipFailure;
    if (controller.signal.aborted) throw new Error('Preparation cancelled.');
    if (result && result.success === false) throw new Error('CodeGraph preparation did not complete: ' + JSON.stringify(result.errors || []));
    report({ prepared: true });
  } catch (error) {
    report({ error: { code: error.code || 'backend_failed', message: error.message || String(error) } });
    process.exitCode = 1;
  } finally {
    try { if (graph) graph.destroy(); } finally {
      for (const name of held.reverse()) locks.releaseWriterLock(root, name);
    }
  }
})().then(() => process.exit(process.exitCode || 0));
`;
