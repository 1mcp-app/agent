import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseToml } from 'smol-toml';

export const ACCEPTED_NPM_PINS = [
  {
    name: '@modelcontextprotocol/conformance',
    version: '0.2.0-alpha.11',
    integrity: 'sha512-imPK9tx5gQsL6ZKQq4MrsyDYfSaIwpRmX6+ogjbeAXs9LGvxkBxWcY7KcS7TvwaBk/ZiVWl6b/naF4q83UwDRA==',
  },
  {
    name: '@modelcontextprotocol/client',
    version: '2.0.0',
    integrity: 'sha512-8f1OghQ2rjzIOfqgUCP+8GiUWqRs89njoWLNqAe8kWmDePv3s1fZXseej+QXemssEuuOvLLmLO/kqM3IQHtISw==',
  },
  {
    name: '@modelcontextprotocol/core',
    version: '2.0.0',
    integrity: 'sha512-pJCEwGG7Lfr/+PQp9ZTwKXNeO5wzbfKL7H3MYpCorM4oFBoQrdjnBgEoqG+RjhsvS1FKrDbKux+M1HhlnGWqcA==',
  },
  {
    name: '@modelcontextprotocol/server',
    version: '2.0.0',
    integrity: 'sha512-YhHWdHfpFMQfd0prsEnxKeS3Qz3ytIGmsS0sth4KDjnacIT7hxk6hXHkJ9KysxlkvTM+WZAtQbbcUhdoP4Hvtw==',
  },
  {
    name: '@modelcontextprotocol/server-legacy',
    version: '2.0.0',
    integrity: 'sha512-LnffC1BSqFMHtMQxEz92lqDpHWma+ErV3ghdHDgdkCyYzVcCYKcUT5loq4kflty+Bf9C9qjJqbnphyBWyCqo8Q==',
  },
  {
    name: '@modelcontextprotocol/node',
    version: '2.0.0',
    integrity: 'sha512-Y4hAC2XdGDUdDOCbLDOCA4+aL3NUldjsOWlDL/YwpAxrPhRm1xHd7lZ+mLacvZ9t3PaH28wgNoaLQGrIk1P2pg==',
  },
  {
    name: '@modelcontextprotocol/sdk',
    version: '1.30.0',
    integrity: 'sha512-xKd8OIzlqNzcqcNumGAa6g+PW2kjD5vrpcKOnfldAUPP3j7lnqMPwlTXQm8gF+UwH72z0lqaRbjr9hqGz0eITA==',
  },
] as const;

export const FROZEN_REQUIREMENT_DIGESTS = {
  '2025-11-25': 'sha256:f33a304dfa2cbd999c24026a3453a64f377bba0c8aa80addadaf05862d212371',
  '2026-07-28': 'sha256:ae2f4f6210fd729e2e318edd5bbfa31a43cee0bc608e48052fa26dbf1d939b57',
} as const;

const GO_MODULE = {
  name: 'github.com/modelcontextprotocol/go-sdk',
  version: 'v1.7.0',
  sum: 'h1:yqjY2dsbKAC0LSuWZVBMrHgiG8ukXv6NRo0JiALay44=',
} as const;
const PYTHON_PACKAGE = {
  name: 'mcp',
  version: '2.0.0',
  wheelHash: 'sha256:1cb4c75d2d2c7b8c1d756355e5d82a39f2822cc7f13e22a2051d7ca3592349d6',
} as const;

export interface PathDigest {
  kind: 'file' | 'directory';
  digest: `sha256:${string}`;
  fileCount: number;
}

type RequirementRevision = keyof typeof FROZEN_REQUIREMENT_DIGESTS;

export interface ConformanceIntegrityOptions {
  sourceRoot: string;
  expectedSourceSha: string;
  artifacts: readonly { id: string; path: string; expectedDigest: `sha256:${string}` }[];
  npm: {
    packageManifestPath: string;
    pnpmLockPath: string;
    parseYaml: (source: string) => unknown;
    installedPackages: Readonly<Record<string, string>>;
    manifestSpecifiers?: Readonly<Record<string, string>>;
  };
  requirements: Readonly<Record<RequirementRevision, string>>;
  go: { goModPath: string; goSumPath: string; vendorPath: string };
  python: { pyprojectPath: string; uvLockPath: string };
}

