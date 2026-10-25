const assert = require('node:assert/strict');
const { test } = require('node:test');
const { REQUIRED_CHECKS, createReleaseChecks, validateReleaseChecks } = require('../../scripts/release-checks.cjs');

const sha = 'a'.repeat(40);
const checks = () => Object.fromEntries(REQUIRED_CHECKS.map((name) => [name, { result: 'success' }]));

test('new release records bind all required checks to the candidate without migration verdicts', () => {
  const gates = createReleaseChecks(sha, checks(), sha);
  assert.equal(gates.schemaVersion, 1);
  assert.equal(gates.productVerdict, undefined);
  assert.equal(validateReleaseChecks(gates, sha), gates);
});

test('historical records still require their original conformance verdicts and checks', () => {
  const historical = checks();
  historical['test-conformance'] = historical['test-protocol'];
  delete historical['test-protocol'];
  const gates = { sha, ci: 'success', infrastructureVerdict: 'green', productVerdict: 'green', checks: historical };
  assert.equal(validateReleaseChecks(gates, sha), gates);
  for (const key of ['productVerdict', 'infrastructureVerdict']) {
    assert.throws(() => validateReleaseChecks({ ...gates, [key]: 'red' }, sha));
  }
  delete historical['test-conformance'];
  assert.throws(() => validateReleaseChecks(gates, sha));
});

test('release checks reject unknown versions, wrong source, malformed and missing records', () => {
  const gates = createReleaseChecks(sha, checks(), sha);
  for (const invalid of [
    undefined,
    {},
    { ...gates, sha: 'b'.repeat(40) },
    { ...gates, schemaVersion: 2 },
    { ...gates, schemaVersion: null },
    { ...gates, ci: 'failure' },
    { ...gates, checks: {} },
    { ...gates, checks: [] },
  ]) {
    assert.throws(() => validateReleaseChecks(invalid, sha));
  }
});

for (const name of REQUIRED_CHECKS) {
  test(`release checks fail closed for ${name}`, () => {
    for (const result of ['failure', 'cancelled', 'skipped', 'pending', undefined]) {
      const values = checks();
      values[name] = { result };
      assert.throws(() => createReleaseChecks(sha, values, sha));
    }
    const values = checks();
    delete values[name];
    assert.throws(() => createReleaseChecks(sha, values, sha));
  });
}

test('new release records reject a checkout that differs from the requested candidate', () => {
  assert.throws(() => createReleaseChecks(sha, checks(), 'b'.repeat(40)), /Checked-out source/);
  assert.throws(() => createReleaseChecks(sha, checks()), /Checked-out source/);
});
