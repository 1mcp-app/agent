import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [buildRoot, scope] = process.argv.slice(2);
const { claimRuntimeScope } = await import(
  pathToFileURL(path.join(buildRoot, 'core/server/runtimeScopeOwnership.js')).href
);
const { startRuntimeControl } = await import(pathToFileURL(path.join(buildRoot, 'core/server/runtimeControl.js')).href);
const ownership = claimRuntimeScope(scope, { kind: 'background-supervisor', cooperative: true });
const control = await startRuntimeControl(scope, ownership.record.claimId, (method) => {
  process.send?.({ type: 'operation', method });
  if (method !== 'describe') throw new Error('Unexpected lifecycle mutation');
  return {
    runtime: null,
    runtimeScopeId: 'incompatible-fixture',
    supervisorPid: process.pid,
    version: 'synthetic-no-provenance',
    digest: '0'.repeat(64),
    state: 'running',
  };
});
process.on('message', (message) => {
  if (message !== 'stop') return;
  void control.close().then(() => {
    ownership.release();
    process.disconnect();
  });
});
process.send?.({ type: 'ready', claimId: ownership.record.claimId });
