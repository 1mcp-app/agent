import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  AdminConfiguredServerOperations,
  ConfiguredServerMutationResult,
  ConfiguredServerReadModel,
} from '@src/domains/admin/adminConfiguredServerService.js';
import { AdminIdentityService } from '@src/domains/admin/adminIdentityService.js';
import type { AdminOperationResult } from '@src/domains/admin/adminOperationService.js';
import type { ConfigChangeResult } from '@src/domains/config-change/configChange.js';
import { createAdminRoutes } from '@src/transport/http/routes/adminRoutes.js';

import express from 'express';
import { type Browser, chromium, type Locator, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ADMIN_BUILD_DIR = path.join(process.cwd(), 'build', 'admin');
const ADMIN_BUILD_INDEX = path.join(ADMIN_BUILD_DIR, 'index.html');
const PASSWORD = 'correct horse battery staple';

describe('admin SPA browser smoke', () => {
  let browser: Browser | null = null;
  let configuredServerFixture: ResettableConfiguredServerFixture;
  let server: Server | null = null;
  let baseUrl: string;
  let storageDir: string | null = null;

  beforeAll(async () => {
    if (!existsSync(ADMIN_BUILD_INDEX)) {
      throw new Error('Admin SPA build is missing. Run pnpm build before the browser smoke test.');
    }

    storageDir = mkdtempSync(path.join(tmpdir(), 'admin-spa-smoke-'));
    const adminService = new AdminIdentityService({
      runtimeScopeId: 'scope_smoke',
      storageDir,
      now: () => new Date('2030-01-01T00:00:00.000Z'),
      sessionTtlMs: 60 * 60 * 1000,
    });
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: PASSWORD });

    const app = express();
    app.use(express.json());
    configuredServerFixture = createConfiguredServerFixture();
    const adminRoutes = createAdminRoutes({
      adminEnabled: true,
      adminService,
      configuredServerService: configuredServerFixture,
      getRuntimeIdentity: () => ({
        identityProtocolVersion: '1',
        runtimeScopeId: 'scope_smoke',
        externalUrl: baseUrl,
        runtimeVersion: '0.34.0-smoke',
      }),
      getOAuthDashboard: () => ({
        status: 'ready',
        services: [
          {
            name: 'github',
            status: 'awaiting_oauth',
            requiresOAuth: true,
            lastError: 'OAuth consent required',
          },
        ],
      }),
      adminConsoleAssetsDir: ADMIN_BUILD_DIR,
    });

    if (!adminRoutes) {
      throw new Error('Admin routes did not mount');
    }
    app.use('/admin', adminRoutes);

    const httpServer = createServer(app);
    server = httpServer;
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Admin smoke server did not bind to a TCP port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  }, 30000);

  beforeEach(() => {
    configuredServerFixture.reset();
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve, reject) => {
      if (!server?.listening) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (storageDir) {
      rmSync(storageDir, { recursive: true, force: true });
    }
  });

  it('renders the built React console at desktop width and performs a server mutation', async () => {
    const page = await newPage({ width: 1280, height: 820 });

    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });

      await expectText(page, 'Runtime operations');
      await expectText(page, 'Enabled servers');
      await expectText(page, 'Disabled servers');
      await expectText(page, 'OAuth attention');
      await expectText(page, 'Failed audits');

      await page.getByLabel('Search servers').fill('github');
      await waitForRowCount(page, 1);
      await expectText(page, 'https://mcp.example/github');

      await page.getByRole('button', { name: 'Enable github' }).click();
      await expectText(page, 'Server enable completed.');
      await expectVisible(page.locator('tbody tr', { hasText: 'github' }).getByText('enabled', { exact: true }));
    } finally {
      await page.context().close();
    }
  });

  it('keeps the built console usable at narrow width without page-level horizontal overflow', async () => {
    const page = await newPage({ width: 390, height: 844, isMobile: true });

    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });

      await expectText(page, 'Runtime operations');
      await expectVisible(page.getByRole('button', { name: 'Refresh' }));
      await expectVisible(page.getByRole('button', { name: 'Log out' }));
      const hasPageOverflow = await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth > globalThis.window.innerWidth + 1,
      );
      expect(hasPageOverflow).toBe(false);
    } finally {
      await page.context().close();
    }
  });

  async function newPage(viewport: { width: number; height: number; isMobile?: boolean }): Promise<Page> {
    if (!browser) {
      throw new Error('Playwright browser did not start');
    }
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile ?? false,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    return page;
  }

  async function expectCenteredLoginGate(page: Page): Promise<void> {
    await page.goto(`${baseUrl}/admin`);
    await expectVisible(page.getByRole('heading', { name: 'Operator login' }));
    expect(await page.locator('.admin-app-header').count()).toBe(0);
    expect(await page.locator('.status-strip').count()).toBe(0);

    const loginPanelCenter = await page.locator('.login-panel').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        xDelta: Math.abs(rect.left + rect.width / 2 - globalThis.window.innerWidth / 2),
        yDelta: Math.abs(rect.top + rect.height / 2 - globalThis.window.innerHeight / 2),
      };
    });
    expect(loginPanelCenter.xDelta).toBeLessThanOrEqual(8);
    expect(loginPanelCenter.yDelta).toBeLessThanOrEqual(24);
  }

  async function login(page: Page, options: { skipNavigation?: boolean } = {}): Promise<void> {
    if (!options.skipNavigation) {
      await page.goto(`${baseUrl}/admin`);
    }
    await page.getByLabel('Username').fill('operator');
    await page.getByLabel('Password').fill(PASSWORD);
    const loginResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/admin/api/session/login'),
    );
    const statusResponsePromise = page.waitForResponse((response) => response.url().endsWith('/admin/api/status'));
    const serversResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/admin/api/configured-servers'),
    );
    await page.getByRole('button', { name: 'Log in' }).click();
    const loginResponse = await loginResponsePromise;
    const loginResponseBody = await loginResponse.text();
    expect(loginResponse.status(), loginResponseBody).toBe(200);
    const statusResponse = await statusResponsePromise;
    const statusResponseBody = await statusResponse.text();
    expect(statusResponse.status(), statusResponseBody).toBe(200);
    const serversResponse = await serversResponsePromise;
    const serversResponseBody = await serversResponse.text();
    expect(serversResponse.status(), serversResponseBody).toBe(200);
  }
});

