import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import ts from 'typescript';

const directory = resolve(process.argv[2] ?? '.tmp/telemetry-performance');
const repetitions = Number(process.argv[3] ?? 3);
assert(Number.isInteger(repetitions) && repetitions >= 3);
const baseline = join(directory, 'baseline-build');
await mkdir(directory, { recursive: true });
// Exclusive target prevents overwriting another run or silently transforming twice.
await mkdir(baseline);
await cp(resolve('build'), baseline, { recursive: true });
await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
await writeFile(join(directory, 'package.json'), '{"type":"module"}');
const adapter = join(baseline, 'observability/tracing/otelAdapter.js');
const original = await readFile(adapter, 'utf8');
const syntax = ts.createSourceFile(adapter, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const edits = [];
for (const statement of syntax.statements) {
  if (!ts.isFunctionDeclaration(statement) || !statement.body || !statement.name) continue;
  const name = statement.name.text;
  let body;
  if (name === 'installTracingContext') body = '{}';
  if (name === 'withMcpTraceContext') body = '{ return operation(); }';
  if (name === 'captureTraceContext') body = '{ return (operation) => operation(); }';
  if (name === 'getActiveTraceCorrelation') body = '{ return undefined; }';
  if (name === 'getLiveTraceContext' || name === 'extractMcpParentContext') body = '{ return ROOT_CONTEXT; }';
  if (name === 'runWithOwnedTraceContext') body = '{ return operation(); }';
  if (name === 'injectTraceContext') {
    const existing = original.slice(statement.body.getStart(), statement.body.end);
    const start = existing.indexOf('if (params !== null');
    assert(start >= 0, 'Propagation adapter changed: review baseline transformation');
    // Keep descriptor-safe carrier removal and baggage/privacy sanitation identical.
    body = '{ const carrier = {}; ' + existing.slice(start);
  }
  if (body) edits.push({ name, start: statement.body.getStart(), end: statement.body.end, body });
}
assert([5, 8].includes(edits.length), 'Unexpected propagation adapter API');
let transformed = original;
for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
  transformed = transformed.slice(0, edit.start) + edit.body + transformed.slice(edit.end);
}
await writeFile(adapter, transformed);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const manifest = {
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  file: 'observability/tracing/otelAdapter.js',
  originalSha256: hash(original),
  transformedSha256: hash(transformed),
  transformations: edits.map(({ name, body }) => ({ name, body })),
  invariants:
    'Every other built file is copied unchanged. Security carrier sanitation and business handlers are preserved. Test-only artifact, never publish.',
};
await writeFile(join(directory, 'baseline-manifest.json'), JSON.stringify(manifest, null, 2));
const modes = {};
for (const mode of ['baseline', 'propagation', 'healthy', 'outage']) {
  const configDirectory = join(directory, mode);
  await mkdir(configDirectory);
  const configPath = join(configDirectory, 'mcp.json');
  await writeFile(
    configPath,
    JSON.stringify(
      {
        mcpServers: { fixture: { command: process.execPath, args: [resolve('test/telemetry/workload-backend.mjs')] } },
      },
      null,
      2,
    ),
  );
  modes[mode] = {
    command: [
      process.execPath,
      mode === 'baseline' ? join(baseline, 'index.js') : resolve('build/index.js'),
      'serve',
      '--transport',
      'http',
      '--host',
      '127.0.0.1',
      '--port',
      '14319',
      '--config',
      configPath,
      '--config-dir',
      configDirectory,
      '--no-enable-auth',
      '--no-enable-async-loading',
      '--log-level',
      'error',
    ],
    healthUrl: 'http://127.0.0.1:14319/health',
    mcpUrl: 'http://127.0.0.1:14319/mcp',
    env: {
      OTEL_TRACES_EXPORTER: 'none',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_LOGS_EXPORTER: 'none',
      OTEL_SDK_DISABLED: 'false',
    },
  };
}
await writeFile(
  join(directory, 'run.json'),
  JSON.stringify(
    {
      repetitions,
      baselineDescription: manifest,
      echoTool: 'fixture_1mcp_echo',
      errorTool: 'fixture_1mcp_error',
      modes,
    },
    null,
    2,
  ),
);
process.stdout.write(join(directory, 'run.json') + '\n');
