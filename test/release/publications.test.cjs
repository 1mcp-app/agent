const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { candidate, loadArtifacts, recordArtifacts } = require('../../scripts/release-artifacts.cjs');
const { main, aliasNames, dockerReadback, publicationDecision } = require('../../scripts/release-publications.cjs');
const { resolveDispatch, verifyRecoveryRun, resolveCandidateSource } = require('../../scripts/release-recovery.cjs');
const { summarize } = require('../../scripts/release-summary.cjs');
const sha = 'a'.repeat(40);
const stable = { sha, version: '1.2.3', channel: 'latest', versionTag: 'v1.2.3' };
const beta = { sha, version: '1.2.3-beta.1', channel: 'next', versionTag: 'v1.2.3-beta.1' };
function fixture(t, identity = stable, existing = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-fixture-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const archive = Buffer.from('retained tested bytes');
  const sha256 = require('node:crypto').createHash('sha256').update(archive).digest('hex');
  const integrity = 'sha512-' + require('node:crypto').createHash('sha512').update(archive).digest('base64');
  const records = [
    {
      ...identity,
      kind: 'npm',
      files: [{ name: 'package.tgz', sha256, integrity }],
      manifestPath: path.join(directory, 'npm.json'),
    },
  ];
  for (const kind of ['sea-linux-x64', 'sea-linux-arm64', 'sea-win32-x64', 'sea-darwin-x64', 'sea-darwin-arm64']) {
    const name = kind + '.tar.gz';
    fs.writeFileSync(path.join(directory, name), archive);
    records.push({ ...identity, kind, files: [{ name, sha256 }], manifestPath: path.join(directory, kind + '.json') });
  }
  let count = 0;
  for (const target of ['basic', 'extended'])
    for (const platform of ['amd64', 'arm64'])
      records.push({ ...identity, kind: `oci-${target}-${platform}`, digest: 'sha256:' + String(++count).repeat(64) });
  let npm = existing ? { name: '@1mcp/agent', version: identity.version, gitHead: sha, dist: { integrity } } : null;
  const oci = {};
  const indexes = {};
  function index(target) {
    return {
      annotations: { 'org.opencontainers.image.revision': sha, 'org.opencontainers.image.version': identity.version },
      manifests: records
        .filter((record) => record.kind.startsWith(`oci-${target}-`))
        .map((record, i) => ({
          digest: record.digest,
          platform: { os: 'linux', architecture: i ? 'arm64' : 'amd64' },
        })),
    };
  }
  for (const target of ['basic', 'extended']) {
    const digest = 'sha256:' + (target === 'basic' ? 'b' : 'e').repeat(64);
    indexes[target] = digest;
    oci[`ghcr.io/1mcp-app/agent@${digest}`] = index(target);
    if (existing)
      oci[`ghcr.io/1mcp-app/agent:${identity.versionTag}${target === 'basic' ? '-lite' : ''}`] = index(target);
  }
  let release = existing
    ? {
        draft: false,
        prerelease: identity.version.includes('-'),
        html_url: 'https://example.test/release',
        tag_name: identity.versionTag,
        assets: records
          .filter((record) => record.kind.startsWith('sea-'))
          .flatMap((record) => record.files.map((file) => ({ name: file.name }))),
      }
    : null;
  const writes = [];
  let npmAlias = '0.9.0';
  const options = {
    identity,
    records,
    repository: '1mcp-app/agent',
    statePath: path.join(directory, 'state.json'),
    readbackDirectory: path.join(directory, 'readback'),
    recovery: existing,
    npmReadback: async () => npm,
    waitForNpmReadback: async () => {},
    dockerReadback: (reference) => oci[reference] || null,
    ghApi: (endpoint) =>
      endpoint.includes('/git/ref/') ? (release ? { object: { type: 'commit', sha } } : null) : release,
    run: (command, args) => {
      if (args[0] === 'publish') {
        writes.push('npm');
        npm = { name: '@1mcp/agent', version: identity.version, gitHead: sha, dist: { integrity } };
      } else if (command === 'npm' && args[0] === 'dist-tag') {
        writes.push('alias:npm');
        npmAlias = identity.version;
      } else if (command === 'npm' && args[0] === 'view') return JSON.stringify({ [identity.channel]: npmAlias });
      else if (command === 'docker' && args.includes('create')) {
        const reference = args[args.indexOf('--tag') + 1];
        writes.push('oci:' + reference);
        const target = reference.includes('lite') ? 'basic' : 'extended';
        oci[reference] = index(target);
      } else if (command === 'docker' && args.includes('--format')) {
        const reference = args[args.indexOf('inspect') + 1];
        return indexes[reference.includes('lite') ? 'basic' : 'extended'];
      } else if (command === 'gh' && args[1] === 'create') {
        writes.push('github');
        release = {
          draft: false,
          prerelease: identity.version.includes('-'),
          html_url: 'https://example.test/release',
          tag_name: identity.versionTag,
          assets: [],
        };
      } else if (command === 'gh' && args[1] === 'upload') {
        writes.push('asset:' + path.basename(args[3]));
        release.assets.push({ name: path.basename(args[3]) });
      } else if (command === 'gh' && args[1] === 'download') {
        const name = args[args.indexOf('--pattern') + 1];
        const target = args[args.indexOf('--dir') + 1];
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, name), archive);
      } else if (command === 'gh' && args[1] === 'edit') writes.push('alias:github');
      return '';
    },
  };
  return {
    options,
    writes,
    directory,
    records,
    get release() {
      return release;
    },
    setNpm(value) {
      npm = value;
    },
    index,
  };
}

