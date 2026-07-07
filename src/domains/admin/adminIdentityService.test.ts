import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AdminIdentityService } from './adminIdentityService.js';

describe('AdminIdentityService', () => {
  let storageDir: string;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-identity-'));
  });

  afterEach(() => {
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  function createService(runtimeScopeId = 'scope_a') {
    return new AdminIdentityService({
      runtimeScopeId,
      storageDir,
      now: () => new Date('2026-07-06T00:00:00.000Z'),
      sessionTtlMs: 60 * 60 * 1000,
    });
  }

  it('bootstraps the first admin account only when no account exists', async () => {
    const service = createService();

    const account = await service.bootstrapFirstAdmin({
      username: 'operator',
      password: 'correct horse battery staple',
    });

    expect(account).toMatchObject({
      username: 'operator',
      role: 'full-admin',
      disabled: false,
      runtimeScopeId: 'scope_a',
    });
    await expect(
      service.bootstrapFirstAdmin({ username: 'second', password: 'correct horse battery staple' }),
    ).rejects.toMatchObject({ code: 'admin_account_exists' });
    expect(service.hasAdminAccount()).toBe(true);
  });

  it('bootstraps the first admin from environment without replacing an existing account', async () => {
    const service = createService();

    const account = service.bootstrapFirstAdminFromEnvironment({
      ONE_MCP_ADMIN_USERNAME: 'env-operator',
      ONE_MCP_ADMIN_PASSWORD: 'correct horse battery staple',
    });

    expect(account).toMatchObject({ username: 'env-operator', runtimeScopeId: 'scope_a' });
    expect(
      service.bootstrapFirstAdminFromEnvironment({
        ONE_MCP_ADMIN_USERNAME: 'ignored',
        ONE_MCP_ADMIN_PASSWORD: 'different correct horse',
      }),
    ).toBeNull();
    const login = await service.login({ username: 'env-operator', password: 'correct horse battery staple' });
    expect(login.account.username).toBe('env-operator');
  });

  it('keeps admin accounts and sessions scoped to one runtime scope and persistent across service instances', async () => {
    const service = createService('scope_a');
    await service.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const login = await service.login({ username: 'operator', password: 'correct horse battery staple' });

    const restarted = createService('scope_a');
    expect(restarted.hasAdminAccount()).toBe(true);
    expect(restarted.validateSession(login.sessionToken)).toMatchObject({
      account: { username: 'operator', runtimeScopeId: 'scope_a' },
      csrfToken: login.csrfToken,
    });

    const otherScope = createService('scope_b');
    expect(otherScope.hasAdminAccount()).toBe(false);
    expect(otherScope.validateSession(login.sessionToken)).toBeNull();
  });

  it('creates opaque sessions and validates passwords without returning password material', async () => {
    const service = createService();
    await service.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });

    await expect(service.login({ username: 'operator', password: 'wrong password' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    });

    const login = await service.login({ username: 'operator', password: 'correct horse battery staple' });
    expect(login.sessionToken).toMatch(/^admin_sess_/);
    expect(login.csrfToken).toMatch(/^admin_csrf_/);
    expect(JSON.stringify(login)).not.toContain('correct horse battery staple');
    expect(JSON.stringify(fs.readdirSync(path.join(storageDir, 'admin')))).not.toContain(login.sessionToken);
  });

  it('does not let a stale login overwrite a concurrent password change', async () => {
    const service = createService();
    const account = await service.bootstrapFirstAdmin({
      username: 'operator',
      password: 'correct horse battery staple',
    });
    const originalVerifyPassword = (service as any).verifyPassword.bind(service);
    let releaseLogin: () => void;
    const releaseLoginPromise = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    const loginVerified = new Promise<void>((resolve) => {
      (service as any).verifyPassword = async (password: string, passwordHash: string) => {
        const result = await originalVerifyPassword(password, passwordHash);
        resolve();
        await releaseLoginPromise;
        return result;
      };
    });

    const staleLogin = service.login({ username: 'operator', password: 'correct horse battery staple' });
    await loginVerified;
    await service.changePassword(account.id, 'new correct horse battery staple');
    releaseLogin!();

    await expect(staleLogin).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(
      service.login({ username: 'operator', password: 'correct horse battery staple' }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    const freshLogin = await service.login({ username: 'operator', password: 'new correct horse battery staple' });
    expect(freshLogin.account.username).toBe('operator');
  });

  it('rejects tampered password hash envelopes', async () => {
    const service = createService();
    await service.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const stateFile = fs.readdirSync(path.join(storageDir, 'admin'))[0];
    const statePath = path.join(storageDir, 'admin', stateFile);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      accounts: Array<{ passwordHash: string }>;
    };
    state.accounts[0].passwordHash = state.accounts[0].passwordHash.replace('scrypt:v1:', 'sha256:v1:');
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    await expect(
      service.login({ username: 'operator', password: 'correct horse battery staple' }),
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('requires a session-bound CSRF token for unsafe validation', async () => {
    const service = createService();
    await service.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const login = await service.login({ username: 'operator', password: 'correct horse battery staple' });

    expect(service.validateCsrf(login.sessionToken, login.csrfToken)).toBe(true);
    expect(service.validateCsrf(login.sessionToken, 'admin_csrf_wrong')).toBe(false);
    expect(service.validateCsrf('admin_sess_wrong', login.csrfToken)).toBe(false);
  });

  it('revokes sessions when password changes or an account is disabled or deleted', async () => {
    const service = createService();
    const account = await service.bootstrapFirstAdmin({
      username: 'operator',
      password: 'correct horse battery staple',
    });
    const first = await service.login({ username: 'operator', password: 'correct horse battery staple' });

    await service.changePassword(account.id, 'new correct horse battery staple');
    expect(service.validateSession(first.sessionToken)).toBeNull();

    const second = await service.login({ username: 'operator', password: 'new correct horse battery staple' });
    await service.disableAccount(account.id);
    expect(service.validateSession(second.sessionToken)).toBeNull();
    await expect(
      service.login({ username: 'operator', password: 'new correct horse battery staple' }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });

    await service.deleteAccount(account.id);
    expect(service.hasAdminAccount()).toBe(false);
  });

  it('revokes all sessions for an admin-disabled transition', async () => {
    const service = createService();
    await service.bootstrapFirstAdmin({
      username: 'operator',
      password: 'correct horse battery staple',
    });
    const first = await service.login({ username: 'operator', password: 'correct horse battery staple' });
    const second = await service.login({ username: 'operator', password: 'correct horse battery staple' });

    service.revokeAllSessions();

    expect(service.validateSession(first.sessionToken)).toBeNull();
    expect(service.validateSession(second.sessionToken)).toBeNull();
  });
});
