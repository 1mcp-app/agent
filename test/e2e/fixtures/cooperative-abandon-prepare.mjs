import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [buildRoot, scope] = process.argv.slice(2);
const { connectRuntimeControl } = await import(
  pathToFileURL(path.join(buildRoot, 'core/server/runtimeControl.js')).href
);
const client = await connectRuntimeControl(scope);
if (!client) throw new Error('Fixture owner is unavailable');
const operationId = randomUUID();
const status = await client.request('prepare-replacement', { digest: 'f'.repeat(64), timeoutMs: 300 }, operationId);
// Deliberately exit with no commit or cancellation: the supervisor must own timeout recovery.
process.send({ type: 'prepared', status }, () => process.exit(0));
