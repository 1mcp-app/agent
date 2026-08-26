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
if (args.filter((arg) => arg === '--requirements').length !== 1) fail('requirements must run once');
if (args.some((arg) => ['--expected-failures', '--scenario', '--suite', '--force'].includes(arg))) {
  fail('forbidden execution flag');
}

const revision = option('--requirements');
const outputDirectory = option('--output-dir');
const target = option(role === 'server' ? '--url' : '--command');
if (!revision || !outputDirectory || !target) fail('missing required option');
if (!basename(process.env.HOME ?? '').startsWith('home')) fail('HOME is not sanitized');
if (process.env.OFFICIAL_RUNNER_PARENT_SECRET) fail('parent environment leaked');

if (target.includes('hang')) {
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
}
if (target.includes('process-failure')) process.exit(7);
if (target.includes('missing-output')) process.exit(0);

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
const timestamp = '2026-08-27T00-00-00-000Z';

for (const [index, scenario] of scenarios.entries()) {
  const prefix = role === 'server' ? `server-${scenario}` : scenario;
  const scenarioDirectory = join(outputDirectory, `${prefix}-${timestamp}`);
  await mkdir(scenarioDirectory, { recursive: true });

  if (target.includes('malformed-output') && index === 0) {
    await writeFile(join(scenarioDirectory, 'checks.json'), '{');
    continue;
  }

  const checks = [
    {
      id: scenario.includes('json-schema') ? 'json-schema-2020-12-$schema' : 'official-check',
      name: 'must not escape',
      description: 'must not escape',
      status: 'SUCCESS',
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

  if (index === 0) {
    checks.push({
      id: 'official-check',
      status: role === 'client' ? 'WARNING' : 'SUCCESS',
      specReferences: [{ id: 'SEP-1234' }],
      errorMessage: 'must not escape',
    });
  }

  await writeFile(join(scenarioDirectory, 'checks.json'), JSON.stringify(checks));
  await writeFile(join(scenarioDirectory, 'stdout.txt'), 'secret stdout');
  await writeFile(join(scenarioDirectory, 'stderr.txt'), 'secret stderr');
}

process.exit(role === 'client' ? 1 : 0);