test('case 1: failure before publication rejects stale source/channel/gates and has zero writes', async (t) => {
  for (const overrides of [{ actualSha: 'b'.repeat(40) }, { actualVersion: '9.9.9' }, { npmTag: 'next' }])
    assert.throws(() =>
      candidate({ ...stable, actualSha: sha, actualVersion: stable.version, npmTag: 'latest', ...overrides }),
    );
  const f = fixture(t);
  f.options.npmReadback = async () => {
    throw new Error('DNS host not found');
  };
  await assert.rejects(main('versions', f.options), /DNS/);
  assert.deepEqual(f.writes, []);
  assert.equal(JSON.parse(fs.readFileSync(f.options.statePath)).status, 'partial-or-failed');
});

test('successful npm command with absent readback records uncertainty and stops before other publications', async (t) => {
  const f = fixture(t);
  f.options.npmReadback = async () => null;
  await assert.rejects(main('versions', f.options), /version absent/);
  const state = JSON.parse(fs.readFileSync(f.options.statePath));
  assert.equal(state.publications.npm.commandCompleted, true);
  assert.equal(state.publications.npm.status, 'attempting');
  assert.deepEqual(f.writes, ['npm']);
});

test('delayed npm registry propagation polls readback without republishing', async (t) => {
  const f = fixture(t);
  const readNpm = f.options.npmReadback;
  let reads = 0;
  let waits = 0;
  f.options.npmReadback = async () => (++reads <= 3 ? null : readNpm());
  f.options.waitForNpmReadback = async () => {
    waits++;
  };
  await main('versions', f.options);
  assert.equal(waits, 2);
  assert.equal(f.writes.filter((write) => write === 'npm').length, 1);
  assert.equal(JSON.parse(fs.readFileSync(f.options.statePath)).status, 'success');
});

test('npm readback deadline stops polling even before the attempt cap', async (t) => {
  const f = fixture(t);
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  let reads = 0;
  f.options.npmReadback = async (_version, timeoutMs) => {
    reads++;
    if (reads > 1) assert.ok(timeoutMs > 0 && timeoutMs <= 30000);
    return null;
  };
  f.options.waitForNpmReadback = async () => {
    now += 10 * 60 * 1000;
  };
  await assert.rejects(main('versions', f.options), /version absent/);
  assert.equal(reads, 2); // One preflight and one post-publication read, then the deadline expires.
  assert.deepEqual(f.writes, ['npm']);
});

test('post-publish identity conflict or registry errors stop without polling or further writes', async (t) => {
  for (const observed of [{ name: 'wrong' }, new Error('Registry unavailable')]) {
    const f = fixture(t);
    let reads = 0;
    f.options.npmReadback = async () => {
      if (++reads === 1) return null;
      if (observed instanceof Error) throw observed;
      return observed;
    };
    f.options.waitForNpmReadback = async () => assert.fail('Conflicts and errors must not be polled');
    await assert.rejects(main('versions', f.options));
    assert.deepEqual(f.writes, ['npm']);
  }
});

