import type { ContextData } from '@src/types/context.js';

import { describe, expect, it } from 'vitest';

import { createContextHash } from './contextHash.js';

describe('contextHash', () => {
  const context: ContextData = {
    project: {
      name: 'demo',
      path: '/workspace/demo',
      cwd: '/workspace/demo/packages/app',
    },
    user: {
      username: 'alice',
    },
    environment: {
      variables: {
        PWD: '/workspace/demo/packages/app',
        NODE_ENV: 'test',
      },
    },
    timestamp: '2026-04-20T12:00:00Z',
  };

  it('includes working-directory fields in the default hash', () => {
    const first = createContextHash(context);
    const second = createContextHash({
      ...context,
      project: {
        ...context.project,
        cwd: '/workspace/demo/packages/other',
      },
      environment: {
        variables: {
          ...context.environment.variables,
          PWD: '/workspace/demo/packages/other',
        },
      },
    });

    expect(first).not.toBe(second);
  });

  it('can omit working-directory fields for session-cache hashing', () => {
    const first = createContextHash(context, { omitWorkingDirectory: true });
    const second = createContextHash(
      {
        ...context,
        project: {
          ...context.project,
          cwd: '/workspace/demo/packages/other',
        },
        environment: {
          variables: {
            ...context.environment.variables,
            PWD: '/workspace/demo/packages/other',
          },
        },
      },
      { omitWorkingDirectory: true },
    );

    expect(first).toBe(second);
  });
});
