import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createRuntimeIdentityRoutes } from './runtimeIdentityRoutes.js';

describe('runtime identity routes', () => {
  it('returns only low-disclosure runtime identity fields', async () => {
    const app = express();
    app.use(
      '/.well-known/1mcp',
      createRuntimeIdentityRoutes({
        getRuntimeIdentity: () => ({
          identityProtocolVersion: '1',
          runtimeScopeId: 'scope_123',
          externalUrl: 'https://runtime.example.com',
          runtimeVersion: '1.2.3',
          serverTime: '2026-07-06T00:00:00.000Z',
        }),
      }),
    );

    const response = await request(app).get('/.well-known/1mcp/runtime-identity');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      identityProtocolVersion: '1',
      runtimeScopeId: 'scope_123',
      externalUrl: 'https://runtime.example.com',
      runtimeVersion: '1.2.3',
      serverTime: '2026-07-06T00:00:00.000Z',
    });
    expect(Object.keys(response.body).sort()).toEqual([
      'externalUrl',
      'identityProtocolVersion',
      'runtimeScopeId',
      'runtimeVersion',
      'serverTime',
    ]);
  });
});