test('malformed HTTP 200 registry metadata is never treated as missing', async (t) => {
  for (const metadata of [null, false, 0, '', []]) {
    const f = fixture(t);
    delete f.options.npmReadback;
    t.mock.method(globalThis, 'fetch', async () => ({ status: 200, ok: true, json: async () => metadata }));
    f.options.waitForNpmReadback = async () => assert.fail('Malformed metadata must not be polled');
    await assert.rejects(main('versions', f.options), /malformed registry metadata/);
    assert.deepEqual(f.writes, []);
    t.mock.restoreAll();
  }
});

test('non-null falsy post-publication readbacks fail immediately without polling', async (t) => {
  for (const metadata of [false, 0, '']) {
    const f = fixture(t);
    let reads = 0;
    f.options.npmReadback = async () => (++reads === 1 ? null : metadata);
    f.options.waitForNpmReadback = async () => assert.fail('Only explicit absence may be polled');
    await assert.rejects(main('versions', f.options), /name differs/);
    assert.deepEqual(f.writes, ['npm']);
  }
});

test('case 2: partial publication stops, explicit owner resume reuses npm and retained bytes', async (t) => {
  const f = fixture(t);
  const execute = f.options.run;
  let fail = true;
  f.options.run = (command, args) => {
    if (fail && command === 'docker' && args.includes('create')) throw new Error('publication uncertain');
    return execute(command, args);
  };
  await assert.rejects(main('versions', f.options), /uncertain/);
  let state = JSON.parse(fs.readFileSync(f.options.statePath));
  assert.equal(state.publications.npm.status, 'verified');
  assert.equal(state.publications['oci-basic'].status, 'attempting');
  assert.deepEqual(state.aliases, {});
  // Ordinary rerun stops even on matching existing content.
  await assert.rejects(main('versions', f.options), /explicit owner recovery/);
  fail = false;
  f.options.recovery = true;
  await main('versions', f.options);
  assert.equal(f.writes.filter((write) => write === 'npm').length, 1);
  state = JSON.parse(fs.readFileSync(f.options.statePath));
  assert.equal(state.publications.github.status, 'verified');
  assert.deepEqual(state.aliases, {});
});

test('case 3: alias partial movement is truthful, explicit resumption does not republish versions', async (t) => {
  const f = fixture(t, stable, true);
  const execute = f.options.run;
  let fail = true;
  f.options.run = (command, args) => {
    if (fail && command === 'docker' && args.includes('create')) throw new Error('alias uncertain');
    return execute(command, args);
  };
  await assert.rejects(main('promote', f.options), /alias uncertain/);
  let state = JSON.parse(fs.readFileSync(f.options.statePath));
  assert.equal(state.aliases.npm.status, 'verified');
  assert.equal(state.aliases['oci-lite'].status, 'attempting');
  fail = false;
  await main('promote', f.options);
  state = JSON.parse(fs.readFileSync(f.options.statePath));
  assert.equal(state.aliases['oci-latest'].status, 'verified');
  assert.ok(!f.writes.includes('npm'));
  assert.ok(!f.writes.includes('github'));
});

test('case 4: conflicting existing npm/OCI/GitHub identities and ambiguous readbacks stop before writes', async (t) => {
  for (const provider of ['npm', 'oci', 'github']) {
    const f = fixture(t, stable, true);
    if (provider === 'npm')
      f.setNpm({ name: '@1mcp/agent', version: stable.version, gitHead: 'b'.repeat(40), dist: { integrity: 'wrong' } });
    if (provider === 'oci') f.options.dockerReadback = () => ({ manifests: [] });
    if (provider === 'github')
      f.options.ghApi = () => {
        throw new Error('GitHub HTTP403 ambiguous');
      };
    await assert.rejects(main('versions', f.options));
    assert.deepEqual(f.writes, []);
  }
  assert.throws(() => publicationDecision({}, false));
});

