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
 * @returns File content as a UTF-8 string.
 */
function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
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
 *
 * @returns Array of relative paths to CI YAML files.
 */
function getCiYamlFiles(): string[] {
  const files: string[] = [];

  const workflowsDir = path.join(process.cwd(), '.github', 'workflows');
  if (fs.existsSync(workflowsDir)) {
    for (const file of fs.readdirSync(workflowsDir)) {
      if (file.endsWith('.yml') || file.endsWith('.yaml')) {
        files.push(path.join('.github', 'workflows', file));
      }
    }
  }

  const actionsDir = path.join(process.cwd(), '.github', 'actions');
  if (fs.existsSync(actionsDir)) {
    const scanActions = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanActions(full);
        } else if (entry.name === 'action.yml' || entry.name === 'action.yaml') {
          files.push(path.relative(process.cwd(), full));
        }
      }
    };
    scanActions(actionsDir);
  }

  return files;
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

  it('validates security policy invariants across all workflows and composite actions', () => {
    const fixturesDir = path.join(process.cwd(), 'test', 'fixtures', 'ci-security');
    const injectFixture = fs.readFileSync(path.join(fixturesDir, 'inject-expression.yml'), 'utf8');
    const unquotedFixture = fs.readFileSync(path.join(fixturesDir, 'unquoted-var.yml'), 'utf8');
    const secretsFixture = fs.readFileSync(path.join(fixturesDir, 'secrets-inherit.yml'), 'utf8');
    const permsFixture = fs.readFileSync(path.join(fixturesDir, 'excessive-permissions.yml'), 'utf8');

    expect(injectFixture).toMatch(/\$\{\{\s*github\.event\.issue\.title\s*\}\}/);
    expect(unquotedFixture).toMatch(/run:\s*pnpm \$BUILD_SCRIPT/);
    expect(secretsFixture).toMatch(/secrets:\s*inherit/);
    expect(permsFixture).toMatch(/permissions:\s*write-all/);

    const ciFiles = getCiYamlFiles();
    expect(ciFiles.length).toBeGreaterThan(0);

    for (const relFile of ciFiles) {
      const content = readRepoFile(relFile);
      const parsed = YAML.parse(content) as {
        permissions?: string | Record<string, string>;
        jobs?: Record<
          string,
          { permissions?: string | Record<string, string>; secrets?: string; steps?: { run?: string }[] }
        >;
        runs?: { steps?: { run?: string }[] };
      };

      // Ensure write-all permissions are not used
      expect(parsed?.permissions, `${relFile}: top-level permissions must not be write-all`).not.toBe('write-all');
      expect(content).not.toMatch(/permissions:\s*write-all/);

      // Ensure secrets: inherit is not used
      expect(content).not.toMatch(/secrets:\s*inherit/);

      // Collect all step run blocks and ensure github.event.* expressions are not directly interpolated
      const steps: { run?: string }[] = [...(parsed?.runs?.steps ?? [])];
      for (const job of Object.values(parsed?.jobs ?? {})) {
        if (job?.steps) {
          steps.push(...job.steps);
        }
      }

      for (const step of steps) {
        if (typeof step?.run === 'string') {
          expect(
            step.run,
            `${relFile}: run step must not interpolate direct untrusted github.event context`,
          ).not.toMatch(/\$\{\{\s*github\.event/);
        }
      }
    }
  });
});
