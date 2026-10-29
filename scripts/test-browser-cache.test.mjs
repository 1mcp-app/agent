import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { getTestBrowserCachePath, isolatedTestEnvironment } from './test-process-environment.mjs';

describe('Playwright browser cache across isolated homes', () => {
  it.each([
    ['linux', { HOME: '/original' }, '/original/.cache/ms-playwright'],
    ['linux', { HOME: '/original', XDG_CACHE_HOME: '/cache' }, '/cache/ms-playwright'],
    ['darwin', { HOME: '/original' }, '/original/Library/Caches/ms-playwright'],
    ['win32', { USERPROFILE: 'C:\\Users\\operator' }, 'C:\\Users\\operator\\AppData\\Local\\ms-playwright'],
    ['win32', { LOCALAPPDATA: 'C:\\cache' }, 'C:\\cache\\ms-playwright'],
    ['linux', { PLAYWRIGHT_BROWSERS_PATH: '0' }, '0'],
    ['linux', { PLAYWRIGHT_BROWSERS_PATH: '/installed' }, '/installed'],
    ['linux', { PLAYWRIGHT_BROWSERS_PATH: 'browsers', INIT_CWD: '/workspace' }, '/workspace/browsers'],
    ['linux', { npm_config_playwright_browsers_path: '0' }, '0'],
  ])('keeps the installed location for %s with %j', (platform, env, expected) => {
    expect(getTestBrowserCachePath(env, platform, '/working')).toBe(expected);
  });

  it.each([undefined, '0', '/fixture/browsers'])(
    'matches pinned Playwright resolution before and after HOME isolation (%s)',
    (configured) => {
      const base = { ...process.env, HOME: '/fixture/original-home', USERPROFILE: '/fixture/original-home' };
      delete base.PLAYWRIGHT_BROWSERS_PATH;
      delete base.npm_config_playwright_browsers_path;
      delete base.npm_package_config_playwright_browsers_path;
      if (configured !== undefined) base.PLAYWRIGHT_BROWSERS_PATH = configured;
      const isolated = isolatedTestEnvironment(base);
      const executable = (env) => {
        const result = spawnSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            "import { chromium } from 'playwright'; console.log(chromium.executablePath());",
          ],
          { env, encoding: 'utf8', timeout: 10000 },
        );
        expect(result.status, result.stderr).toBe(0);
        return result.stdout.trim();
      };
      try {
        expect(isolated.env.HOME).not.toBe(base.HOME);
        expect(executable(isolated.env)).toBe(executable(base));
      } finally {
        isolated.cleanup();
      }
    },
  );
});