type ResettableConfiguredServerFixture = AdminConfiguredServerOperations & { reset: () => void };

async function expectText(page: Page, text: string): Promise<void> {
  try {
    await expectVisible(page.getByText(text, { exact: false }).first());
  } catch (error) {
    throw new Error(`Expected visible text "${text}". Rendered body:\n${await page.locator('body').innerText()}`, {
      cause: error,
    });
  }
}

async function expectVisible(locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible' });
}

async function waitForRowCount(page: Page, expectedCount: number): Promise<void> {
  await page.waitForFunction(
    (count) => globalThis.document.querySelectorAll('tbody tr').length === count,
    expectedCount,
  );
  expect(await page.locator('tbody tr').count()).toBe(expectedCount);
}

function createConfiguredServerFixture(): ResettableConfiguredServerFixture {
  let servers = createConfiguredServerReadModels();

  return {
    reset() {
      servers = createConfiguredServerReadModels();
    },
    async listConfiguredServers() {
      return operationSuccess('listConfiguredServers', 'op_list', { servers });
    },
    async enableConfiguredServer(input) {
      setEnabled(servers, input.targetName, true);
      return operationSuccess('enableConfiguredServer', 'op_enable', mutationResult(input.targetName, true));
    },
    async disableConfiguredServer(input) {
      setEnabled(servers, input.targetName, false);
      return operationSuccess('disableConfiguredServer', 'op_disable', mutationResult(input.targetName, false));
    },
    getRecentAuditFacts() {
      return [
        {
          timestamp: '2026-07-06T00:00:00.000Z',
          operationId: 'op_audit',
          operationName: 'disableConfiguredServer',
          result: 'completed',
          actor: { type: 'admin_session', accountIdHash: 'account_hash', sessionIdHash: 'session_hash' },
          origin: 'browser',
          target: { type: 'configured_server', id: 'filesystem' },
          request: { requestId: 'req_smoke' },
        },
      ];
    },
  };
}

function createConfiguredServerReadModels(): ConfiguredServerReadModel[] {
  return [
    {
      id: 'filesystem',
      source: 'mcpServers',
      target: { type: 'configured_server', id: 'filesystem', source: 'mcpServers' },
      enabled: true,
      tags: [],
      transportSummary: { kind: 'stdio', label: 'node ./servers/filesystem.js' },
      mutationAvailability: { available: true, operations: ['enable', 'disable'] },
      actionState: actionState('filesystem', true),
      transport: { command: 'node ./servers/filesystem.js' },
      secretInputs: [],
    },
    {
      id: 'github',
      source: 'mcpServers',
      target: { type: 'configured_server', id: 'github', source: 'mcpServers' },
      enabled: false,
      tags: [],
      transportSummary: { kind: 'http', label: 'https://mcp.example/github' },
      mutationAvailability: { available: true, operations: ['enable', 'disable'] },
      actionState: actionState('github', false),
      transport: { url: 'https://mcp.example/github' },
      secretInputs: [
        {
          fieldPath: ['headers', 'Authorization'],
          label: 'Authorization',
          state: 'present',
          allowedActions: ['preserve', 'replace', 'clear'],
        },
      ],
    },
  ];
}

function operationSuccess<T>(operationName: string, operationId: string, result: T): AdminOperationResult<T> {
  return {
    ok: true,
    status: 'completed',
    operationId,
    operationName,
    result,
    replayed: false,
  };
}

function mutationResult(targetName: string, enabled: boolean): ConfiguredServerMutationResult {
  return {
    targetName,
    enabled,
    outcome: enabled ? 'enabled' : 'disabled',
    configChange: configChangeResult(targetName, enabled),
  };
}

function configChangeResult(targetName: string, enabled: boolean): ConfigChangeResult {
  return {
    status: 'changed',
    operation: enabled ? 'enable' : 'disable',
    configPath: '/tmp/admin-smoke-config.json',
    target: { name: targetName, source: 'mcpServers' },
    changed: true,
    backup: { created: false },
    retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
    reload: { status: 'observed' },
    warnings: [],
  };
}

function setEnabled(servers: ConfiguredServerReadModel[], targetName: string, enabled: boolean): void {
  const server = servers.find((candidate) => candidate.id === targetName);
  if (server) {
    server.enabled = enabled;
    server.actionState = actionState(targetName, enabled);
  }
}

function actionState(targetName: string, enabled: boolean): ConfiguredServerReadModel['actionState'] {
  return {
    enable: enabled
      ? { available: false, label: `Enable ${targetName}`, disabledReason: 'already_enabled' }
      : { available: true, label: `Enable ${targetName}` },
    disable: enabled
      ? { available: true, label: `Disable ${targetName}` }
      : { available: false, label: `Disable ${targetName}`, disabledReason: 'already_disabled' },
  };
}
