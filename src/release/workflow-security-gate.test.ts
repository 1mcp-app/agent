import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { scanWorkflowSecurity } from './workflow-security-gate.js';

function findYamlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findYamlFiles(full));
    } else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) {
      files.push(full);
    }
  }
  return files;
}

function getWorkflowAndActionFiles(): { name: string; relativePath: string; content: string }[] {
  const root = process.cwd();
  const workflowsDir = path.join(root, '.github', 'workflows');
  const actionsDir = path.join(root, '.github', 'actions');

  const files = [...findYamlFiles(workflowsDir), ...findYamlFiles(actionsDir)];

  return files.map((fullPath) => ({
    name: path.basename(fullPath),
    relativePath: path.relative(root, fullPath).replace(/\\/g, '/'),
    content: fs.readFileSync(fullPath, 'utf8'),
  }));
}

describe('GitHub Actions Workflow & Composite Action Security Gate', () => {
  const files = getWorkflowAndActionFiles();

  it('discovers and verifies all repository workflow and action files exist', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.relativePath.startsWith('.github/workflows/'))).toBe(true);
    expect(files.some((f) => f.relativePath.startsWith('.github/actions/'))).toBe(true);
  });

  describe('Repository workflows & actions security invariants', () => {
    files.forEach(({ relativePath, content }) => {
      it('enforces security rules on ' + relativePath, () => {
        const violations = scanWorkflowSecurity(content, relativePath);
        expect(
          violations,
          'Security violations found in ' +
            relativePath +
            ':\n' +
            violations.map((v) => '  Line ' + v.line + ' [' + v.rule + ']: ' + v.snippet).join('\n'),
        ).toEqual([]);
      });
    });
  });

  describe('Negative test cases (regression detection & bypass resistance)', () => {
    it('detects and blocks direct dot syntax in single-line run', () => {
      const malicious = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo "Hello ' + String.fromCharCode(36) + '{{ github.event.issue.title }}"',
      ].join('\n');

      const violations = scanWorkflowSecurity(malicious, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
      expect(violations[0].snippet).toContain('github.event.issue.title');
    });

    it('detects and blocks run injection inside job named env or with', () => {
      const maliciousJobEnv = [
        'jobs:',
        '  env:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo "' + String.fromCharCode(36) + '{{ github.actor }}"',
        '  with:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo "' + String.fromCharCode(36) + '{{ inputs.name }}"',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousJobEnv, 'test.yml');
      expect(violations).toHaveLength(2);
      expect(violations.every((v) => v.rule === 'NO_RUN_INJECTION')).toBe(true);
    });

    it('detects and blocks hyphen/dash-prefixed single-line run commands', () => {
      const malicious = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: -e echo "' + String.fromCharCode(36) + '{{ github.actor }}"',
        '      - run: --flag "' + String.fromCharCode(36) + '{{ inputs.name }}"',
      ].join('\n');

      const violations = scanWorkflowSecurity(malicious, 'test.yml');
      expect(violations).toHaveLength(2);
      expect(violations.every((v) => v.rule === 'NO_RUN_INJECTION')).toBe(true);
    });

    it('detects and blocks flow-style YAML mapping run steps', () => {
      const maliciousFlow = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - { run: "echo ' + String.fromCharCode(36) + '{{ github.actor }}" }',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousFlow, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
    });

    it('detects and blocks multiline flow mapping with subsequent run key', () => {
      const maliciousMultilineFlow = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - { name: test,',
        '          a: 1, run: "echo ' + String.fromCharCode(36) + '{{ github.actor }}" }',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousMultilineFlow, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
    });

    it('detects and blocks YAML anchor and alias smuggling for run command', () => {
      const maliciousAnchor = [
        'vars: &s echo "' + String.fromCharCode(36) + '{{ github.actor }}"',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: *s',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousAnchor, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
    });

    it('detects and blocks container-level sequence alias smuggling (steps: *my_steps)', () => {
      const containerAlias = [
        'x: &my_steps',
        '  - name: step1',
        '    run: echo "Hello ' + String.fromCharCode(36) + '{{ github.actor }}"',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps: *my_steps',
      ].join('\n');

      const violations = scanWorkflowSecurity(containerAlias, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
    });

    it('detects and blocks YAML anchor and alias smuggling for secrets: inherit', () => {
      const maliciousSecretsAnchor = [
        's: &s inherit',
        'jobs:',
        '  t:',
        '    uses: ./.github/workflows/reusable.yml',
        '    secrets: *s',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousSecretsAnchor, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_SECRETS_INHERIT');
    });

    it('detects and blocks secrets: inherit in jobs named on, with, or env', () => {
      const maliciousJobNames = [
        'jobs:',
        '  on:',
        '    uses: ./.github/workflows/reusable.yml',
        '    secrets: inherit',
        '  with:',
        '    uses: ./.github/workflows/reusable.yml',
        '    secrets: inherit',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousJobNames, 'test.yml');
      expect(violations).toHaveLength(2);
      expect(violations.every((v) => v.rule === 'NO_SECRETS_INHERIT')).toBe(true);
    });

    it('detects and blocks multiline plain scalar folding', () => {
      const maliciousPlain = [
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo "hello',
        '          ' + String.fromCharCode(36) + '{{ github.actor }}"',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousPlain, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
    });

    it('detects and blocks expressions in multiline run shell comment lines', () => {
      const maliciousComment = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: |',
        '          # echo "' + String.fromCharCode(36) + '{{ github.actor }}"',
        '          echo "safe"',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousComment, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
    });

    it('detects and blocks index bracket syntax in run', () => {
      const malicious = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo "Hello ' + String.fromCharCode(36) + "{{ github['event']['issue']['title'] }}\"",
      ].join('\n');

      const violations = scanWorkflowSecurity(malicious, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
    });

    it('detects and blocks function-wrapped expressions (tojson, format, replace, join)', () => {
      const malicious = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: |',
        '          node -e "console.log(' + String.fromCharCode(36) + '{{ tojson(github.event) }})"',
        '      - run: echo "' + String.fromCharCode(36) + "{{ replace(github.event.issue.title, 'a', 'b') }}\"",
      ].join('\n');

      const violations = scanWorkflowSecurity(malicious, 'test.yml');
      expect(violations).toHaveLength(2);
      expect(violations.every((v) => v.rule === 'NO_RUN_INJECTION')).toBe(true);
    });

    it('detects and blocks explicit YAML block indentation indicators (e.g. run: |2 or run: >2-)', () => {
      const maliciousIndentIndicator = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: |2',
        '          echo "' + String.fromCharCode(36) + '{{ matrix.target }}"',
        '      - run: >2-',
        '          echo "' + String.fromCharCode(36) + '{{ github.actor }}"',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousIndentIndicator, 'test.yml');
      expect(violations).toHaveLength(2);
      expect(violations.every((v) => v.rule === 'NO_RUN_INJECTION')).toBe(true);
    });

    it('detects and blocks matrix, secrets, vars, and runner in run step', () => {
      const malicious = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo "' + String.fromCharCode(36) + '{{ matrix.target }}"',
        '      - run: echo "' + String.fromCharCode(36) + '{{ secrets.MY_SECRET }}"',
        '      - run: echo "' + String.fromCharCode(36) + '{{ vars.MY_VAR }}"',
      ].join('\n');

      const violations = scanWorkflowSecurity(malicious, 'test.yml');
      expect(violations).toHaveLength(3);
      expect(violations.every((v) => v.rule === 'NO_RUN_INJECTION')).toBe(true);
    });

    it('detects and blocks bare context expressions', () => {
      const malicious = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo "' + String.fromCharCode(36) + '{{ github }}"',
      ].join('\n');

      const violations = scanWorkflowSecurity(malicious, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
    });

    it('detects and blocks quoted run keys', () => {
      const malicious = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        "      - 'run': echo \"" + String.fromCharCode(36) + '{{ github.head_ref }}"',
      ].join('\n');

      const violations = scanWorkflowSecurity(malicious, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
    });

    it('detects and blocks unquoted and quoted secrets: inherit in caller jobs', () => {
      const unquoted = [
        'name: Caller',
        'jobs:',
        '  sub:',
        '    uses: ./.github/workflows/reusable.yml',
        '    secrets: inherit',
      ].join('\n');

      const doubleQuoted = [
        'name: Caller',
        'jobs:',
        '  sub:',
        '    uses: ./.github/workflows/reusable.yml',
        '    secrets: "inherit"',
      ].join('\n');

      const singleQuoted = [
        'name: Caller',
        'jobs:',
        '  sub:',
        '    uses: ./.github/workflows/reusable.yml',
        "    secrets: 'inherit'",
      ].join('\n');

      expect(scanWorkflowSecurity(unquoted)).toHaveLength(1);
      expect(scanWorkflowSecurity(doubleQuoted)).toHaveLength(1);
      expect(scanWorkflowSecurity(singleQuoted)).toHaveLength(1);
    });

    it('detects and blocks injections in composite action.yml files', () => {
      const maliciousAction = [
        'name: Composite Action',
        'runs:',
        '  using: composite',
        '  steps:',
        '    - run: echo "' + String.fromCharCode(36) + '{{ inputs.registry_url }}"',
        '      shell: bash',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousAction, 'action.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
    });

    it('allows safe environment variable bindings for dynamic values even after run block', () => {
      const safe = [
        'name: Safe Workflow',
        'on:',
        '  workflow_dispatch:',
        '    inputs:',
        '      version:',
        '        type: string',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Safe step',
        '        run: |',
        '          echo "Deploying version: $VERSION for event: $EVENT_NAME using $MATRIX_SCRIPT"',
        '        env:',
        '          VERSION: ' + String.fromCharCode(36) + '{{ inputs.version }}',
        '          EVENT_NAME: ' + String.fromCharCode(36) + '{{ github.event_name }}',
        '          MATRIX_SCRIPT: ' + String.fromCharCode(36) + '{{ matrix.script }}',
      ].join('\n');

      expect(scanWorkflowSecurity(safe)).toHaveLength(0);
    });

    it('allows environment variable named run in env: mapping without false positive', () => {
      const envWithRunVar = [
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Safe step',
        '        env:',
        '          run: ' + String.fromCharCode(36) + '{{ github.actor }}',
        '        run: echo "$run"',
      ].join('\n');

      expect(scanWorkflowSecurity(envWithRunVar)).toHaveLength(0);
    });

    it('allows matrix configuration with run key and with parameter named secrets', () => {
      const safeMatrixAndWith = [
        'on:',
        '  workflow_call:',
        '    secrets:',
        '      inherit:',
        '        description: Secret declaration',
        'jobs:',
        '  t:',
        '    strategy:',
        '      matrix:',
        '        include:',
        '          - run: ' + String.fromCharCode(36) + '{{ needs.a.outputs.x }}',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '        with:',
        '          secrets: inherit',
        '      - run: echo "safe"',
      ].join('\n');

      expect(scanWorkflowSecurity(safeMatrixAndWith)).toHaveLength(0);
    });
  });
});
