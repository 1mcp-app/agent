import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

const BROWSER_TEST_SUFFIX = '.browser.e2e.test.ts';
const PLAYWRIGHT_IMPORT = /(?:from\s+|require\(\s*|import\(\s*)['"](?:@playwright\/test|playwright(?:-core)?)['"]/;

/**
 * Reads a file relative to the repository root directory.
 *
 * @param relativePath - Relative path from workspace root.
 * @returns File content as a UTF-8 string with normalized line endings.
 */
function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Recursively locates all test files within a given directory.
 *
 * @param directory - Root directory to begin search.
 * @returns Array of absolute paths to .test.ts files.
 */
function findTestFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return findTestFiles(entryPath);
    }

    return entry.name.endsWith('.test.ts') ? [entryPath] : [];
  });
}

/**
 * Collects all GitHub workflow and composite action YAML files in the repository.
 * Scans repository-wide for all action.yml / action.yaml while skipping dependency/build folders.
 *
 * @returns Array of relative paths to CI YAML files.
 */
function getCiYamlFiles(): string[] {
  const files: string[] = [];
  const root = process.cwd();
  const ignoredDirs = new Set(['node_modules', '.git', '.tmp', '.tmp-test', 'build', 'coverage', '.worktrees']);

  const scanDir = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else {
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (
          (rel.startsWith('.github/workflows/') && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) ||
          entry.name === 'action.yml' ||
          entry.name === 'action.yaml'
        ) {
          files.push(rel);
        }
      }
    }
  };

  scanDir(root);
  return [...new Set(files)].sort();
}

export interface PolicyViolation {
  file: string;
  rule: 'write-all-permissions' | 'secrets-inherit' | 'inline-expression-interpolation' | 'unquoted-shell-variable';
  detail: string;
}

/**
 * Detects whether a GitHub Actions shell command template executes a Bash or Sh shell.
 *
 * Handles standard keywords ('bash', 'sh'), absolute paths ('/bin/bash', '/usr/bin/bash', '/bin/sh'),
 * environment wrappers ('/usr/bin/env bash'), and custom parameter templates (e.g. '/bin/bash -eo pipefail {0}').
 *
 * @param shellTemplate - The shell property declared on the step.
 * @returns True if the target shell executable is bash or sh.
 */
export function isBashOrShShell(shellTemplate?: string): boolean {
  if (!shellTemplate || typeof shellTemplate !== 'string') {
    return false;
  }
  const trimmed = shellTemplate.trim();
  if (!trimmed) {
    return false;
  }

  let rawExe = '';
  if (trimmed.startsWith('"')) {
    const endQuote = trimmed.indexOf('"', 1);
    rawExe = endQuote !== -1 ? trimmed.slice(1, endQuote) : trimmed.slice(1);
  } else if (trimmed.startsWith("'")) {
    const endQuote = trimmed.indexOf("'", 1);
    rawExe = endQuote !== -1 ? trimmed.slice(1, endQuote) : trimmed.slice(1);
  } else {
    rawExe = trimmed.split(/\s+/)[0];
  }

  let baseExe = path
    .basename(rawExe.replace(/\\/g, '/'))
    .toLowerCase()
    .replace(/\.exe$/, '');
  if (baseExe === 'env') {
    const afterEnv = trimmed.replace(/^[^\s]+\s+/, '').trim();
    return isBashOrShShell(afterEnv);
  }
  return baseExe === 'bash' || baseExe === 'sh';
}

/**
 * Runs ShellCheck against a bash script snippet to detect shell quoting/expansion violations (e.g., SC2086).
 *
 * @param script - Shell script content string.
 * @returns Object indicating availability and detected violations.
 */
export function checkShellScript(script: string): { available: boolean; issues: string[] } {
  try {
    const proc = spawnSync('shellcheck', ['-s', 'bash', '-'], {
      input: script,
      encoding: 'utf8',
    });
    if (proc.error) {
      return { available: false, issues: [] };
    }
    const output = `${proc.stdout ?? ''}\n${proc.stderr ?? ''}`;
    return {
      available: true,
      issues: output
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    };
  } catch {
    return { available: false, issues: [] };
  }
}

/**
 * Evaluates a workflow or action YAML string against structural CI security policy invariants.
 *
 * @param relFile - Path identifier for the YAML file.
 * @param yamlContent - Content string of the YAML file.
 * @returns Array of detected policy violations.
 */
