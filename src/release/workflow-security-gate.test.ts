import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

export interface WorkflowViolation {
  file: string;
  line: number;
  rule: 'NO_SECRETS_INHERIT' | 'NO_RUN_INJECTION';
  message: string;
  snippet: string;
}

export function scanWorkflowSecurity(content: string, filename = 'workflow.yml'): WorkflowViolation[] {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const violations: WorkflowViolation[] = [];

  // 1. Guard against secrets: inherit (quoted or unquoted)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*secrets:\s*["']?inherit["']?\b/i.test(line)) {
      violations.push({
        file: filename,
        line: i + 1,
        rule: 'NO_SECRETS_INHERIT',
        message: "Forbidden 'secrets: inherit' detected. Secrets must be explicitly mapped by name or use OIDC.",
        snippet: line.trim(),
      });
    }
  }

  // 2. Guard against direct expression injection in run: steps
  // Any ${{ ... }} interpolation inside a run: step is banned to prevent shell injection.
  const expressionPattern = /\$\{\{/;
  let inRun = false;
  let runIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // If currently inside a multiline run block scalar (e.g. run: |), evaluate all lines
    // including comment lines (since GitHub Actions evaluates expressions before executing shell)
    if (inRun) {
      if (trimmed.length === 0) {
        continue;
      }
      const lineIndent = line.search(/\S/);
      if (lineIndent > runIndent) {
        if (expressionPattern.test(line)) {
          violations.push({
            file: filename,
            line: i + 1,
            rule: 'NO_RUN_INJECTION',
            message:
              'Direct interpolation of expressions in run: step detected. Pass dynamic values via env: variables instead.',
            snippet: line.trim(),
          });
        }
      } else {
        inRun = false;
      }
    }

    if (!inRun) {
      // Top-level YAML comments are skipped
      if (trimmed.startsWith('#')) {
        continue;
      }

      // Match run: block headers including YAML block indentation indicators (e.g. 'run: |2', 'run: >-', 'run: |2-', etc.)
      const multiLineRunStartMatch = line.match(/^(\s*)(?:-\s+)?['"]?run['"]?:\s*[|>][0-9+-]*\s*(?:#.*)?$/i);
      // Match standard single-line run commands
      const singleLineRunMatch = line.match(/^(\s*)(?:-\s+)?['"]?run['"]?:\s*(.+)$/i);
      // Match YAML flow-style mapping (e.g. '- { run: ... }', '- { name: test, run: ... }')
      const flowStyleRunMatch = line.match(/\{[^{}]*\b['"]?run['"]?\s*:\s*([^,}]+)/i);

      if (multiLineRunStartMatch) {
        inRun = true;
        runIndent = line.search(/\S/);
      } else if (singleLineRunMatch) {
        const scriptContent = singleLineRunMatch[2];
        if (expressionPattern.test(scriptContent)) {
          violations.push({
            file: filename,
            line: i + 1,
            rule: 'NO_RUN_INJECTION',
            message:
              'Direct interpolation of expressions in run: step detected. Pass dynamic values via env: variables instead.',
            snippet: line.trim(),
          });
        }
      } else if (flowStyleRunMatch) {
        const scriptContent = flowStyleRunMatch[1];
        if (expressionPattern.test(scriptContent)) {
          violations.push({
            file: filename,
            line: i + 1,
            rule: 'NO_RUN_INJECTION',
            message:
              'Direct interpolation of expressions in run: step detected. Pass dynamic values via env: variables instead.',
            snippet: line.trim(),
          });
        }
      }
    }
  }

  return violations;
}

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

    it('detects and blocks unquoted and quoted secrets: inherit', () => {
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

    it('allows safe environment variable bindings for dynamic values', () => {
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
        '        env:',
        '          VERSION: ' + String.fromCharCode(36) + '{{ inputs.version }}',
        '          EVENT_NAME: ' + String.fromCharCode(36) + '{{ github.event_name }}',
        '          MATRIX_SCRIPT: ' + String.fromCharCode(36) + '{{ matrix.script }}',
        '        run: |',
        '          echo "Deploying version: $VERSION for event: $EVENT_NAME using $MATRIX_SCRIPT"',
      ].join('\n');

      expect(scanWorkflowSecurity(safe)).toHaveLength(0);
    });
  });
});
