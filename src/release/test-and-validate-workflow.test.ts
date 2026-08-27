import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const BROWSER_TEST_SUFFIX = '.browser.e2e.test.ts';
const PLAYWRIGHT_IMPORT = /(?:from\s+|require\(\s*|import\(\s*)['"](?:@playwright\/test|playwright(?:-core)?)['"]/;

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function findTestFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return findTestFiles(entryPath);
    }

    return entry.name.endsWith('.test.ts') ? [entryPath] : [];
  });
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
  it('runs actionlint in CI to gate against workflow syntax and injection regressions', () => {
    const workflow = readRepoFile('.github/workflows/test-and-validate.yml');
    const ciJob = workflow.match(/\n\s{2}ci:\n(?<body>(?:\s{4}.*\n)+)/)?.groups?.body;

    expect(ciJob).toBeDefined();
    expect(ciJob).toContain('reviewdog/action-actionlint@v1');
    expect(ciJob).toMatch(/fail_level:\s*(?:any|error)/);
  });
});