export type IntegrityIssueCode =
  | 'source-head-unavailable'
  | 'source-sha-mismatch'
  | 'source-dirty-tracked'
  | 'source-dirty-untracked'
  | 'artifact-unreadable'
  | 'artifact-id-duplicate'
  | 'artifact-id-invalid'
  | 'artifact-digest-mismatch'
  | 'npm-manifest-invalid'
  | 'npm-manifest-version-mismatch'
  | 'npm-installed-package-mismatch'
  | 'pnpm-lock-invalid'
  | 'pnpm-lock-version-mismatch'
  | 'pnpm-lock-integrity-mismatch'
  | 'requirement-digest-mismatch'
  | 'go-module-version-mismatch'
  | 'go-module-sum-mismatch'
  | 'go-vendor-version-mismatch'
  | 'python-version-mismatch'
  | 'python-wheel-hash-mismatch';

export interface IntegrityIssue {
  code: IntegrityIssueCode;
  subject: string;
}

export interface IntegrityReport {
  schemaVersion: 1;
  ok: boolean;
  source: { sha: string | null; clean: boolean };
  artifacts: readonly ({ id: string } & PathDigest)[];
  npm: {
    packageManifestDigest: string | null;
    pnpmLockDigest: string | null;
    packages: readonly { name: string; version: string; integrity: string; manifestDigest: `sha256:${string}` }[];
  };
  requirements: readonly { revision: RequirementRevision; digest: `sha256:${string}` }[];
  go: {
    version: string;
    sum: string;
    goModDigest: string | null;
    goSumDigest: string | null;
    vendorDigest: string | null;
  };
  python: { version: string; wheelHash: string; pyprojectDigest: string | null; lockDigest: string | null };
  issues: readonly IntegrityIssue[];
  digest: `sha256:${string}`;
}

function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function listFiles(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listFiles(root, absolute);
    }
    if (!entry.isFile()) {
      throw new Error('unsupported-file-type');
    }
    return [path.relative(root, absolute).split(path.sep).join('/')];
  });
}

export function hashConformancePath(inputPath: string): PathDigest {
  try {
    const stat = lstatSync(inputPath);
    if (stat.isFile()) {
      return { kind: 'file', digest: sha256(readFileSync(inputPath)), fileCount: 1 };
    }
    if (!stat.isDirectory()) {
      throw new Error('unsupported-file-type');
    }

    const files = listFiles(inputPath).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const hash = createHash('sha256');
    for (const relative of files) {
      const digest = sha256(readFileSync(path.join(inputPath, relative))).slice('sha256:'.length);
      hash.update(`${Buffer.byteLength(relative)}:${relative}\0${digest}\n`);
    }
    return { kind: 'directory', digest: `sha256:${hash.digest('hex')}`, fileCount: files.length };
  } catch (error) {
    if (error instanceof Error && error.message === 'unsupported-file-type') throw error;
    throw new Error('artifact-unreadable');
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function reportDigest(value: unknown): `sha256:${string}` {
  return sha256(`${JSON.stringify(canonicalize(value))}\n`);
}

function readJson(inputPath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(inputPath, 'utf8'));
  const record = asRecord(parsed);
  if (!record) throw new Error('invalid-json-object');
  return record;
}

function dependencyVersion(manifest: Record<string, unknown>, name: string): unknown {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const dependencies = asRecord(manifest[field]);
    if (dependencies && name in dependencies) return dependencies[name];
  }
  return undefined;
}

function lockImporterEntry(lock: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  const rootImporter = asRecord(asRecord(lock.importers)?.['.']);
  if (!rootImporter) return undefined;
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const entry = asRecord(asRecord(rootImporter[field])?.[name]);
    if (entry) return entry;
  }
  return undefined;
}

function digestFile(inputPath: string): `sha256:${string}` {
  return sha256(readFileSync(inputPath));
}

function hasTokenPair(source: string, first: string, second: string): boolean {
  return source.split('\n').some((line) => {
    const tokens = line.split('//', 1)[0].trim().split(/\s+/u);
    return tokens.some((token, index) => token === first && tokens[index + 1] === second);
  });
}

function readGitState(root: string): { sha: string; trackedDirty: boolean; untrackedDirty: boolean } {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  });
  const lines = status.split('\n').filter(Boolean);
  return {
    sha,
    trackedDirty: lines.some((line) => !line.startsWith('??')),
    untrackedDirty: lines.some((line) => line.startsWith('??')),
  };
}

