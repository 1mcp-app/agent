import type { NextFunction } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCliTokenRoute } from './cliTokenRoute.js';

describe('createCliTokenRoute', () => {
  let mockRequest: any;
  let mockResponse: any;
  let mockOAuthProvider: any;
  let next: NextFunction;

  beforeEach(() => {
    mockRequest = {
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
    const handler = createCliTokenRoute(mockOAuthProvider);

    await handler(mockRequest, mockResponse, next);

    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockOAuthProvider.oauthFlow.createLocalhostCliToken).not.toHaveBeenCalled();
  });
});