export function checkSecurityPolicies(relFile: string, yamlContent: string): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const parsed = YAML.parse(yamlContent) as {
    permissions?: string | Record<string, string>;
    jobs?: Record<
      string,
      { permissions?: string | Record<string, string>; secrets?: string; steps?: { run?: string }[] }
    >;
    runs?: { using?: string; steps?: { run?: string; shell?: string }[] };
  };

  // Enforce top-level security policy invariants via parsed AST (avoiding comment/string false positives)
  if (parsed?.permissions === 'write-all') {
    violations.push({
      file: relFile,
      rule: 'write-all-permissions',
      detail: 'top-level permissions: write-all is forbidden',
    });
  }

  if ((parsed as Record<string, unknown>)?.secrets === 'inherit') {
    violations.push({ file: relFile, rule: 'secrets-inherit', detail: 'top-level secrets: inherit is forbidden' });
  }

  const isCompositeAction =
    relFile.endsWith('action.yml') || relFile.endsWith('action.yaml') || parsed?.runs?.using === 'composite';

  const steps: { run?: string; shell?: string }[] = [...(parsed?.runs?.steps ?? [])];
  for (const [jobName, job] of Object.entries(parsed?.jobs ?? {})) {
    if (job?.secrets === 'inherit') {
      violations.push({
        file: relFile,
        rule: 'secrets-inherit',
        detail: `job '${jobName}' secrets: inherit is forbidden`,
      });
    }
    if (job?.permissions === 'write-all') {
      violations.push({
        file: relFile,
        rule: 'write-all-permissions',
        detail: `job '${jobName}' permissions: write-all is forbidden`,
      });
    }
    if (job?.steps) {
      steps.push(...job.steps);
    }
  }

  for (const step of steps) {
    if (typeof step?.run === 'string') {
      if (/\$\{\{/.test(step.run)) {
        violations.push({
          file: relFile,
          rule: 'inline-expression-interpolation',
          detail: `run step interpolates direct expression: ${step.run.trim()}`,
        });
      }

      // In composite actions, validate Bash/sh run steps against unquoted variable expansions.
      // Only invoke ShellCheck when parameter expansion ($) or command substitution (` or $()) is present.
      if (isCompositeAction && isBashOrShShell(step.shell)) {
        const hasVariableExpansion = /[$\x60]/.test(step.run);
        if (hasVariableExpansion) {
          const shellCheck = checkShellScript(step.run);
          if (shellCheck.available) {
            for (const issue of shellCheck.issues) {
              if (issue.includes('SC2086')) {
                violations.push({
                  file: relFile,
                  rule: 'unquoted-shell-variable',
                  detail: `composite action step has unquoted shell variable (SC2086): ${issue}`,
                });
              }
            }
          } else {
            // Fail closed when ShellCheck is unavailable
            violations.push({
              file: relFile,
              rule: 'unquoted-shell-variable',
              detail:
                'ShellCheck binary is required to analyze composite action shell steps containing variable expansions but was not found in PATH',
            });
          }
        }
      }
    }
  }

  return violations;
}

describe('test-and-validate workflow', () => {
  it('runs E2E independently and keeps test suites isolated', () => {
    const workflow = readRepoFile('.github/workflows/test-and-validate.yml');
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      scripts: Record<string, string>;
    };
    const ciJob = workflow.match(/\n\s{2}ci:\n(?<body>(?:\s{4}.*\n)+)/)?.groups?.body;
    const nonBrowserJob = workflow.match(/\n\s{2}test-e2e-parallel:\n(?<body>(?:\s{4}.*\n)+)/)?.groups?.body;
    const systemJob = workflow.match(/\n\s{2}test-e2e-system:\n(?<body>(?:\s{4}.*\n)+)/)?.groups?.body;
    const browserJob = workflow.match(/\n\s{2}test-e2e-browser:\n(?<body>(?:\s{4}.*\n)+)/)?.groups?.body;
    const checkoutCount = workflow.match(/uses: actions\/checkout@v7/g)?.length ?? 0;

    expect(ciJob).toMatch(/pnpm ci:static[\s\S]*pnpm test:unit[\s\S]*pnpm test:admin/);
    expect(packageJson.scripts['ci:static']).toContain('pnpm lint');
    expect(packageJson.scripts['ci:static']).toContain('pnpm typecheck');
    expect(packageJson.scripts['ci:static']).toContain('pnpm build');
    expect(packageJson.scripts['ci:static']).not.toContain('pnpm test:');
    expect(nonBrowserJob).toBeDefined();
    expect(nonBrowserJob).toContain('timeout-minutes: 15');
    expect(nonBrowserJob).not.toContain('needs: ci');
    expect(nonBrowserJob).not.toContain('playwright install');
    expect(nonBrowserJob).toContain('pnpm test:e2e:shardable');
    expect(systemJob).toContain('timeout-minutes: 15');
    expect(systemJob).not.toContain('needs: ci');
    expect(systemJob).toContain('pnpm test:e2e:system');
    expect(browserJob).toContain('mcr.microsoft.com/playwright:v1.61.1-noble');
    expect(browserJob).toContain('options: --ipc=host');
    expect(browserJob).toContain('timeout-minutes: 15');
    expect(checkoutCount).toBeGreaterThan(0);
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(checkoutCount);
  });

  it('routes every Playwright spec through the browser lane naming contract', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      scripts: Record<string, string>;
    };
    const e2eRoot = path.join(process.cwd(), 'test', 'e2e');
    const testFiles = findTestFiles(e2eRoot);
    const playwrightTests = testFiles.filter((file) => PLAYWRIGHT_IMPORT.test(fs.readFileSync(file, 'utf8')));
    const namedBrowserTests = testFiles.filter((file) => file.endsWith(BROWSER_TEST_SUFFIX));

    expect(playwrightTests).not.toHaveLength(0);
    expect(playwrightTests.every((file) => file.endsWith(BROWSER_TEST_SUFFIX))).toBe(true);
    expect(namedBrowserTests).not.toHaveLength(0);
    expect(packageJson.scripts['test:e2e:browser']).toContain('browser.e2e.test.ts');
    expect(packageJson.scripts['test:e2e:non-browser']).toContain('--exclude "**/*.browser.e2e.test.ts"');
    expect(packageJson.scripts['test:e2e:shardable']).toContain('--exclude "**/serve-background.test.ts"');
    expect(packageJson.scripts['test:e2e:system']).toContain('test/e2e/commands/serve-background.test.ts');
  });

  it('installs and runs actionlint binary with pinned SHA-256 digest and shellcheck in CI pipeline', () => {
    const workflow = YAML.parse(readRepoFile('.github/workflows/test-and-validate.yml')) as {
      jobs?: {
        ci?: {
          steps?: {
            name?: string;
            env?: Record<string, string>;
            run?: string;
          }[];
        };
      };
    };
    const steps = workflow?.jobs?.ci?.steps;

    expect(steps).toBeDefined();

    const runActionlintStep = steps?.find((s) => s.name === 'Run actionlint');
    expect(runActionlintStep).toBeDefined();
    expect(runActionlintStep?.env?.ACTIONLINT_VERSION).toBe('1.7.7');
    expect(runActionlintStep?.env?.ACTIONLINT_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(runActionlintStep?.run).toContain('sha256sum -c -');
    expect(runActionlintStep?.run).toContain('command -v shellcheck');
    expect(runActionlintStep?.run).toContain('echo "$PWD" >> "$GITHUB_PATH"');
    expect(runActionlintStep?.run).toContain('./actionlint -color');
  });

  it('enforces security policy invariants across all repository workflows and composite actions', () => {
    const ciFiles = getCiYamlFiles();
    expect(ciFiles.length).toBeGreaterThan(0);

    for (const relFile of ciFiles) {
      const content = readRepoFile(relFile);
      const violations = checkSecurityPolicies(relFile, content);
      expect(violations, `${relFile} must have zero security policy violations`).toEqual([]);
    }
  });

  it('exercises structural policy validator against adversarial negative fixtures', () => {
    const injectFixture = readRepoFile(path.join('test', 'fixtures', 'ci-security', 'inject-expression.yml'));
    const secretsFixture = readRepoFile(path.join('test', 'fixtures', 'ci-security', 'secrets-inherit.yml'));
    const permsFixture = readRepoFile(path.join('test', 'fixtures', 'ci-security', 'excessive-permissions.yml'));
    const unquotedFixture = readRepoFile(path.join('test', 'fixtures', 'ci-security', 'unquoted-var.yml'));
    const compositeFixture = readRepoFile(
      path.join('test', 'fixtures', 'ci-security', 'unquoted-composite-action.yml'),
    );

    // Structural policy validator catches expression injection, secrets: inherit, and excessive permissions
    const injectViolations = checkSecurityPolicies('inject-expression.yml', injectFixture);
    expect(injectViolations.some((v) => v.rule === 'inline-expression-interpolation')).toBe(true);

    const secretsViolations = checkSecurityPolicies('secrets-inherit.yml', secretsFixture);
    expect(secretsViolations.some((v) => v.rule === 'secrets-inherit')).toBe(true);

    const permsViolations = checkSecurityPolicies('excessive-permissions.yml', permsFixture);
    expect(permsViolations.some((v) => v.rule === 'write-all-permissions')).toBe(true);

    // Composite action with unquoted shell variable must be caught by composite quoting policy
    const compositeViolations = checkSecurityPolicies('action.yml', compositeFixture);
    expect(compositeViolations.some((v) => v.rule === 'unquoted-shell-variable')).toBe(true);
    if (checkShellScript('').available) {
      expect(compositeViolations.some((v) => v.detail.includes('SC2086'))).toBe(true);
    }

    // Composite action with custom absolute-path shell template (/bin/bash -eo pipefail {0}) must be caught
    const compositeAbsoluteFixture = readRepoFile(
      path.join('test', 'fixtures', 'ci-security', 'unquoted-composite-absolute-shell.yml'),
    );
    const compositeAbsoluteViolations = checkSecurityPolicies('action.yml', compositeAbsoluteFixture);
    expect(compositeAbsoluteViolations.some((v) => v.rule === 'unquoted-shell-variable')).toBe(true);
    if (checkShellScript('').available) {
      expect(compositeAbsoluteViolations.some((v) => v.detail.includes('SC2086'))).toBe(true);
    }

    // Workflow without direct expression interpolation passes structural check
    expect(checkSecurityPolicies('unquoted-var.yml', unquotedFixture)).toEqual([]);
  });

  it('exercises ShellCheck SC2086 detection for unquoted shell variable fixture', () => {
    const unquotedFixture = readRepoFile(path.join('test', 'fixtures', 'ci-security', 'unquoted-var.yml'));
    const parsed = YAML.parse(unquotedFixture) as {
      jobs?: Record<string, { steps?: { run?: string }[] }>;
    };
    const steps = Object.values(parsed?.jobs ?? {}).flatMap((j) => j.steps ?? []);
    const runScript = steps.find((s) => s.run?.includes('$BUILD_SCRIPT'))?.run ?? '';

    expect(runScript).toMatch(/pnpm \$BUILD_SCRIPT/);

    const check = checkShellScript(runScript);
    if (!check.available && !process.env.CI) {
      // Allow local development unit testing on machines without shellcheck installed
      return;
    }
    expect(check.available, 'shellcheck binary must be installed and available in CI').toBe(true);
    expect(check.issues.some((issue) => issue.includes('SC2086'))).toBe(true);
  });
  it('correctly recognizes bash/sh executables across custom shell templates', () => {
    expect(isBashOrShShell('bash')).toBe(true);
    expect(isBashOrShShell('sh')).toBe(true);
    expect(isBashOrShShell('/bin/bash')).toBe(true);
    expect(isBashOrShShell('/usr/bin/bash')).toBe(true);
    expect(isBashOrShShell('/bin/sh')).toBe(true);
    expect(isBashOrShShell('/bin/bash -eo pipefail {0}')).toBe(true);
    expect(isBashOrShShell('/usr/bin/bash -e {0}')).toBe(true);
    expect(isBashOrShShell('/usr/bin/env bash')).toBe(true);
    expect(isBashOrShShell('/usr/bin/env sh -e {0}')).toBe(true);
    expect(isBashOrShShell('"C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe" -eo pipefail {0}')).toBe(true);

    expect(isBashOrShShell('python {0}')).toBe(false);
    expect(isBashOrShShell('powershell')).toBe(false);
    expect(isBashOrShShell('pwsh')).toBe(false);
    expect(isBashOrShShell('cmd')).toBe(false);
    expect(isBashOrShShell(undefined)).toBe(false);
    expect(isBashOrShShell('')).toBe(false);
  });

  it('ignores permissions: write-all and secrets: inherit in comments and echo strings', () => {
    const benignYaml = [
      'name: Benign Workflow',
      '# Note: permissions: write-all is dangerous and forbidden',
      '# Note: secrets: inherit should never be used',
      "on: 'push'",
      'jobs:',
      '  echo-job:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - name: Echo instruction',
      '        run: \'echo "Do not use permissions: write-all or secrets: inherit"\'',
    ].join('\n');

    const violations = checkSecurityPolicies('benign.yml', benignYaml);
    expect(violations).toEqual([]);
  });

  it('flags job-level permissions: write-all and job-level secrets: inherit', () => {
    const badJobYaml = [
      'name: Bad Jobs',
      'on: push',
      'jobs:',
      '  perms-job:',
      '    runs-on: ubuntu-latest',
      '    permissions: write-all',
      '    steps:',
      '      - run: pnpm test',
      '  secrets-job:',
      '    uses: ./.github/workflows/reusable.yml',
      '    secrets: inherit',
    ].join('\n');

    const violations = checkSecurityPolicies('bad-jobs.yml', badJobYaml);
    expect(violations.some((v) => v.rule === 'write-all-permissions' && v.detail.includes('perms-job'))).toBe(true);
    expect(violations.some((v) => v.rule === 'secrets-inherit' && v.detail.includes('secrets-job'))).toBe(true);
  });

  it('permits composite action bash steps without variable expansion even if shellcheck is absent', () => {
    const literalStepAction = [
      "name: 'Literal Composite'",
      'runs:',
      '  using: composite',
      '  steps:',
      '    - run: pnpm install --frozen-lockfile',
      '      shell: bash',
    ].join('\n');

    const violations = checkSecurityPolicies('action.yml', literalStepAction);
    expect(violations).toEqual([]);
  });
});
