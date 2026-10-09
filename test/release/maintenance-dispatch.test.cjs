const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateReleaseInputs } = require('../../scripts/validate-release-inputs.cjs');
const absent = () => false;

test('maintenance dispatch defaults to its selected source branch', () => {
  assert.equal(
    validateReleaseInputs({ targetRef: '', dispatchRef: 'release-0.38', version: '0.38.3', tagExists: absent })
      .targetRef,
    'release-0.38',
  );
});
test('maintenance dispatch rejects the historical main default before checking tags', () => {
  let checked = false;
  assert.throws(
    () =>
      validateReleaseInputs({
        targetRef: 'main',
        dispatchRef: 'release-0.38',
        version: '0.38.3',
        tagExists: () => {
          checked = true;
          return false;
        },
      }),
    /dispatch source/,
  );
  assert.equal(checked, false);
});
test('maintenance dispatch rejects a different maintenance source', () => {
  assert.throws(
    () =>
      validateReleaseInputs({
        targetRef: 'release-0.39',
        dispatchRef: 'release-0.38',
        version: '0.39.1',
        tagExists: absent,
      }),
    /dispatch source/,
  );
});
test('default main dispatch and explicit trusted main dispatch targets remain supported', () => {
  assert.equal(validateReleaseInputs({ dispatchRef: 'main', version: '0.39.0', tagExists: absent }).targetRef, 'main');
  assert.equal(
    validateReleaseInputs({ targetRef: 'release-0.38', dispatchRef: 'main', version: '0.38.3', tagExists: absent })
      .targetRef,
    'release-0.38',
  );
});
