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

/**
 * Scans a workflow or composite action file for 'secrets: inherit' and script expression injections in 'run:' steps.
 */
export function scanWorkflowSecurity(content: string, filename = 'workflow.yml'): WorkflowViolation[] {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const violations: WorkflowViolation[] = [];

  // 1. Guard against secrets: inherit (with or without quotes)
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
  // Catches:
  // - Property access: ${{ github.event... }}, ${{ inputs.tag }}
  // - Index syntax: ${{ github['event']... }}, ${{ inputs['tag'] }}
  // - Dynamic contexts: ${{ env.X }}, ${{ steps.X.outputs.Y }}, ${{ needs.X.outputs.Y }}
  // - Function wrappers: ${{ toJSON(github) }}, ${{ format('{0}', inputs.val) }}
  const injectionRegex = /\$\{\{\s*(?:(?:github|inputs|env|steps|needs)(?:\.|\[|\s)|(?:toJSON|format|fromJSON)\s*\()/;

  let inRun = false;
  let runIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip full-line comments
    if (trimmed.startsWith('#')) {
      continue;
    }

    const multiLineRunStartMatch = line.match(/^(\s*)(?:-\s+)?run:\s*[|>-][+-]?\s*(?:#.*)?$/);
    const singleLineRunMatch = line.match(/^(\s*)(?:-\s+)?run:\s*([^|>-].*)$/);

    if (multiLineRunStartMatch) {
      inRun = true;
      runIndent = line.search(/\S/);
    } else if (singleLineRunMatch) {
      inRun = false;
      const scriptContent = singleLineRunMatch[2];
      if (injectionRegex.test(scriptContent)) {
        violations.push({
          file: filename,
          line: i + 1,
          rule: 'NO_RUN_INJECTION',
          message:
            'Direct interpolation of expressions in run: step detected. Pass dynamic values via env: variables instead.',
          snippet: line.trim(),
        });
      }
    } else if (inRun) {
      if (trimmed.length === 0) {
        continue;
      }
      const lineIndent = line.search(/\S/);
      if (lineIndent > runIndent) {
        if (injectionRegex.test(line)) {
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

    it('detects and blocks function-wrapped expressions in multiline run', () => {
      const malicious = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: |',
        '          node -e "console.log(' + String.fromCharCode(36) + '{{ toJSON(github.event) }})"',
      ].join('\n');

      const violations = scanWorkflowSecurity(malicious, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
    });

    it('detects and blocks format function wrapped expressions', () => {
      const malicious = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo "' + String.fromCharCode(36) + "{{ format('{0}', inputs.npm_tag) }}\"",
      ].join('\n');

      const violations = scanWorkflowSecurity(malicious, 'test.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
    });

    it('detects and blocks env and step outputs directly in run step', () => {
      const malicious = [
        'name: Test',
        'jobs:',
        '  t:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo "' + String.fromCharCode(36) + '{{ env.DYNAMIC_VAL }}"',
        '      - run: echo "' + String.fromCharCode(36) + '{{ steps.step1.outputs.data }}"',
      ].join('\n');

      const violations = scanWorkflowSecurity(malicious, 'test.yml');
      expect(violations).toHaveLength(2);
      expect(violations.every((v) => v.rule === 'NO_RUN_INJECTION')).toBe(true);
    });

    it('detects and blocks unquoted secrets: inherit', () => {
      const malicious = [
        'name: Caller',
        'jobs:',
        '  sub:',
        '    uses: ./.github/workflows/reusable.yml',
        '    secrets: inherit',
      ].join('\n');

      const violations = scanWorkflowSecurity(malicious, 'caller.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_SECRETS_INHERIT');
    });

    it('detects and blocks quoted secrets: "inherit"', () => {
      const maliciousDoubleQuotes = [
        'name: Caller',
        'jobs:',
        '  sub:',
        '    uses: ./.github/workflows/reusable.yml',
        '    secrets: "inherit"',
      ].join('\n');

      const maliciousSingleQuotes = [
        'name: Caller',
        'jobs:',
        '  sub:',
        '    uses: ./.github/workflows/reusable.yml',
        "    secrets: 'inherit'",
      ].join('\n');

      expect(scanWorkflowSecurity(maliciousDoubleQuotes)).toHaveLength(1);
      expect(scanWorkflowSecurity(maliciousSingleQuotes)).toHaveLength(1);
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
        '        run: |',
        '          echo "Deploying version: $VERSION for event: $EVENT_NAME"',
      ].join('\n');

      expect(scanWorkflowSecurity(safe)).toHaveLength(0);
    });
  });
});
