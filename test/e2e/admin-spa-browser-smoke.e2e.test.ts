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
      await expectVisible(page.getByRole('navigation', { name: 'Operations navigation' }));
      await expectText(page, 'Operations overview');
      await expectText(page, 'Runtime online');
      await expectText(page, 'Server inventory');
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

      await page.getByRole('button', { name: 'Edit github server' }).click();
      await expectVisible(page.getByRole('heading', { name: 'github', exact: true }));
      await expectText(page, 'Edit server');
    } finally {
      await page.context().close();
    }
  });

  it('previews and applies a configured-server edit through the HTML confirmation dialog', async () => {
    const page = await newPage({ width: 1280, height: 900 });

    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });

      await page.getByRole('button', { name: 'Edit github server' }).click();
      await expectVisible(page.getByRole('heading', { name: 'github', exact: true }));

      const tags = page.getByRole('textbox', { name: 'Tags' });
      await tags.fill('verified');
      await tags.press('Enter');
      await expectText(page, 'Unsaved changes');
      await page.getByRole('button', { name: 'Preview change' }).click();

      await expectText(page, 'Preview result');
      await expectText(page, 'Preview only - no config has been written.');
      const applyButton = page.getByRole('button', { name: 'Apply changes' });
      await applyButton.click();

      const dialog = page.getByRole('dialog');
      await expectVisible(dialog);
      await expectVisible(dialog.getByText('Apply changes to github?'));
      await expectVisible(dialog.getByText('This writes the validated configuration and reloads the Runtime Scope.'));
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      expect(await applyButton.evaluate((element) => element === globalThis.document.activeElement)).toBe(true);
      expect(await page.getByText('Changes applied to github.').count()).toBe(0);

      const applyResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith('/admin/api/configured-servers/github/apply'),
      );
      await applyButton.click();
      await expectVisible(dialog);
      await dialog.getByRole('button', { name: 'Apply changes' }).click();
      const applyResponse = await applyResponsePromise;
      expect(applyResponse.status(), await applyResponse.text()).toBe(200);

      await expectText(page, 'Changes applied to github.');
      await expectText(page, 'No changes yet');
      await expectVisible(page.getByRole('textbox', { name: 'Tags' }));
      await expectVisible(page.locator('.edit-section').getByText('verified', { exact: true }));
      expect(await page.getByRole('button', { name: 'Preview change' }).isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: 'Apply changes' }).count()).toBe(0);
    } finally {
      await page.context().close();
    }
  });

  it.each([
    { width: 390, height: 844, compactInventory: true },
    { width: 800, height: 900, compactInventory: false },
  ])(
    'keeps the built console usable at $width px without page-level horizontal overflow',
    async ({ width, height, compactInventory }) => {
      const page = await newPage({ width, height, isMobile: width === 390 });

      try {
        await expectCenteredLoginGate(page);
        await login(page, { skipNavigation: true });

        await expectText(page, 'Runtime operations');
        await expectText(page, 'Operations overview');
        await expectVisible(page.getByRole('button', { name: 'Refresh' }));
        await expectVisible(page.getByRole('button', { name: 'Log out' }));
        await expectNoPageOverflow(page);

        if (compactInventory) {
          await expectVisible(page.locator('.server-mobile-card').first());
          expect(await page.locator('.server-table-view').count()).toBe(0);
        } else {
          await expectVisible(page.locator('.server-table-view'));
          expect(await page.locator('.server-mobile-card').count()).toBe(0);
        }

        const navigationToggle = page.getByRole('button', { name: 'Open operations navigation' });
        await expectVisible(navigationToggle);
        await navigationToggle.click();
        await expectVisible(page.getByRole('navigation', { name: 'Operations navigation' }));
        await page.getByRole('button', { name: 'OAuth services' }).click();
        await page.waitForFunction(() => globalThis.location.hash === '#oauth');
        await page.waitForFunction(() => globalThis.document.activeElement?.id === 'oauth');
        await expectVisible(page.getByRole('button', { name: 'Open operations navigation' }));
        await expectNoPageOverflow(page);
      } finally {
        await page.context().close();
      }
    },
  );

  it('stacks the inspector below inventory at 1440 px', async () => {
    const page = await newPage({ width: 1440, height: 1100 });

    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await expectNoPageOverflow(page);

      const layout = await page.locator('.workspace-grid').evaluate((element) => {
        const inventory = element.querySelector('.inventory-column')?.getBoundingClientRect();
        const inspector = element.querySelector('.inspector-column')?.getBoundingClientRect();
        return {
          columns: globalThis.getComputedStyle(element).gridTemplateColumns.split(' ').length,
          inventoryBottom: inventory?.bottom ?? 0,
          inspectorTop: inspector?.top ?? 0,
        };
      });
      expect(layout.columns).toBe(1);
      expect(layout.inspectorTop).toBeGreaterThanOrEqual(layout.inventoryBottom);
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

async function expectNoPageOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    viewportWidth: globalThis.window.innerWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
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
    async getConfiguredServerDetail(input) {
      const server = servers.find((candidate) => candidate.id === input.targetName);
      if (!server) {
        throw new Error('Configured server target was not found');
      }
      return operationSuccess('getConfiguredServerDetail', 'op_detail', {
        server,
        editContract: {
          schemaVersion: 2,
          target: server.target,
          capabilities: {
            singleTargetEdit: true,
            rename: { supported: true },
            create: { supported: false },
            delete: { supported: false },
            bulkEdit: { supported: false },
            rawJson: { supported: false },
            preview: { supported: true },
            apply: { supported: true },
          },
          fieldGroups: [
            {
              id: 'identity',
              label: 'Target',
              fields: [
                {
                  fieldPath: ['tags'],
                  label: 'Tags',
                  control: 'tag-list',
                  value: [...server.tags],
                  editable: true,
                },
              ],
            },
          ],
        },
      });
    },
    async previewConfiguredServerEdit(input) {
      const edit = input.edit && typeof input.edit === 'object' && !Array.isArray(input.edit) ? input.edit : {};
      const proposedTargetName =
        typeof (edit as { id?: unknown }).id === 'string' ? (edit as { id: string }).id : input.targetName;
      const server = servers.find((candidate) => candidate.id === input.targetName);
      const proposedTags = Array.isArray((edit as { tags?: unknown }).tags)
        ? (edit as { tags: unknown[] }).tags.filter((tag): tag is string => typeof tag === 'string')
        : (server?.tags ?? []);
      return operationSuccess('previewConfiguredServerEdit', 'op_preview', {
        targetName: input.targetName,
        proposedTargetName,
        previewFingerprint: 'preview_fixture',
        validation: { status: 'valid', errors: [] },
        diff: [
          {
            fieldPath: ['tags'],
            oldValue: server?.tags ?? [],
            newValue: proposedTags,
            riskFlags: [],
          },
        ],
        configChange: {
          status: 'changed',
          operation: 'set_static',
          configPath: '[redacted]',
          target: { name: input.targetName, source: 'mcpServers' },
          changed: true,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'skipped' },
          warnings: [],
        },
        connectivityCheck: { status: 'skipped', reason: 'connection_critical_fields_unchanged' },
      });
    },
    async applyConfiguredServerEdit(input) {
      const edit = input.edit && typeof input.edit === 'object' && !Array.isArray(input.edit) ? input.edit : {};
      const server = servers.find((candidate) => candidate.id === input.targetName);
      if (server && Array.isArray((edit as { tags?: unknown }).tags)) {
        server.tags = (edit as { tags: unknown[] }).tags.filter((tag): tag is string => typeof tag === 'string');
      }
      return operationSuccess('applyConfiguredServerEdit', 'op_apply', {
        originalTargetName: input.targetName,
        targetName: input.targetName,
        previewFingerprint: input.previewFingerprint,
        configChange: configChangeResult(input.targetName, true),
      });
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
