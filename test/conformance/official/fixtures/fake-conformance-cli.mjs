#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const role = args[0];

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function fail(message) {
  process.stderr.write(message);
  process.exit(2);
}

if (role !== 'client' && role !== 'server') fail('invalid role');
if (args.filter((arg) => arg === '--scenario').length !== 1) fail('scenario must run once');
if (args.filter((arg) => arg === '--spec-version').length !== 1) fail('spec version must be explicit');
if (args.filter((arg) => arg === '--force').length !== 1) fail('frozen scenarios must be forced once');
if (args.some((arg) => ['--expected-failures', '--requirements', '--suite'].includes(arg))) {
  fail('forbidden execution flag');
}

const revision = option('--spec-version');
const selectedScenario = option('--scenario');
const outputDirectory = option('--output-dir');
const target = option(role === 'server' ? '--url' : '--command');
if (!revision || !selectedScenario || !outputDirectory || !target) fail('missing required option');
if (!basename(process.env.HOME ?? '').startsWith('home')) fail('HOME is not sanitized');
if (process.env.OFFICIAL_RUNNER_PARENT_SECRET) fail('parent environment leaked');

if (target.includes('hang')) {
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
}
const requirementText = await readFile(
  join(dirname(dirname(fileURLToPath(import.meta.url))), 'requirements', `${revision}.yaml`),
  'utf8',
);

function scenariosForRole(text, selectedRole) {
  const lines = text.split(/\r?\n/);
  const scenarios = [];
  let section;
  let notScoredScenario;

  for (const line of lines) {
    const topLevel = line.match(/^([a-z_]+):\s*$/);
    if (topLevel) {
      section = topLevel[1];
      notScoredScenario = undefined;
      continue;
    }

    if (section === selectedRole) {
      const item = line.match(/^ {2}- ([A-Za-z0-9_./-]+)\s*$/);
      if (item) scenarios.push(item[1]);
      continue;
    }

    if (section === 'not_scored') {
      const scenario = line.match(/^ {2}- scenario: ([A-Za-z0-9_./-]+)\s*$/);
      if (scenario) {
        notScoredScenario = scenario[1];
        continue;
      }
      const leg = line.match(/^ {4}leg: (client|server)\s*$/);
      if (leg?.[1] === selectedRole && notScoredScenario) scenarios.push(notScoredScenario);
    }
  }

  return scenarios;
}

const scenarios = scenariosForRole(requirementText, role);
const scenarioIndex = scenarios.indexOf(selectedScenario);
if (scenarioIndex < 0) fail('scenario outside frozen inventory');
const targetErrorScenario = target.includes('tools-call-error')
  ? 'tools-call-error'
  : target.includes('tasks-capability-negotiation')
    ? 'tasks-capability-negotiation'
    : undefined;
if (target.includes('target-error-no-output') && selectedScenario === targetErrorScenario) {
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  await response.body?.cancel();
  process.exit(7);
}
if (target.includes('nonzero-no-output') && scenarioIndex === 0) process.exit(7);
if ((target.includes('missing-output') || target.includes('zero-no-output')) && scenarioIndex === 0) process.exit(0);
const timestamp = '2026-08-27T00-00-00-000Z';
const prefix = role === 'server' ? `server-${selectedScenario}` : selectedScenario;
const scenarioDirectory = join(outputDirectory, `${prefix}-${timestamp}`);
await mkdir(scenarioDirectory, { recursive: true });

if (target.includes('malformed-output') && scenarioIndex === 0) {
  await writeFile(join(scenarioDirectory, 'checks.json'), '{');
  process.exit(0);
}

const checks = [
  {
    id: selectedScenario.includes('json-schema') ? 'json-schema-2020-12-$schema' : 'official-check',
    name: 'must not escape',
    description: 'must not escape',
    status: target.includes('continue-after-nonzero') && scenarioIndex === 0 ? 'FAILURE' : 'SUCCESS',
    timestamp: 'must not escape',
    errorMessage: 'OFFICIAL_RUNNER_PARENT_SECRET',
    details: { token: 'secret-token', path: '/Users/private/config.json' },
    specReferences: [{ id: 'MCP-Lifecycle', url: 'https://secret.invalid/path' }],
  },
  {
    id: 'informational-check',
    status: 'INFO',
    details: { rawArguments: ['secret'] },
  },
];

if (scenarioIndex === 0) {
  checks.push({
    id: 'official-check',
    status: role === 'client' && !target.includes('downstream-rejected') ? 'WARNING' : 'SUCCESS',
    specReferences: [{ id: 'SEP-1234' }],
    errorMessage: 'must not escape',
  });
}

await writeFile(join(scenarioDirectory, 'checks.json'), JSON.stringify(checks));
await writeFile(join(scenarioDirectory, 'stdout.txt'), 'secret stdout');
await writeFile(join(scenarioDirectory, 'stderr.txt'), 'secret stderr');

process.exit(
  (role === 'client' && scenarioIndex === 0) || (target.includes('continue-after-nonzero') && scenarioIndex === 0)
    ? 1
    : 0,
);
