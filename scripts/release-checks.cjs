const REQUIRED_CHECKS = [
  'static',
  'unit-admin',
  'test-e2e-parallel',
  'test-e2e-system',
  'test-e2e-browser',
  'test-protocol',
  'test-legacy-upgrade',
  'test-windows-installer',
  'release-lifecycle',
];

function validateReleaseChecks(gates, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha) || gates?.sha !== sha || gates.ci !== 'success') {
    throw new Error('Release check identity is missing or mismatched');
  }
  let required = REQUIRED_CHECKS;
  if (!Object.hasOwn(gates, 'schemaVersion')) {
    // Historical release records keep their original acceptance requirements.
    if (gates.infrastructureVerdict !== 'green' || gates.productVerdict !== 'green') {
      throw new Error('Historical conformance verdict is not green');
    }
    required = REQUIRED_CHECKS.map((name) => (name === 'test-protocol' ? 'test-conformance' : name));
  } else if (gates.schemaVersion !== 1) {
    throw new Error('Unknown release check schema');
  }
  if (!gates.checks || typeof gates.checks !== 'object' || Array.isArray(gates.checks)) {
    throw new Error('Release checks are missing');
  }
  if (
    required.some((name) => gates.checks[name]?.result !== 'success') ||
    Object.values(gates.checks).some((check) => check?.result !== 'success')
  ) {
    throw new Error('Release checks failed, skipped, or missing');
  }
  return gates;
}

function createReleaseChecks(sha, checks, checkedOutSha) {
  if (checkedOutSha !== sha) throw new Error('Checked-out source does not match the release candidate');
  return validateReleaseChecks({ schemaVersion: 1, sha, ci: 'success', checks }, sha);
}

module.exports = { REQUIRED_CHECKS, validateReleaseChecks, createReleaseChecks };