test('beta promotes next and beta only, never stable aliases or GitHub latest', async (t) => {
  const f = fixture(t, beta, true);
  await main('promote', f.options);
  const state = JSON.parse(fs.readFileSync(f.options.statePath));
  assert.equal(state.aliases.npm.tag, 'next');
  assert.deepEqual(Object.keys(state.aliases).sort(), ['npm', 'oci-beta']);
  assert.deepEqual(aliasNames(stable, 'basic'), ['lite', 'v1-lite', 'v1.2-lite']);
  assert.deepEqual(aliasNames(beta, 'basic'), []);
});

function recoveryFixture(identity = stable, releaseRef = 'main') {
  const run = {
    id: 123,
    run_attempt: 1,
    repository: { full_name: '1mcp-app/agent' },
    path: '.github/workflows/release-pipeline.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    head_branch: 'main',
  };
  const summary = {
    ...identity,
    runId: '123',
    artifactRunId: '123',
    attempt: '1',
    runUrl: 'https://github.com/1mcp-app/agent/actions/runs/123',
    releaseRef,
    jobs: { ci: { result: 'success' }, 'native-security': { result: 'success' } },
    gates: {
      sha: identity.sha,
      ci: 'success',
      infrastructureVerdict: 'green',
      productVerdict: 'green',
      checks: Object.fromEntries(
        [
          'static',
          'unit-admin',
          'test-e2e-parallel',
          'test-e2e-system',
          'test-e2e-browser',
          'test-conformance',
          'test-legacy-upgrade',
          'test-windows-installer',
          'release-lifecycle',
        ].map((name) => [name, { result: 'success' }]),
      ),
    },
  };
  return { run, summary };
}

test('recovery derives stable, beta and maintenance identity using only the original run ID', () => {
  for (const identity of [stable, beta]) {
    for (const source of ['main', 'release-1.2']) {
      const { run, summary } = recoveryFixture(identity, source);
      const result = resolveDispatch({ runId: '123', targetRef: 'main', version: '' }, (runId) =>
        verifyRecoveryRun(run, summary, '1mcp-app/agent', runId),
      );
      assert.deepEqual(result.identity, identity);
      assert.equal(result.policy.targetRef, source);
      assert.equal(result.policy.version, identity.version);
    }
  }
});

test('recovery rejects foreign, untested, chained, malformed or conflicting run evidence', () => {
  const { run, summary } = recoveryFixture();
  for (const change of [
    { sha: 'bad' },
    { version: 'bad' },
    { channel: 'next' },
    { releaseRef: 'release-9.9' },
    { releaseRef: undefined },
    { runId: '456' },
    { artifactRunId: '456' },
    { attempt: '2' },
    { runUrl: 'https://github.com/other/repo/actions/runs/123' },
    { recoveryRunId: '123' },
    { jobs: { ci: { result: 'failure' }, 'native-security': { result: 'success' } } },
    { jobs: {} },
    { gates: undefined },
    { gates: { ...summary.gates, sha: 'b'.repeat(40) } },
    { gates: { ...summary.gates, productVerdict: 'red' } },
    { gates: { ...summary.gates, checks: {} } },
    { gates: { ...summary.gates, checks: { ...summary.gates.checks, 'test-conformance': { result: 'skipped' } } } },
  ])
    assert.throws(() => verifyRecoveryRun(run, { ...summary, ...change }, '1mcp-app/agent', '123'));
  for (const change of [
    { id: 456 },
    { repository: { full_name: 'other/repo' } },
    { path: '.github/workflows/other.yml' },
    { event: 'push' },
    { status: 'in_progress' },
    { run_attempt: undefined },
    { run_attempt: 0 },
    { head_branch: 'feature/untrusted' },
  ])
    assert.throws(() => verifyRecoveryRun({ ...run, ...change }, summary, '1mcp-app/agent', '123'));
});

test('dispatch rejects ambiguous inputs or unavailable original evidence before source mutation', () => {
  const unexpectedRead = () => {
    throw new Error('Unexpected original-run read');
  };
  assert.throws(() => resolveDispatch({ runId: 'invalid' }, unexpectedRead), /Invalid recovery run ID/);
  assert.throws(() => resolveDispatch({ runId: '123', version: '1.2.3' }, unexpectedRead), /leave version empty/);
  assert.throws(() => resolveDispatch({ version: '' }, unexpectedRead), /required for a new release/);
  assert.throws(
    () =>
      resolveDispatch({ runId: '123' }, () => {
        throw new Error('Summary expired');
      }),
    /Summary expired/,
  );
});

