import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCliContext, generateStreamableSessionId } from './cliContext.js';

describe('buildCliContext', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('builds a base context with command metadata', () => {
    vi.stubGlobal('process', {
      ...process,
      cwd: () => '/tmp/project-a',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        USER: 'tester',
        HOME: '/Users/tester',
      },
    });

    const context = buildCliContext({
      transportType: 'inspect',
      version: 'inspect',
    });

    expect(context).toMatchObject({
      project: {
        path: '/tmp/project-a',
        name: 'project-a',
        environment: 'test',
      },
      user: {
        username: 'tester',
        home: '/Users/tester',
      },
      environment: {
        variables: expect.objectContaining({
          PWD: '/tmp/project-a',
          PLATFORM: process.platform,
        }),
      },
      transport: {
        type: 'inspect',
      },
      version: 'inspect',
    });
  });

  it('merges project context overrides and prefixed environment variables', () => {
    vi.stubGlobal('process', {
      ...process,
      cwd: () => '/tmp/project-b',
      env: {
        ...process.env,
        USER: 'tester',
        HOME: '/Users/tester',
        ACME_TOKEN: 'secret',
        ACME_REGION: 'us-east-1',
        OTHER_VAR: 'ignore-me',
      },
    });

    const context = buildCliContext({
      transportType: 'run',
      version: 'run',
      sessionId: 'session-1',
      projectConfig: {
        context: {
          environment: 'staging',
          projectId: 'proj_123',
          team: 'platform',
          custom: {
            tier: 'gold',
          },
          envPrefixes: ['ACME_'],
        },
      },
    });

    expect(context).toMatchObject({
      project: {
        environment: 'staging',
        custom: {
          projectId: 'proj_123',
          team: 'platform',
          tier: 'gold',
        },
      },
      environment: {
        variables: expect.objectContaining({
          ACME_TOKEN: 'secret',
          ACME_REGION: 'us-east-1',
        }),
      },
      sessionId: 'session-1',
    });
    expect(context.environment.variables?.OTHER_VAR).toBeUndefined();
  });
});

describe('generateStreamableSessionId', () => {
  it('uses the streamable session prefix', () => {
    expect(generateStreamableSessionId()).toMatch(/^stream-/);
  });
});
