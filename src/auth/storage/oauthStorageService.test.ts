import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { AUTH_CONFIG } from '@src/constants.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OAuthStorageService } from './oauthStorageService.js';

describe('OAuthStorageService', () => {
  let service: OAuthStorageService;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = path.join(tmpdir(), `oauth-storage-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    service = new OAuthStorageService(tempDir);
  });

  afterEach(() => {
    service.shutdown();
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Authorization Request Management', () => {
    it('should create and retrieve authorization requests', () => {
      const authRequestId = service.createAuthorizationRequest(
        'test-client',
        'http://localhost:3000/callback',
        'challenge123',
        'state456',
        'test-resource',
        ['scope1', 'scope2'],
      );

      expect(authRequestId).toBeDefined();
      expect(authRequestId).toMatch(/^code-/);

      const retrieved = service.getAuthorizationRequest(authRequestId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.clientId).toBe('test-client');
      expect(retrieved!.redirectUri).toBe('http://localhost:3000/callback');
      expect(retrieved!.codeChallenge).toBe('challenge123');
      expect(retrieved!.state).toBe('state456');
      expect(retrieved!.resource).toBe('test-resource');
      expect(retrieved!.scopes).toEqual(['scope1', 'scope2']);
    });

    it('should return null for non-existent authorization requests', () => {
      const result = service.getAuthorizationRequest('code-nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('Consent Processing', () => {
    it('should process consent approval successfully', async () => {
      // Create an auth request
      const authRequestId = service.createAuthorizationRequest(
        'test-client',
        'http://localhost:3000/callback',
        'challenge123',
        'state456',
        'test-resource',
        ['scope1', 'scope2'],
      );

      // Process approval
      const selectedScopes = ['scope1'];
      const result = await service.processConsentApproval(authRequestId, selectedScopes);

      expect(result.authCode).toBeDefined();
      expect(result.authCode).toMatch(/^code-/);
      expect(result.redirectUrl.href).toBe(
        'http://localhost:3000/callback?code=' + result.authCode + '&state=state456',
      );

      // Auth request should be cleaned up
      const authRequest = service.getAuthorizationRequest(authRequestId);
      expect(authRequest).toBeNull();

      // Auth code should exist
      const authCode = service.authCodeRepository.get(result.authCode);
      expect(authCode).toBeDefined();
      expect(authCode!.clientId).toBe('test-client');
      expect(authCode!.scopes).toEqual(selectedScopes);
    });

    it('should process consent denial successfully', async () => {
      // Create an auth request
      const authRequestId = service.createAuthorizationRequest(
        'test-client',
        'http://localhost:3000/callback',
        'challenge123',
        'state456',
      );

      // Process denial
      const redirectUrl = await service.processConsentDenial(authRequestId);

      expect(redirectUrl.href).toBe(
        'http://localhost:3000/callback?error=access_denied&error_description=User+denied+the+request&state=state456',
      );

      // Auth request should be cleaned up
      const authRequest = service.getAuthorizationRequest(authRequestId);
      expect(authRequest).toBeNull();
    });

    it('should handle missing auth request during approval', async () => {
      await expect(service.processConsentApproval('code-nonexistent', ['scope1'])).rejects.toThrow(
        'Invalid or expired authorization request',
      );
    });

    it('should handle missing auth request during denial', async () => {
      await expect(service.processConsentDenial('code-nonexistent')).rejects.toThrow(
        'Invalid or expired authorization request',
      );
    });
  });

  describe('Repository Access', () => {
    it('should provide access to repositories', () => {
      expect(service.sessionRepository).toBeDefined();
      expect(service.authCodeRepository).toBeDefined();
      expect(service.authRequestRepository).toBeDefined();
      expect(service.clientDataRepository).toBeDefined();
    });

    it('should provide storage directory path', () => {
      const expectedPath = path.join(tempDir, 'sessions', AUTH_CONFIG.SERVER.SESSION.SUBDIR);
      expect(service.getStorageDir()).toBe(expectedPath);
    });
  });
});
