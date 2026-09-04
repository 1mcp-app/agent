import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

export const SNAPSHOT_PATH = 'test/sdk-boundary/sdk-topology.snapshot.json';

const ROOT_PACKAGES = {
  '@modelcontextprotocol/client': { placement: 'dependencies' },
  '@modelcontextprotocol/conformance': { placement: 'devDependencies' },
  '@modelcontextprotocol/core': { placement: 'dependencies' },
  '@modelcontextprotocol/node': { placement: 'dependencies' },
  '@modelcontextprotocol/sdk': { placement: 'dependencies' },
  '@modelcontextprotocol/server': { placement: 'dependencies' },
  '@modelcontextprotocol/server-legacy': { placement: 'dependencies' },
  zod: { placement: 'dependencies' },
};

const TRACKED_PACKAGE_NAMES = Object.keys(ROOT_PACKAGES);
const ROOT_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];

function trackedPackageForKey(key) {
  return TRACKED_PACKAGE_NAMES.find((packageName) => key.startsWith(`${packageName}@`));
}

function packageVersion(key, packageName) {
  return key.slice(packageName.length + 1).split('(')[0];
}

function sortedObject(entries) {
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

function trackedEdges(dependencies = {}) {
  return sortedObject(
    Object.entries(dependencies).filter(([dependency]) => TRACKED_PACKAGE_NAMES.includes(dependency)),
  );
}

export async function buildSdkTopology(root) {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = parseYaml(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
  const importer = lock.importers?.['.'];
  if (!importer) throw new Error('pnpm-lock.yaml does not contain the root importer');

  const rootPackages = {};
  for (const [packageName, expected] of Object.entries(ROOT_PACKAGES)) {
    const manifestSpecifier = manifest[expected.placement]?.[packageName];
    const lockEntry = importer[expected.placement]?.[packageName];
    rootPackages[packageName] = {
      placement: expected.placement,
      manifestPlacements: ROOT_SECTIONS.filter((section) => Object.hasOwn(manifest[section] ?? {}, packageName)),
      lockPlacements: ROOT_SECTIONS.filter((section) => Object.hasOwn(importer[section] ?? {}, packageName)),
      manifestSpecifier: manifestSpecifier ?? null,
      lockSpecifier: lockEntry?.specifier ?? null,
      resolved: lockEntry?.version ?? null,
    };
  }

  const packages = [];
  for (const [key, value] of Object.entries(lock.packages ?? {})) {
    const packageName = trackedPackageForKey(key);
    if (!packageName) continue;
    packages.push([
      key,
      {
        package: packageName,
        version: packageVersion(key, packageName),
        integrity: value.resolution?.integrity ?? null,
      },
    ]);
  }

  const instances = [];
  for (const [key, value] of Object.entries(lock.snapshots ?? {})) {
    const packageName = trackedPackageForKey(key);
    if (!packageName) continue;
    instances.push([
      key,
      {
        package: packageName,
        version: packageVersion(key, packageName),
        dependencies: trackedEdges({ ...value.dependencies, ...value.optionalDependencies }),
      },
    ]);
  }

  return {
    schemaVersion: 1,
    lockfileVersion: String(lock.lockfileVersion),
    packageManager: manifest.packageManager,
    rootPackages: sortedObject(Object.entries(rootPackages)),
    packages: sortedObject(packages),
    instances: sortedObject(instances),
  };
}

export function topologyDifferences(expected, actual, currentPath = '$') {
  if (Object.is(expected, actual)) return [];
  if (typeof expected !== typeof actual || expected === null || actual === null) {
    return [{ path: currentPath, expected, actual }];
  }
  if (typeof expected !== 'object') return [{ path: currentPath, expected, actual }];

  const differences = [];
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of [...keys].sort()) {
    if (!(key in expected))
      differences.push({ path: `${currentPath}.${key}`, expected: '<absent>', actual: actual[key] });
    else if (!(key in actual))
      differences.push({ path: `${currentPath}.${key}`, expected: expected[key], actual: '<absent>' });
    else differences.push(...topologyDifferences(expected[key], actual[key], `${currentPath}.${key}`));
  }
  return differences;
}

export function formatTopologyDifferences(differences) {
  return differences
    .map(
      ({ path: differencePath, expected, actual }) =>
        `${differencePath}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    )
    .join('\n');
}
