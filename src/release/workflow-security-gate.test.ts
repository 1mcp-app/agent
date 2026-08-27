import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

export interface WorkflowViolation {
  file: string;
  line: number;
  rule: 'NO_SECRETS_INHERIT' | 'NO_RUN_INJECTION';
  message: string;
  snippet: string;
}

/**
 * Scans a workflow or composite action file for 'secrets: inherit' and script expression injections in 'run:' steps.
 * Uses standard YAML AST parsing (supporting anchors, aliases, flow mappings, and block scalars).
 */
export function scanWorkflowSecurity(content: string, filename = 'workflow.yml'): WorkflowViolation[] {
  const violations: WorkflowViolation[] = [];
  const expressionPattern = /\$\{\{/;

  const lineCounter = new YAML.LineCounter();
  let doc: YAML.Document;
  try {
    doc = YAML.parseDocument(content, { lineCounter });
  } catch (e) {
    violations.push({
      file: filename,
      line: 1,
      rule: 'NO_RUN_INJECTION',
      message: 'YAML Parse Error: ' + (e instanceof Error ? e.message : String(e)),
      snippet: content.split('\n')[0] || '',
    });
    return violations;
  }

  if (doc.errors && doc.errors.length > 0) {
    for (const err of doc.errors) {
      violations.push({
        file: filename,
        line: err.linePos ? err.linePos[0].line : 1,
        rule: 'NO_RUN_INJECTION',
        message: 'YAML Syntax Error: ' + err.message,
        snippet: err.message,
      });
    }
    return violations;
  }

  YAML.visit(doc, {
    Pair(key, node) {
      if (!node.key) return;

      const keyNode = node.key as { value?: unknown };
      const keyVal = keyNode.value;
      const valNode = node.value as { range?: [number, number, number]; value?: unknown } | null;

      // 1. Guard against secrets: inherit
      if (typeof keyVal === 'string' && keyVal.toLowerCase() === 'secrets' && valNode) {
        const val = typeof valNode.value === 'string' ? valNode.value : String(node.value);
        if (typeof val === 'string' && val.toLowerCase().trim() === 'inherit') {
          const pos = valNode.range ? lineCounter.linePos(valNode.range[0]) : { line: 1, col: 1 };
          violations.push({
            file: filename,
            line: pos.line,
            rule: 'NO_SECRETS_INHERIT',
            message: "Forbidden 'secrets: inherit' detected. Secrets must be explicitly mapped by name or use OIDC.",
            snippet: 'secrets: ' + val,
          });
        }
      }

      // 2. Guard against run injections
      if (keyVal === 'run' && valNode) {
        let scriptVal = '';
        if (YAML.isAlias(node.value)) {
          const resolved = node.value.resolve(doc) as { value?: unknown } | null;
          scriptVal = resolved ? (typeof resolved.value === 'string' ? resolved.value : String(resolved)) : '';
        } else if (typeof valNode.value === 'string') {
          scriptVal = valNode.value;
        } else {
          scriptVal = String(node.value);
        }

        if (expressionPattern.test(scriptVal)) {
          const pos = valNode.range ? lineCounter.linePos(valNode.range[0]) : { line: 1, col: 1 };
          violations.push({
            file: filename,
            line: pos.line,
            rule: 'NO_RUN_INJECTION',
            message:
              'Direct interpolation of expressions in run: step detected. Pass dynamic values via env: variables instead.',
            snippet: scriptVal.split('\n')[0].trim(),
          });
        }
      }
    },
  });

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

    it('detects and blocks YAML anchor and alias smuggling', () => {
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
  });
});