test('retained SEA build configuration is not a publication identity', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'package.tgz'), 'retained tested bytes');
  for (const record of f.options.records) {
    const manifest = { ...record, smoke: 'passed' };
    delete manifest.manifestPath;
    fs.writeFileSync(path.join(f.directory, `${record.kind}.json`), JSON.stringify(manifest));
  }
  fs.writeFileSync(path.join(f.directory, 'sea-config.json'), JSON.stringify({ main: 'sea.cjs', output: 'sea.blob' }));
  assert.equal(loadArtifacts(f.directory, stable).length, 10);
  const manifestPath = path.join(f.directory, 'sea-darwin-x64.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.sha = 'b'.repeat(40);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => loadArtifacts(f.directory, stable), /Candidate SHA mismatch/);
});

test('expired/missing or modified artifacts are rejected; no rebuilding same identity', (t) => {
  const f = fixture(t);
  assert.throws(() => loadArtifacts(f.directory, stable), /Missing/);
  const npmDirectory = path.join(f.directory, 'npm');
  fs.mkdirSync(npmDirectory);
  fs.writeFileSync(path.join(npmDirectory, 'package.tgz'), 'tested');
  recordArtifacts(npmDirectory, 'npm', stable);
  fs.writeFileSync(path.join(npmDirectory, 'package.tgz'), 'changed');
  assert.throws(() => loadArtifacts(f.directory, stable), /checksum/);
});

test('summary distinguishes partial alias uncertainty and unperformed publication', () => {
  const summary = summarize({
    ...stable,
    jobs: { release: { result: 'failure' } },
    records: [
      {
        publications: { npm: { status: 'verified' } },
        aliases: { 'oci-latest': { status: 'attempting' } },
        status: 'partial-or-failed',
      },
    ],
    runUrl: 'run',
    releaseRef: 'release-1.2',
    dispatchActor: 'maintainer',
    triggeringActor: 'maintainer',
  });
  assert.equal(summary.outcome, 'incomplete');
  assert.equal(summary.releaseRef, 'release-1.2');
  assert.deepEqual(summary.authorization, {
    method: 'workflow_dispatch',
    dispatchActor: 'maintainer',
    triggeringActor: 'maintainer',
    runUrl: 'run',
  });
  assert.ok(!Object.hasOwn(summary, 'approvalReferences'));
  assert.equal(summary.aliases['oci-latest'].status, 'attempting');
  assert.equal(summary.publications.npm.status, 'verified');
  const before = summarize({ ...stable, jobs: { release: { result: 'skipped' } }, records: [], runUrl: 'run' });
  assert.equal(before.publicationStatus, 'not-attempted-or-evidence-unavailable');
});

test('recovery summary links reused gates to the original run', () => {
  const summary = summarize({
    sha: stable.sha,
    version: stable.version,
    jobs: {},
    records: [],
    runUrl: 'https://github.com/1mcp-app/agent/actions/runs/456',
    recoveryRunId: '123',
  });
  assert.equal(summary.gateRunUrl, 'https://github.com/1mcp-app/agent/actions/runs/123');
});

test('OCI missing-manifest is distinct from DNS/proxy/auth/tool failures', () => {
  const fail = (message) => () => {
    const error = new Error('readback failed');
    error.stderr = message;
    throw error;
  };
  assert.equal(dockerReadback('image:version', fail('manifest unknown')), null);
  assert.equal(dockerReadback('image:version', fail('ERROR: image:version: not found\n')), null);
  for (const diagnostic of [
    'DNS host not found',
    'proxy not found',
    'docker: command not found',
    'HTTP 404 gateway failure',
    'unauthorized',
    'ERROR: another-image:version: not found',
    'ERROR: image:version: not found\nunauthorized',
  ])
    assert.throws(() => dockerReadback('image:version', fail(diagnostic)), /ambiguous/);
});

