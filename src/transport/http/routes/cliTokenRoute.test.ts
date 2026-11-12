import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createCliTokenAuthorization } from '@src/core/context/cliTokenProof.js';
import { TemplateContextCapabilityStore } from '@src/core/context/templateContextTrust.js';
import { RuntimeIdentityService } from '@src/core/runtime/runtimeIdentityService.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';

import type { NextFunction } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCliTokenRoute } from './cliTokenRoute.js';

describe('createCliTokenRoute', () => {
  let mockRequest: any;
  let mockResponse: any;
  let mockOAuthProvider: any;
  let next: NextFunction;
  let directory: string;
  let authEnabled: boolean;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(tmpdir(), 'cli-token-authority-'));
    authEnabled = true;
    const runtimeScopeId = new RuntimeIdentityService({ storageDir: directory }).getRuntimeScopeId();
    const capability = new TemplateContextCapabilityStore({ storageDir: directory, runtimeScopeId }).getOrCreate();
    const config = AgentConfigManager.getInstance();
    const get = config.get.bind(config);
    vi.spyOn(config, 'get').mockImplementation((key) => {
      if (key === 'runtimeScopeStoragePath') return directory;
      if (key === 'features') return { ...get('features'), auth: authEnabled };
      return get(key);
    });
    mockRequest = {
      headers: { authorization: createCliTokenAuthorization(capability) },
      socket: {
        remoteAddress: '127.0.0.1',
      },
    };
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockOAuthProvider = {
      oauthFlow: {
        createLocalhostCliToken: vi.fn().mockReturnValue({
          authRequired: true,
          token: 'tk-token-123',
          expiresIn: 3600,
          tokenId: 'token-123',
        }),
      },
    };
    next = (() => undefined) as NextFunction;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('should return a localhost CLI token from the OAuth flow', async () => {
    const handler = createCliTokenRoute(mockOAuthProvider);

    await handler(mockRequest, mockResponse, next);

    expect(mockOAuthProvider.oauthFlow.createLocalhostCliToken).toHaveBeenCalledWith();
    expect(mockResponse.json).toHaveBeenCalledWith({
      authRequired: true,
      token: 'tk-token-123',
      expiresIn: 3600,
    });
  });

  it('should reject non-localhost requests before token creation', async () => {
    mockRequest.socket.remoteAddress = '203.0.113.5';
    mockRequest.headers = { 'x-forwarded-for': '127.0.0.1', host: 'localhost' };
    const handler = createCliTokenRoute(mockOAuthProvider);

    await handler(mockRequest, mockResponse, next);

    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockOAuthProvider.oauthFlow.createLocalhostCliToken).not.toHaveBeenCalled();
  });
  it('denies loopback callers without local credentials before minting', async () => {
    delete mockRequest.headers.authorization;
    await createCliTokenRoute(mockOAuthProvider)(mockRequest, mockResponse, next);
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockOAuthProvider.oauthFlow.createLocalhostCliToken).not.toHaveBeenCalled();
  });

  it('denies issuance when the capability file is unavailable', async () => {
    fs.rmSync(path.join(directory, 'template-context-capability.json'));
    await createCliTokenRoute(mockOAuthProvider)(mockRequest, mockResponse, next);
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockOAuthProvider.oauthFlow.createLocalhostCliToken).not.toHaveBeenCalled();
  });

  it('reports disabled authentication without minting a token or requiring credentials', async () => {
    authEnabled = false;
    delete mockRequest.headers.authorization;
    await createCliTokenRoute(mockOAuthProvider)(mockRequest, mockResponse, next);
    expect(mockResponse.json).toHaveBeenCalledWith({ authRequired: false, message: 'Auth is disabled on this server' });
    expect(mockOAuthProvider.oauthFlow.createLocalhostCliToken).not.toHaveBeenCalled();
  });
});
