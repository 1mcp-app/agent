import { expect, it, vi } from 'vitest';

import { codeGraphEnvironment } from './codegraphEnvironment.js';

vi.mock('../../config/runtimeBootstrap.js', () => ({
  getRuntimeParentEnvironment: () => ({
    HOME: '/home/fixture',
    PATH: '/installed/bin',
    KEEP_ME: 'yes',
    GIT_DIR: '/foreign/repo',
    GIT_WORK_TREE: '/foreign/work',
    GIT_INDEX_FILE: '/foreign/index',
    GIT_COMMON_DIR: '/foreign/common',
    GIT_CONFIG_PARAMETERS: "'core.fsmonitor=/foreign/hook'",
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: '/foreign/hook',
    GIT_CONFIG_KEY_1: 'core.fsmonitor',
    GIT_CONFIG_VALUE_1: '/another/hook',
    GIT_CONFIG_GLOBAL: '/configured/global',
    GIT_CONFIG_SYSTEM: '/configured/system',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG: '/configured/legacy',
    GIT_CONFIG_CUSTOM: 'preserved',
  }),
}));

it('confines inherited Git commands to the target without invoking fsmonitor hooks or changing user preference', () => {
  const env = codeGraphEnvironment();
  expect(env.GIT_DIR).toBeUndefined();
  expect(env.GIT_WORK_TREE).toBeUndefined();
  expect(env.GIT_INDEX_FILE).toBeUndefined();
  expect(env.GIT_COMMON_DIR).toBeUndefined();
  expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined();
  expect(env.GIT_CONFIG_COUNT).toBe('1');
  expect(env.GIT_CONFIG_KEY_0).toBe('core.fsmonitor');
  expect(env.GIT_CONFIG_VALUE_0).toBe('false');
  expect(env.GIT_CONFIG_KEY_1).toBeUndefined();
  expect(env.GIT_CONFIG_VALUE_1).toBeUndefined();
  expect(env.GIT_OPTIONAL_LOCKS).toBe('0');
  expect(env.KEEP_ME).toBe('yes');
});

it('preserves normal Git configuration selectors while overriding only command-scoped injections', () => {
  const env = codeGraphEnvironment();
  expect(env.GIT_CONFIG_GLOBAL).toBe('/configured/global');
  expect(env.GIT_CONFIG_SYSTEM).toBe('/configured/system');
  expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
  expect(env.GIT_CONFIG).toBe('/configured/legacy');
  expect(env.GIT_CONFIG_CUSTOM).toBe('preserved');
});