export function verifyConformanceIntegrity(options: ConformanceIntegrityOptions): IntegrityReport {
  const issues: IntegrityIssue[] = [];
  const addIssue = (code: IntegrityIssueCode, subject: string): void => {
    issues.push({ code, subject });
  };

  let sourceSha: string | null = null;
  let sourceClean = false;
  try {
    const state = readGitState(options.sourceRoot);
    sourceSha = state.sha;
    if (state.sha !== options.expectedSourceSha) addIssue('source-sha-mismatch', 'source');
    if (state.trackedDirty) addIssue('source-dirty-tracked', 'source');
    if (state.untrackedDirty) addIssue('source-dirty-untracked', 'source');
    sourceClean = !state.trackedDirty && !state.untrackedDirty;
  } catch {
    addIssue('source-head-unavailable', 'source');
  }

  const artifacts: ({ id: string } & PathDigest)[] = [];
  const seenArtifactIds = new Set<string>();
  for (const artifact of [...options.artifacts].sort((left, right) =>
    Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)),
  )) {
    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(artifact.id)) {
      addIssue('artifact-id-invalid', 'artifact');
      continue;
    }
    if (seenArtifactIds.has(artifact.id)) {
      addIssue('artifact-id-duplicate', artifact.id);
      continue;
    }
    seenArtifactIds.add(artifact.id);
    try {
      const actual = hashConformancePath(artifact.path);
      artifacts.push({ id: artifact.id, ...actual });
      if (actual.digest !== artifact.expectedDigest) addIssue('artifact-digest-mismatch', artifact.id);
    } catch {
      addIssue('artifact-unreadable', artifact.id);
    }
  }

  let packageManifestDigest: string | null = null;
  let manifest: Record<string, unknown> | undefined;
  try {
    manifest = readJson(options.npm.packageManifestPath);
    packageManifestDigest = digestFile(options.npm.packageManifestPath);
  } catch {
    addIssue('npm-manifest-invalid', 'root-manifest');
  }

  let pnpmLockDigest: string | null = null;
  let lock: Record<string, unknown> | undefined;
  try {
    const lockBytes = readFileSync(options.npm.pnpmLockPath, 'utf8');
    pnpmLockDigest = digestFile(options.npm.pnpmLockPath);
    lock = asRecord(options.npm.parseYaml(lockBytes));
    if (!lock) throw new Error('invalid-lock-object');
  } catch {
    addIssue('pnpm-lock-invalid', 'pnpm-lock');
  }

  const npmPackages = ACCEPTED_NPM_PINS.map((pin) => {
    const expectedSpecifier = options.npm.manifestSpecifiers?.[pin.name] ?? pin.version;
    if (dependencyVersion(manifest ?? {}, pin.name) !== expectedSpecifier) {
      addIssue('npm-manifest-version-mismatch', pin.name);
    }

    let installedManifestDigest: `sha256:${string}` = sha256('unavailable');
    try {
      const installedPath = options.npm.installedPackages[pin.name];
      if (!installedPath) throw new Error('missing-installed-path');
      const installed = readJson(installedPath);
      installedManifestDigest = digestFile(installedPath);
      if (installed.name !== pin.name || installed.version !== pin.version) {
        addIssue('npm-installed-package-mismatch', pin.name);
      }
    } catch {
      addIssue('npm-installed-package-mismatch', pin.name);
    }

    const importer = lockImporterEntry(lock ?? {}, pin.name);
    const importerVersion = importer?.version;
    const installedLockVersionMatches =
      importerVersion === pin.version ||
      (typeof importerVersion === 'string' && importerVersion.startsWith(`${pin.version}(`));
    if (importer?.specifier !== expectedSpecifier || !installedLockVersionMatches) {
      addIssue('pnpm-lock-version-mismatch', pin.name);
    }
    const packageEntry = asRecord(asRecord(lock?.packages)?.[`${pin.name}@${pin.version}`]);
    if (asRecord(packageEntry?.resolution)?.integrity !== pin.integrity) {
      addIssue('pnpm-lock-integrity-mismatch', pin.name);
    }

    return { ...pin, manifestDigest: installedManifestDigest };
  });

  const requirements = (Object.keys(FROZEN_REQUIREMENT_DIGESTS) as RequirementRevision[]).map((revision) => {
    let digest: `sha256:${string}` = sha256('unavailable');
    try {
      digest = digestFile(options.requirements[revision]);
    } catch {
      // The classified mismatch deliberately does not expose the supplied path or read error.
    }
    if (digest !== FROZEN_REQUIREMENT_DIGESTS[revision]) {
      addIssue('requirement-digest-mismatch', revision);
    }
    return { revision, digest };
  });

  let goModDigest: string | null = null;
  let goSumDigest: string | null = null;
  let vendorDigest: string | null = null;
  try {
    const goMod = readFileSync(options.go.goModPath, 'utf8');
    goModDigest = digestFile(options.go.goModPath);
    if (!hasTokenPair(goMod, GO_MODULE.name, GO_MODULE.version)) {
      addIssue('go-module-version-mismatch', GO_MODULE.name);
    }
  } catch {
    addIssue('go-module-version-mismatch', GO_MODULE.name);
  }
  try {
    const goSum = readFileSync(options.go.goSumPath, 'utf8');
    goSumDigest = digestFile(options.go.goSumPath);
    if (!goSum.split('\n').some((line) => line.trim() === `${GO_MODULE.name} ${GO_MODULE.version} ${GO_MODULE.sum}`)) {
      addIssue('go-module-sum-mismatch', GO_MODULE.name);
    }
  } catch {
    addIssue('go-module-sum-mismatch', GO_MODULE.name);
  }
  try {
    const vendor = hashConformancePath(options.go.vendorPath);
    vendorDigest = vendor.digest;
    const modules = readFileSync(path.join(options.go.vendorPath, 'modules.txt'), 'utf8');
    if (!hasTokenPair(modules, GO_MODULE.name, GO_MODULE.version)) {
      addIssue('go-vendor-version-mismatch', GO_MODULE.name);
    }
  } catch {
    addIssue('go-vendor-version-mismatch', GO_MODULE.name);
  }

  let pyprojectDigest: string | null = null;
  let pythonLockDigest: string | null = null;
  try {
    const pyproject = asRecord(parseToml(readFileSync(options.python.pyprojectPath, 'utf8')));
    pyprojectDigest = digestFile(options.python.pyprojectPath);
    const dependencies = asRecord(pyproject?.project)?.dependencies;
    if (!Array.isArray(dependencies) || !dependencies.includes(`${PYTHON_PACKAGE.name}==${PYTHON_PACKAGE.version}`)) {
      addIssue('python-version-mismatch', PYTHON_PACKAGE.name);
    }
  } catch {
    addIssue('python-version-mismatch', PYTHON_PACKAGE.name);
  }
  try {
    const uvLock = asRecord(parseToml(readFileSync(options.python.uvLockPath, 'utf8')));
    pythonLockDigest = digestFile(options.python.uvLockPath);
    const packages = uvLock?.package;
    const mcp = Array.isArray(packages)
      ? packages.map(asRecord).find((candidate) => candidate?.name === PYTHON_PACKAGE.name)
      : undefined;
    if (mcp?.version !== PYTHON_PACKAGE.version) addIssue('python-version-mismatch', PYTHON_PACKAGE.name);
    const wheels = mcp?.wheels;
    const hasWheel =
      Array.isArray(wheels) && wheels.map(asRecord).some((wheel) => wheel?.hash === PYTHON_PACKAGE.wheelHash);
    if (!hasWheel) addIssue('python-wheel-hash-mismatch', PYTHON_PACKAGE.name);
  } catch {
    addIssue('python-wheel-hash-mismatch', PYTHON_PACKAGE.name);
  }

  const reportWithoutDigest = {
    schemaVersion: 1 as const,
    ok: issues.length === 0,
    source: { sha: sourceSha, clean: sourceClean },
    artifacts,
    npm: { packageManifestDigest, pnpmLockDigest, packages: npmPackages },
    requirements,
    go: {
      version: GO_MODULE.version,
      sum: GO_MODULE.sum,
      goModDigest,
      goSumDigest,
      vendorDigest,
    },
    python: {
      version: PYTHON_PACKAGE.version,
      wheelHash: PYTHON_PACKAGE.wheelHash,
      pyprojectDigest,
      lockDigest: pythonLockDigest,
    },
    issues,
  };
  return { ...reportWithoutDigest, digest: reportDigest(reportWithoutDigest) };
}
