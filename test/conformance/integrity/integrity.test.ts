import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createRequire } from 'node:module';

import {
  ACCEPTED_NPM_PINS,
  hashConformancePath,
  MCP_2026_SPECIFICATION_SOURCE,
  verifyConformanceIntegrity,
} from './index.js';

const require = createRequire(import.meta.url);
const temporaryRoots = new Set<string>();
const REQUIREMENTS_ROOT = path.join(
  path.dirname(require.resolve('@modelcontextprotocol/conformance/package.json')),
  'requirements',
);

function temporaryDirectory(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryRoots.add(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
  temporaryRoots.clear();
});

function write(root: string, relative: string, contents: string | Buffer): string {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    },
  }).trim();
}

function mutateJson(inputPath: string, mutate: (value: Record<string, any>) => void): void {
  const value = JSON.parse(readFileSync(inputPath, 'utf8')) as Record<string, any>;
  mutate(value);
  writeFileSync(inputPath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture(prefix = 'integrity-repo-') {
  const root = temporaryDirectory(prefix);
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Conformance Test']);
  git(root, ['config', 'user.email', 'conformance@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);

  const dependencies = Object.fromEntries(ACCEPTED_NPM_PINS.map((pin) => [pin.name, pin.version]));
  const packageManifestPath = write(root, 'package.json', `${JSON.stringify({ dependencies }, null, 2)}\n`);
  const installedPackages = Object.fromEntries(
    ACCEPTED_NPM_PINS.map((pin) => {
      const manifestPath = write(
        root,
        `node_modules/${pin.name}/package.json`,
        `${JSON.stringify({ name: pin.name, version: pin.version })}\n`,
      );
      return [pin.name, manifestPath];
    }),
  );
  const importerDependencies = Object.fromEntries(
    ACCEPTED_NPM_PINS.map((pin) => [pin.name, { specifier: pin.version, version: pin.version }]),
  );
  const packageEntries = Object.fromEntries(
    ACCEPTED_NPM_PINS.map((pin) => [`${pin.name}@${pin.version}`, { resolution: { integrity: pin.integrity } }]),
  );
  const pnpmLockPath = write(
    root,
    'pnpm-lock.yaml',
    `${JSON.stringify({ lockfileVersion: '9.0', importers: { '.': { dependencies: importerDependencies } }, packages: packageEntries }, null, 2)}\n`,
  );

  const requirements = {
    '2025-11-25': write(
      root,
      'requirements/2025-11-25.yaml',
      readFileSync(path.join(REQUIREMENTS_ROOT, '2025-11-25.yaml')),
    ),
    '2026-07-28': write(
      root,
      'requirements/2026-07-28.yaml',
      readFileSync(path.join(REQUIREMENTS_ROOT, '2026-07-28.yaml')),
    ),
  } as const;
  const specificationSourcePath = write(
    root,
    'test/conformance/integrity/mcp-2026-07-28-spec-source.json',
    `${JSON.stringify(MCP_2026_SPECIFICATION_SOURCE, null, 2)}\n`,
  );

  const goModPath = write(
    root,
    'fixtures/go/go.mod',
    'module example.invalid/conformance\n\ngo 1.25.0\n\nrequire github.com/modelcontextprotocol/go-sdk v1.7.0\n',
  );
  const goSumPath = write(
    root,
    'fixtures/go/go.sum',
    'github.com/modelcontextprotocol/go-sdk v1.7.0 h1:yqjY2dsbKAC0LSuWZVBMrHgiG8ukXv6NRo0JiALay44=\n',
  );
  const goVendorPath = path.join(root, 'fixtures/go/vendor');
  write(root, 'fixtures/go/vendor/modules.txt', '# github.com/modelcontextprotocol/go-sdk v1.7.0\n');
  write(root, 'fixtures/go/vendor/github.com/modelcontextprotocol/go-sdk/LICENSE', 'synthetic fixture\n');

  const pyprojectPath = write(
    root,
    'fixtures/python/pyproject.toml',
    '[project]\nname = "fixture"\nversion = "0.0.0"\ndependencies = ["mcp==2.0.0"]\n',
  );
  const uvLockPath = write(
    root,
    'fixtures/python/uv.lock',
    'version = 1\n\n[[package]]\nname = "mcp"\nversion = "2.0.0"\nwheels = [{ url = "https://example.invalid/mcp.whl", hash = "sha256:1cb4c75d2d2c7b8c1d756355e5d82a39f2822cc7f13e22a2051d7ca3592349d6" }]\n',
  );

  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);
  const expectedSourceSha = git(root, ['rev-parse', 'HEAD']);

  return {
    root,
    options: {
      sourceRoot: root,
      expectedSourceSha,
      artifacts: [
        { id: 'go-vendor', path: goVendorPath, expectedDigest: hashConformancePath(goVendorPath).digest },
        { id: 'python-lock', path: uvLockPath, expectedDigest: hashConformancePath(uvLockPath).digest },
      ],
      npm: { packageManifestPath, pnpmLockPath, parseYaml: JSON.parse, installedPackages },
      requirements,
      specificationSourcePath,
      go: { goModPath, goSumPath, vendorPath: goVendorPath },
      python: { pyprojectPath, uvLockPath },
    },
  };
}

describe('hashConformancePath', () => {
  it('hashes directory contents independently of creation order and root path', () => {
    const first = temporaryDirectory('integrity-first-');
    const second = temporaryDirectory('integrity-second-');

    mkdirSync(path.join(first, 'nested'));
    writeFileSync(path.join(first, 'z.txt'), 'last\n');
    writeFileSync(path.join(first, 'nested', 'a.txt'), 'first\n');

    mkdirSync(path.join(second, 'nested'));
    writeFileSync(path.join(second, 'nested', 'a.txt'), 'first\n');
    writeFileSync(path.join(second, 'z.txt'), 'last\n');

    expect(hashConformancePath(first)).toEqual(hashConformancePath(second));
    expect(hashConformancePath(first)).toMatchObject({ kind: 'directory', fileCount: 2 });
  });

  it('does not expose a missing absolute path in its error', () => {
    const root = temporaryDirectory('integrity-missing-');
    const missing = path.join(root, 'private-user-path.txt');
    expect(() => hashConformancePath(missing)).toThrow('artifact-unreadable');
    try {
      hashConformancePath(missing);
    } catch (error) {
      expect(String(error)).not.toContain(root);
    }
  });
});

describe('verifyConformanceIntegrity', () => {
  it('produces a green exact-source report from actual pinned inputs', () => {
    const fixture = createFixture();
    const report = verifyConformanceIntegrity(fixture.options);

    expect(report).toMatchObject({
      schemaVersion: 1,
      ok: true,
      source: { sha: fixture.options.expectedSourceSha, clean: true },
      issues: [],
    });
    expect(report.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(report)).not.toContain(fixture.root);
  });

  it('rejects tracked and untracked source dirtiness without retaining filenames', () => {
    const tracked = createFixture('integrity-tracked-');
    writeFileSync(tracked.options.go.goModPath, 'changed\n');
    const trackedReport = verifyConformanceIntegrity(tracked.options);
    expect(trackedReport.issues).toContainEqual({ code: 'source-dirty-tracked', subject: 'source' });

    const untracked = createFixture('integrity-untracked-');
    const secretPath = write(untracked.root, 'private-user-path.txt', 'secret\n');
    const untrackedReport = verifyConformanceIntegrity(untracked.options);
    expect(untrackedReport.issues).toContainEqual({ code: 'source-dirty-untracked', subject: 'source' });
    expect(JSON.stringify(untrackedReport)).not.toContain(secretPath);
  });

  it('rejects manifest, installed package, lock version, and lock SRI mutations', () => {
    const manifest = createFixture('integrity-manifest-');
    mutateJson(manifest.options.npm.packageManifestPath, (value) => {
      value.dependencies['@modelcontextprotocol/client'] = '^2.0.0';
    });
    expect(verifyConformanceIntegrity(manifest.options).issues).toContainEqual({
      code: 'npm-manifest-version-mismatch',
      subject: '@modelcontextprotocol/client',
    });

    const installed = createFixture('integrity-installed-');
    mutateJson(installed.options.npm.installedPackages['@modelcontextprotocol/node'], (value) => {
      value.version = '2.0.1';
    });
    expect(verifyConformanceIntegrity(installed.options).issues).toContainEqual({
      code: 'npm-installed-package-mismatch',
      subject: '@modelcontextprotocol/node',
    });

    const lockVersion = createFixture('integrity-lock-version-');
    mutateJson(lockVersion.options.npm.pnpmLockPath, (value) => {
      value.importers['.'].dependencies['@modelcontextprotocol/server-legacy'].version = '2.0.1';
    });
    expect(verifyConformanceIntegrity(lockVersion.options).issues).toContainEqual({
      code: 'pnpm-lock-version-mismatch',
      subject: '@modelcontextprotocol/server-legacy',
    });

    const lockSri = createFixture('integrity-lock-sri-');
    mutateJson(lockSri.options.npm.pnpmLockPath, (value) => {
      value.packages['@modelcontextprotocol/conformance@0.2.0-alpha.11'].resolution.integrity = 'sha512-tampered';
    });
    expect(verifyConformanceIntegrity(lockSri.options).issues).toContainEqual({
      code: 'pnpm-lock-integrity-mismatch',
      subject: '@modelcontextprotocol/conformance',
    });
  });

  it('rejects frozen requirement bytes and recorded artifact tree mutations', () => {
    const requirement = createFixture('integrity-requirement-');
    writeFileSync(requirement.options.requirements['2026-07-28'], 'tampered\n');
    expect(verifyConformanceIntegrity(requirement.options).issues).toContainEqual({
      code: 'requirement-digest-mismatch',
      subject: '2026-07-28',
    });

    const tree = createFixture('integrity-tree-');
    write(tree.options.go.vendorPath, 'new-file.txt', 'tampered\n');
    expect(verifyConformanceIntegrity(tree.options).issues).toContainEqual({
      code: 'artifact-digest-mismatch',
      subject: 'go-vendor',
    });
  });

  it('rejects a changed MCP 2026 specification tag source identity', () => {
    const specification = createFixture('integrity-specification-');
    mutateJson(specification.options.specificationSourcePath, (value) => {
      value.commit = '0'.repeat(40);
    });

    expect(verifyConformanceIntegrity(specification.options).issues).toContainEqual({
      code: 'specification-source-mismatch',
      subject: '2026-07-28',
    });
  });

  it('rejects Go module/sum/vendor and Python version/wheel mutations', () => {
    const goVersion = createFixture('integrity-go-version-');
    writeFileSync(
      goVersion.options.go.goModPath,
      'module example.invalid/conformance\n\ngo 1.25.0\n\nrequire github.com/modelcontextprotocol/go-sdk v1.7.1\n',
    );
    expect(verifyConformanceIntegrity(goVersion.options).issues).toContainEqual({
      code: 'go-module-version-mismatch',
      subject: 'github.com/modelcontextprotocol/go-sdk',
    });

    const goSum = createFixture('integrity-go-sum-');
    writeFileSync(goSum.options.go.goSumPath, 'github.com/modelcontextprotocol/go-sdk v1.7.0 h1:tampered=\n');
    expect(verifyConformanceIntegrity(goSum.options).issues).toContainEqual({
      code: 'go-module-sum-mismatch',
      subject: 'github.com/modelcontextprotocol/go-sdk',
    });

    const goVendor = createFixture('integrity-go-vendor-');
    writeFileSync(
      path.join(goVendor.options.go.vendorPath, 'modules.txt'),
      '# github.com/modelcontextprotocol/go-sdk v1.7.1\n',
    );
    expect(verifyConformanceIntegrity(goVendor.options).issues).toContainEqual({
      code: 'go-vendor-version-mismatch',
      subject: 'github.com/modelcontextprotocol/go-sdk',
    });

    const pythonVersion = createFixture('integrity-python-version-');
    writeFileSync(
      pythonVersion.options.python.pyprojectPath,
      '[project]\nname = "fixture"\nversion = "0.0.0"\ndependencies = ["mcp==2.0.1"]\n',
    );
    expect(verifyConformanceIntegrity(pythonVersion.options).issues).toContainEqual({
      code: 'python-version-mismatch',
      subject: 'mcp',
    });

    const pythonWheel = createFixture('integrity-python-wheel-');
    writeFileSync(
      pythonWheel.options.python.uvLockPath,
      'version = 1\n\n[[package]]\nname = "mcp"\nversion = "2.0.0"\nwheels = [{ url = "https://example.invalid/mcp.whl", hash = "sha256:tampered" }]\n',
    );
    expect(verifyConformanceIntegrity(pythonWheel.options).issues).toContainEqual({
      code: 'python-wheel-hash-mismatch',
      subject: 'mcp',
    });
  });

  it('keeps the report digest stable across absolute roots and changes it for input bytes', () => {
    const first = createFixture('integrity-stable-a-');
    const second = createFixture('integrity-stable-b-');
    expect(verifyConformanceIntegrity(first.options).digest).toBe(verifyConformanceIntegrity(second.options).digest);

    writeFileSync(first.options.python.uvLockPath, `${readFileSync(first.options.python.uvLockPath, 'utf8')}\n`);
    expect(verifyConformanceIntegrity(first.options).digest).not.toBe(
      verifyConformanceIntegrity(second.options).digest,
    );
  });
});
