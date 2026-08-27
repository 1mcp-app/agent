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
 * Scans a workflow file content for 'secrets: inherit' and script expression injections in 'run:' steps.
 */
export function scanWorkflowSecurity(content: string, filename = 'workflow.yml'): WorkflowViolation[] {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const violations: WorkflowViolation[] = [];

  // 1. Guard against secrets: inherit
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*secrets:\s*inherit\b/i.test(line)) {
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
  // Matches expressions like ${{ github.* }} or ${{ inputs.* }} inside run scripts
  const injectionRegex = /\$\{\{\s*(?:github|inputs)\.[^}]+\}\}/;

  let inRun = false;
  let runIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const multiLineRunStartMatch = line.match(/^(\s*)run:\s*[|>-][+-]?\s*$/);
    const singleLineRunMatch = line.match(/^(\s*)run:\s*([^|>-].*)$/);

    if (multiLineRunStartMatch) {
      inRun = true;
      runIndent = multiLineRunStartMatch[1].length;
    } else if (singleLineRunMatch) {
      inRun = false;
      const scriptContent = singleLineRunMatch[2];
      if (injectionRegex.test(scriptContent)) {
        violations.push({
          file: filename,
          line: i + 1,
          rule: 'NO_RUN_INJECTION',
          message:
            'Direct interpolation of github.* or inputs.* in run: step detected. Pass dynamic values via env: variables instead.',
          snippet: line.trim(),
        });
      }
    } else if (inRun) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        // empty line inside block scalar
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
              'Direct interpolation of github.* or inputs.* in run: step detected. Pass dynamic values via env: variables instead.',
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

function getWorkflowFiles(): { name: string; fullPath: string; content: string }[] {
  const workflowsDir = path.join(process.cwd(), '.github', 'workflows');
  if (!fs.existsSync(workflowsDir)) {
    return [];
  }
  return fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((name) => {
      const fullPath = path.join(workflowsDir, name);
      return {
        name,
        fullPath,
        content: fs.readFileSync(fullPath, 'utf8'),
      };
    });
}

describe('GitHub Actions Workflow Security Gate', () => {
  const workflows = getWorkflowFiles();

  it('discovers and verifies all repository workflow files exist', () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  describe('Repository workflows security invariants', () => {
    workflows.forEach(({ name, content }) => {
      it('enforces security rules on ' + name, () => {
        const violations = scanWorkflowSecurity(content, name);
        expect(
          violations,
          'Security violations found in ' +
            name +
            ':\n' +
            violations.map((v) => '  Line ' + v.line + ' [' + v.rule + ']: ' + v.snippet).join('\n'),
        ).toEqual([]);
      });
    });
  });

  describe('Negative test cases (regression detection)', () => {
    it('detects and blocks direct expression interpolation in single-line run', () => {
      const maliciousWorkflow = [
        'name: Malicious Workflow',
        'jobs:',
        '  test:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Injected step',
        '        run: echo "Hello ' + String.fromCharCode(36) + '{{ github.event.issue.title }}"',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousWorkflow, 'malicious.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
      expect(violations[0].line).toBe(7);
      expect(violations[0].snippet).toContain('github.event.issue.title');
    });

    it('detects and blocks direct expression interpolation in multiline run block', () => {
      const maliciousWorkflow = [
        'name: Malicious Workflow',
        'jobs:',
        '  test:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Multiline injected step',
        '        run: |',
        '          set -e',
        '          echo "Branch is ' + String.fromCharCode(36) + '{{ github.head_ref }}"',
        '          node run.js',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousWorkflow, 'malicious.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
      expect(violations[0].line).toBe(9);
      expect(violations[0].snippet).toContain('github.head_ref');
    });

    it('detects and blocks direct inputs interpolation in run step', () => {
      const maliciousWorkflow = [
        'name: Malicious Workflow',
        'on:',
        '  workflow_dispatch:',
        '    inputs:',
        '      npm_tag:',
        '        type: string',
        'jobs:',
        '  publish:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Publish step',
        '        run: npm publish --tag ' + String.fromCharCode(36) + '{{ inputs.npm_tag }}',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousWorkflow, 'malicious.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_RUN_INJECTION');
      expect(violations[0].line).toBe(12);
    });

    it('detects and blocks secrets: inherit', () => {
      const maliciousWorkflow = [
        'name: Secrets Inherit Workflow',
        'jobs:',
        '  reusable:',
        '    uses: ./.github/workflows/reusable.yml',
        '    secrets: inherit',
      ].join('\n');

      const violations = scanWorkflowSecurity(maliciousWorkflow, 'reusable-caller.yml');
      expect(violations).toHaveLength(1);
      expect(violations[0].rule).toBe('NO_SECRETS_INHERIT');
      expect(violations[0].line).toBe(5);
    });

    it('allows safe environment variable bindings for dynamic values', () => {
      const safeWorkflow = [
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
        '      - name: Safe publish step',
        '        env:',
        '          VERSION: ' + String.fromCharCode(36) + '{{ inputs.version }}',
        '          EVENT_NAME: ' + String.fromCharCode(36) + '{{ github.event_name }}',
        '        run: |',
        '          echo "Deploying version: $VERSION for event: $EVENT_NAME"',
      ].join('\n');

      const violations = scanWorkflowSecurity(safeWorkflow, 'safe.yml');
      expect(violations).toHaveLength(0);
    });
  });
});