test('promotion evidence supersedes version evidence even before any alias moves', () => {
  const summary = summarize({
    ...stable,
    jobs: { release: { result: 'failure' } },
    records: [
      {
        phase: 'promote',
        publications: { npm: { status: 'verified' } },
        aliases: {},
        status: 'partial-or-failed',
        error: 'readback unavailable before alias movement',
      },
      { phase: 'versions', publications: { npm: { status: 'verified' } }, aliases: {}, status: 'success' },
    ],
  });
  assert.equal(summary.publicationStatus, 'partial-or-failed');
  assert.equal(summary.error, 'readback unavailable before alias movement');
  assert.deepEqual(summary.aliases, {});
});

test('custom prerelease channels cannot collide with stable aliases', () => {
  for (const channel of ['latest', 'lite', 'v1', 'v1-lite', 'v12'])
    assert.throws(
      () => aliasNames({ ...stable, version: `1.2.3-${channel}.1`, channel }, 'extended'),
      /reserved for stable/,
    );
});

test('safe hyphenated prerelease channels keep their full OCI alias', () => {
  for (const channel of ['latest-preview', 'preview-internal'])
    assert.deepEqual(aliasNames({ ...stable, version: `1.2.3-${channel}.1`, channel }, 'extended'), [channel]);
});

test('trusted resolver only parses candidate data and requires approved branch ancestry before output', () => {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return sha;
    if (args[0] === 'show')
      return args[1].endsWith(':package.json')
        ? JSON.stringify({ version: stable.version })
        : 'trusted cache-deps action bytes';
    return '';
  };
  assert.deepEqual(
    resolveCandidateSource({ sha, version: stable.version, npmTag: 'latest', releaseRef: 'main' }, git),
    stable,
  );
  assert.deepEqual(
    calls.map((args) => args[0]),
    ['rev-parse', 'show', 'show', 'show', 'merge-base'],
  );
  assert.deepEqual(calls.at(-1), ['merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main']);
  assert.throws(() =>
    resolveCandidateSource({ sha, version: stable.version, npmTag: 'latest', releaseRef: 'feature/untrusted' }, git),
  );
  assert.throws(
    () =>
      resolveCandidateSource({ sha, version: stable.version, npmTag: 'latest', releaseRef: 'main' }, (args) => {
        if (args[0] === 'merge-base') throw new Error('untrusted ancestry');
        return git(args);
      }),
    /ancestry/,
  );
});

test('trusted resolver rejects older or divergent setup action bytes before allowing candidate execution', () => {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return sha;
    if (args[0] === 'show' && args[1].endsWith(':package.json')) return JSON.stringify({ version: stable.version });
    if (args[0] === 'show' && args[1].startsWith('HEAD:')) return 'trusted cache-deps action bytes';
    if (args[0] === 'show') return 'older action ignores cache-deps';
    throw new Error('Candidate must not proceed');
  };
  assert.throws(
    () => resolveCandidateSource({ sha, version: stable.version, npmTag: 'latest', releaseRef: 'main' }, git),
    /owner must align.*Recovery must retain/,
  );
  assert.ok(!calls.some((args) => args[0] === 'merge-base'));
  assert.ok(calls.some((args) => args[1] === 'HEAD:.github/actions/setup-node-pnpm/action.yml'));
});

test('trusted resolver fails closed with actionable policy message when candidate setup action is missing', () => {
  const git = (args) => {
    if (args[0] === 'rev-parse') return sha;
    if (args[0] === 'show' && args[1].endsWith(':package.json')) return JSON.stringify({ version: stable.version });
    throw new Error('path does not exist');
  };
  assert.throws(
    () => resolveCandidateSource({ sha, version: stable.version, npmTag: 'latest', releaseRef: 'main' }, git),
    /owner must align/,
  );
});

test('trusted resolver compares raw action bytes rather than decoded replacement characters', () => {
  const git = (args) => {
    if (args[0] === 'rev-parse') return sha;
    if (args[0] === 'show' && args[1].endsWith(':package.json'))
      return Buffer.from(JSON.stringify({ version: stable.version }));
    if (args[0] === 'show') return args[1].startsWith('HEAD:') ? Buffer.from([0xff]) : Buffer.from([0xfe]);
    return '';
  };
  assert.throws(
    () => resolveCandidateSource({ sha, version: stable.version, npmTag: 'latest', releaseRef: 'main' }, git),
    /owner must align/,
  );
});
