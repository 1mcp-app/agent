// External installed-backend bridge. No source scans, syncing, migration or daemon.
import { access } from 'node:fs/promises';
import path from 'node:path';

import { createRequire } from 'node:module';

const [library, mode, checkout, symbol] = process.argv.slice(2);
const sdk = createRequire(import.meta.url)(path.join(library, 'index.js'));
try {
  await access(sdk.getDatabasePath(checkout));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  if (mode !== 'status') throw new Error('Checkout index missing');
  console.log(JSON.stringify({ initialized: false }));
  process.exit(0);
}
const graph = await sdk.default.open(checkout, { readOnly: true });
try {
  if (mode === 'status') {
    console.log(JSON.stringify({ initialized: true, state: graph.getIndexState(), stale: graph.isIndexStale() }));
  } else if (mode === 'query') {
    console.log(JSON.stringify(graph.searchNodes(symbol, { limit: 10 })));
  } else {
    throw new Error('Unknown read-only operation');
  }
} finally {
  graph.destroy();
}
