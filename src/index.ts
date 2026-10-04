#!/usr/bin/env node
import { bootstrapTracing } from './observability/tracing/bootstrap.js';

export { normalizeCliArgv, normalizedArgv } from './utils/cli/normalizedArgv.js';

bootstrapTracing();
// Runtime modules are evaluated only after propagation is installed. esbuild preserves this order in SEA.
void import('./cli.js').catch(() => {
  process.stderr.write('CLI bootstrap failed\n');
  process.exitCode = 1;
});
