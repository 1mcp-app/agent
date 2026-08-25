import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateTemplateContent } from '@src/core/instructions/templateValidator.js';
import {
  AdminConfiguredServerApplyError,
  AdminConfiguredServerNotFoundError,
  type AdminConfiguredServerOperations,
  type ConfiguredServerMutationResult,
  type ConfiguredServerReadModel,
} from '@src/domains/admin/adminConfiguredServerService.js';
import { AdminIdentityService } from '@src/domains/admin/adminIdentityService.js';
import type {
  AdminInstructionPreviewResult,
  AdminInstructionTemplateOperations,
  InstructionTemplateAdminState,
} from '@src/domains/admin/adminInstructionTemplateService.js';
import type { AdminOperationResult } from '@src/domains/admin/adminOperationService.js';
import { BackendLogBroker } from '@src/domains/backend-logs/backendLogBroker.js';
import type { ConfigChangeResult } from '@src/domains/config-change/configChange.js';
import { createAdminRoutes } from '@src/transport/http/routes/adminRoutes.js';

import express from 'express';
import { type Browser, chromium, type Locator, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const ADMIN_BUILD_DIR = path.join(process.cwd(), 'build', 'admin');
const ADMIN_BUILD_INDEX = path.join(ADMIN_BUILD_DIR, 'index.html');
const PASSWORD = 'correct horse battery staple';
const SCREENSHOT_DIR = process.env.ADMIN_UI_SCREENSHOT_DIR;

describe('admin SPA browser smoke', () => {
  let browser: Browser | null = null;
  let configuredServerFixture: ResettableConfiguredServerFixture;
  let instructionTemplateFixture: ResettableInstructionTemplateFixture;
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
    instructionTemplateFixture = createInstructionTemplateFixture();
    const backendLogBroker = new BackendLogBroker({
      now: () => new Date('2030-01-01T00:00:00.000Z'),
    });
    backendLogBroker.registerSource({
      id: 'static:github',
      canonicalName: 'github',
      displayName: 'github',
      kind: 'static',
      capture: 'managed',
      lifecycle: 'active',
    });
    backendLogBroker.publish({ sourceId: 'static:github', kind: 'line', content: 'backend ready' });
    const adminRoutes = createAdminRoutes({
      adminEnabled: true,
      adminService,
      configuredServerService: configuredServerFixture,
      instructionTemplateService: instructionTemplateFixture,
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
      getBackendLogBroker: () => backendLogBroker,
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
    instructionTemplateFixture.reset();
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
      await expectText(page, 'Overview');
      await expectText(page, 'Runtime online');
      await expectText(page, 'Enabled servers');
      await expectText(page, 'Disabled servers');
      await expectText(page, 'OAuth attention');
      await expectText(page, 'Failed audits');
      expect(await page.getByRole('heading', { name: 'Server inventory' }).count()).toBe(0);

      await page.goto(`${baseUrl}/admin/audit`);
      await expectVisible(page.getByRole('heading', { name: 'Audit trail' }));

      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers`);
      await expectVisible(page.getByRole('heading', { name: 'Server inventory' }));

      await page.goBack();
      await page.waitForURL(`${baseUrl}/admin/audit`);
      await expectVisible(page.getByRole('heading', { name: 'Audit trail' }));
      await page.goForward();
      await page.waitForURL(`${baseUrl}/admin/servers`);
      await expectVisible(page.getByRole('heading', { name: 'Server inventory' }));
      await page.reload();
      await expectVisible(page.getByRole('heading', { name: 'Server inventory' }));

      await page.getByRole('link', { name: 'Backend logs' }).click();
      await page.waitForURL(`${baseUrl}/admin/logs`);
      await expectVisible(page.getByRole('heading', { name: 'Backend logs' }));
      await expectVisible(page.getByRole('log', { name: 'github retained log entries' }));
      await expectText(page, 'backend ready');

      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers`);

      await page.getByLabel('Search servers').fill('github');
      await waitForRowCount(page, 1);
      await expectText(page, 'https://mcp.example/github');

      await page.getByRole('switch', { name: 'Enable github' }).click();
      await expectText(page, 'Server enable completed.');
      await expectVisible(page.locator('tbody tr', { hasText: 'github' }).getByText('enabled', { exact: true }));

      await page.getByRole('button', { name: 'Edit static github server' }).click();
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
      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers`);

      const initialRefreshPromise = page.waitForResponse((response) =>
        response.url().endsWith('/admin/api/configured-servers/mcpServers/github/tool-inventory/refresh'),
      );
      await page.getByRole('button', { name: 'Edit static github server' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/mcpServers/github`);
      const initialRefresh = await initialRefreshPromise;
      expect(initialRefresh.status(), await initialRefresh.text()).toBe(200);
      expect(configuredServerFixture.refreshCount).toBe(1);
      await expectVisible(page.getByRole('heading', { name: 'github', exact: true }));
      await expectText(page, 'Configured Tool Selection');
      const inspectionAlert = page.getByRole('alert').first();
      await expectVisible(inspectionAlert);
      await expectVisible(inspectionAlert.getByText('github-worker: inspection transport closed'));

      const searchTool = page.locator('.configured-tool-row', { hasText: 'search' });
      await searchTool.getByRole('switch', { name: 'Enable search' }).locator('..').click();
      await searchTool.getByRole('textbox', { name: 'Description override' }).fill('Search approved repositories');

      const retryRefreshPromise = page.waitForResponse((response) =>
        response.url().endsWith('/admin/api/configured-servers/mcpServers/github/tool-inventory/refresh'),
      );
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      const retryRefresh = await retryRefreshPromise;
      expect(retryRefresh.status(), await retryRefresh.text()).toBe(200);
      expect(configuredServerFixture.refreshCount).toBe(2);
      expect(await searchTool.getByRole('switch', { name: 'Enable search' }).isChecked()).toBe(false);
      expect(await searchTool.getByRole('textbox', { name: 'Description override' }).inputValue()).toBe(
        'Search approved repositories',
      );

      const tags = page.getByRole('textbox', { name: 'Tags' });
      await tags.fill('verified');
      await tags.press('Enter');
      await expectText(page, 'Unsaved changes');

      await page.getByRole('link', { name: 'OAuth services' }).click();
      const leaveDialog = page.getByRole('dialog');
      await expectVisible(leaveDialog);
      await expectVisible(leaveDialog.getByText('Discard unsaved changes?'));
      await leaveDialog.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/mcpServers/github`);
      await expectText(page, 'Unsaved changes');

      await page.getByRole('button', { name: 'Preview change' }).click();

      await expectText(page, 'Preview result');
      await expectText(page, 'Preview only - no config has been written.');

      const generationRefreshPromise = page.waitForResponse((response) =>
        response.url().endsWith('/admin/api/configured-servers/mcpServers/github/tool-inventory/refresh'),
      );
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      const generationRefresh = await generationRefreshPromise;
      expect(generationRefresh.status(), await generationRefresh.text()).toBe(200);
      expect(configuredServerFixture.refreshCount).toBe(3);
      await page.getByText('Preview result', { exact: true }).waitFor({ state: 'hidden' });
      expect(await page.getByRole('button', { name: 'Apply changes' }).count()).toBe(0);
      expect(await searchTool.getByRole('switch', { name: 'Enable search' }).isChecked()).toBe(false);
      expect(await searchTool.getByRole('textbox', { name: 'Description override' }).inputValue()).toBe(
        'Search approved repositories',
      );

      await page.getByRole('button', { name: 'Preview change' }).click();
      await expectText(page, 'Preview result');
      const applyButton = page.getByRole('button', { name: 'Apply changes' });
      await applyButton.click();

      const dialog = page.getByRole('dialog');
      await expectVisible(dialog);
      await expectVisible(dialog.getByText('Apply changes to github?'));
      await expectVisible(dialog.getByText('This writes the validated configuration and reloads the Runtime Scope.'));
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      const applyButtonHandle = await applyButton.elementHandle();
      await page.waitForFunction((element) => element === globalThis.document.activeElement, applyButtonHandle);
      expect(await page.getByText('Changes applied to github.').count()).toBe(0);

      const applyResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith('/admin/api/configured-servers/mcpServers/github/apply'),
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
      expect(await searchTool.getByRole('switch', { name: 'Enable search' }).isChecked()).toBe(false);
      expect(await searchTool.getByRole('textbox', { name: 'Description override' }).inputValue()).toBe(
        'Search approved repositories',
      );
      expect(await page.getByRole('button', { name: 'Preview change' }).isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: 'Apply changes' }).count()).toBe(0);
    } finally {
      await page.context().close();
    }
  });

  it('configures all custom transport controls and creates a static server from the packaged console', async () => {
    const page = await newPage({ width: 1280, height: 980 });
    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers`);
      await page.getByRole('button', { name: 'Configure Custom Server' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/new`);
      expect(await page.getByLabel(/registry id|version|package metadata/i).count()).toBe(0);

      const transport = page.getByLabel('Transport Type');
      await expectVisible(page.getByLabel('Command'));
      expect(await page.getByLabel('URL').count()).toBe(0);
      await transport.selectOption('http');
      await expectVisible(page.getByLabel('URL'));
      expect(await page.getByLabel('Command').count()).toBe(0);
      await transport.selectOption('sse');
      await expectText(page, 'SSE is deprecated');
      await expectVisible(page.getByLabel('URL'));
      await transport.selectOption('stdio');

      await page.getByLabel('Server Name').fill('custom server');
      await page.getByLabel('Command').fill('node');
      await page.locator('summary').filter({ hasText: 'Advanced settings' }).click();
      await page.getByRole('button', { name: 'Add secret' }).click();
      await page.getByLabel('Environment variable').fill('API_TOKEN');
      await page.getByLabel('Environment reference for API_TOKEN').fill('CUSTOM_SERVER_TOKEN');
      expect(page.url()).not.toContain('CUSTOM_SERVER_TOKEN');
      const browserPersistence = await page.evaluate(() => ({
        history: JSON.stringify(globalThis.history.state),
        local: Object.entries(globalThis.localStorage),
        session: Object.entries(globalThis.sessionStorage),
      }));
      expect(JSON.stringify(browserPersistence)).not.toContain('CUSTOM_SERVER_TOKEN');

      await page.getByRole('button', { name: 'Preview server' }).click();
      await expectText(page, 'Preview only - no config has been written.');
      await page.getByRole('button', { name: 'Create server' }).click();
      const dialog = page.getByRole('dialog');
      await expectVisible(dialog);
      await expectVisible(dialog.getByText('Create configured server custom server?'));
      const createResponsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith('/admin/api/configured-servers') && response.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Create server' }).click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status(), await createResponse.text()).toBe(200);

      await page.waitForURL(`${baseUrl}/admin/servers/mcpServers/custom%20server`);
      await expectVisible(page.getByRole('heading', { name: 'custom server', exact: true }));
      await expectText(page, '3 configured targets');
      expect(await page.locator('body').innerText()).not.toContain('CUSTOM_SERVER_TOKEN');
      await expectNoPageOverflow(page);
    } finally {
      await page.context().close();
    }
  });

  it('keeps a name conflict in preview and never offers replacement', async () => {
    const page = await newPage({ width: 1280, height: 900 });
    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.getByRole('button', { name: 'Configure Custom Server' }).click();
      await page.getByLabel('Server Name').fill('github');
      await page.getByLabel('Command').fill('node');
      await page.getByRole('button', { name: 'Preview server' }).click();
      await expectText(page, 'configured_server_destination_conflict');
      expect(await page.getByRole('button', { name: /force|replace/i }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Create server' }).isDisabled()).toBe(true);
      await page.getByRole('button', { name: 'Edit existing server' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Discard draft' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/mcpServers/github`);
      await expectVisible(page.getByRole('heading', { name: 'github', exact: true }));
    } finally {
      await page.context().close();
    }
  });

  it('creates a Template definition through structural preview without creating an instance', async () => {
    const page = await newPage({ width: 1280, height: 900 });
    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.getByRole('button', { name: 'Configure Custom Server' }).click();
      await page.locator('label:visible', { hasText: 'Template' }).click();
      await page.getByLabel('Server Name').fill('project-template');
      await page.getByLabel('Command').fill('{{project.command}}');
      await page.getByRole('button', { name: 'Preview server' }).click();

      await expectText(page, 'Template structure');
      await expectText(page, 'project.command');
      await expectText(page, 'does not contact a backend');
      await expectText(page, '0 active');
      await page.getByRole('button', { name: 'Create template' }).click();
      const createDialog = page.getByRole('dialog');
      await expectVisible(createDialog.getByText('No runtime instance is created.'));
      await createDialog.getByRole('button', { name: 'Create template' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/mcpTemplates/project-template`);
      await expectVisible(page.getByRole('heading', { name: 'project-template', exact: true }));
      await expectText(page, 'This is a definition, not a live instance.');
    } finally {
      await page.context().close();
    }
  });

  it('filters duplicate definitions and edits, renames, and recovers a Template target by qualified identity', async () => {
    configuredServerFixture.showTemplateInventory();
    const page = await newPage({ width: 1280, height: 900 });
    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.getByRole('link', { name: 'Server inventory' }).click();
      await expectText(page, 'authoritative');
      await expectText(page, 'shadowed');

      await page.locator('[aria-label="Server source filter"] label:visible', { hasText: 'Template' }).click();
      await expectText(page, '1 of 3 targets');
      await page.getByRole('button', { name: 'Edit template github server' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/mcpTemplates/github`);

      await page.getByLabel('Command').fill('{{#if do-not-return-this-secret}}');
      await page.getByRole('button', { name: 'Preview change' }).click();
      await expectText(page, 'invalid_handlebars');
      await expectText(page, 'Invalid Handlebars syntax at line 1, column 0.');

      await page.getByLabel('Command').fill('{{project.command}}');
      await page.getByLabel('Target ID').fill('github-template');
      await page.getByText('Advanced settings', { exact: true }).click();
      await page.locator('label:visible', { hasText: 'Share instances' }).click();
      await page.getByRole('button', { name: 'Preview change' }).click();
      await expectText(page, 'Template structure');
      await expectText(page, 'Active instances retire after apply');
      await page.getByRole('button', { name: 'Apply changes' }).click();
      const dialog = page.getByRole('dialog');
      await expectVisible(dialog.getByText('Apply template changes to github-template?'));
      await dialog.getByRole('button', { name: 'Apply template' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/mcpTemplates/github-template`);
      await expectVisible(page.getByRole('heading', { name: 'github-template', exact: true }));

      await page.goto(`${baseUrl}/admin/servers/mcpTemplates/github`);
      await expectText(page, 'Server target not found');
      await page.getByRole('button', { name: 'Back to servers' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers`);
      await expectText(page, 'github-template');
      expect(await page.getByText('shadowed', { exact: true }).count()).toBe(0);
    } finally {
      await page.context().close();
    }
  });

  it('previews and applies a source-qualified Template definition disable from the packaged console', async () => {
    configuredServerFixture.showTemplateInventory();
    const page = await newPage({ width: 1280, height: 900 });
    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.locator('[aria-label="Server source filter"] label:visible', { hasText: 'Template' }).click();
      await page.getByRole('switch', { name: 'Disable github' }).click();
      const dialog = page.getByRole('dialog');
      await expectVisible(dialog.getByText('Disable Template Server github?'));
      await expectVisible(dialog.getByText(/retires 1 active Template Server instance/i));
      await expectVisible(dialog.getByText(/Future matching requests create instances lazily/i));
      await dialog.getByRole('button', { name: 'Disable template' }).click();
      const templateRow = page.locator('tbody tr').filter({ hasText: 'github' }).filter({ hasText: 'Template' });
      await expectVisible(templateRow.getByText('disabled', { exact: true }));
      await expectVisible(templateRow.getByRole('switch', { name: 'Enable github' }));
    } finally {
      await page.context().close();
    }
  });

  it.each(['http', 'sse'] as const)('creates a remote %s target from its transport-specific controls', async (type) => {
    const page = await newPage({ width: 1280, height: 900 });
    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.getByRole('button', { name: 'Configure Custom Server' }).click();
      await page.getByLabel('Transport Type').selectOption(type);
      await page.getByLabel('Server Name').fill(`remote-${type}`);
      await page.getByLabel('URL').fill(`https://${type}.example/mcp`);
      await page.getByRole('button', { name: 'Preview server' }).click();
      await expectText(page, 'passed');
      await page.getByRole('button', { name: 'Create server' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Create server' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/mcpServers/remote-${type}`);
      await expectVisible(page.getByRole('heading', { name: `remote-${type}`, exact: true }));
    } finally {
      await page.context().close();
    }
  });

  it('requires an explicit browser confirmation to override failed remote connectivity', async () => {
    const page = await newPage({ width: 1280, height: 900 });
    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.getByRole('button', { name: 'Configure Custom Server' }).click();
      await page.getByLabel('Transport Type').selectOption('http');
      await page.getByLabel('Server Name').fill('connectivity-failure');
      await page.getByLabel('URL').fill('https://unreachable.example/mcp');
      await page.getByRole('button', { name: 'Preview server' }).click();
      await expectText(page, 'Connection refused');
      await page.getByRole('button', { name: 'Create server' }).click();
      const dialog = page.getByRole('dialog');
      await expectVisible(dialog.getByText('Create connectivity-failure despite failed connectivity?'));
      await dialog.getByRole('button', { name: 'Create despite failure' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/mcpServers/connectivity-failure`);
    } finally {
      await page.context().close();
    }
  });

  it.each([
    { name: 'apply-failure', message: 'could not be persisted' },
    { name: 'post-preview-conflict', message: 'already in use' },
  ])('keeps $name actionable without adding the target', async ({ name, message }) => {
    const page = await newPage({ width: 1280, height: 900 });
    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.getByRole('button', { name: 'Configure Custom Server' }).click();
      await page.getByLabel('Server Name').fill(name);
      await page.getByLabel('Command').fill('node');
      await page.getByRole('button', { name: 'Preview server' }).click();
      await page.getByRole('button', { name: 'Create server' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Create server' }).click();
      await expectText(page, message);
      await page.getByRole('button', { name: 'Back' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Discard draft' }).click();
      await expectText(page, '2 configured targets');
    } finally {
      await page.context().close();
    }
  });

  it('shows a truthful reload warning after creation before opening detail', async () => {
    const page = await newPage({ width: 1280, height: 900 });
    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.getByRole('button', { name: 'Configure Custom Server' }).click();
      await page.getByLabel('Server Name').fill('reload-failure');
      await page.getByLabel('Command').fill('node');
      await page.getByRole('button', { name: 'Preview server' }).click();
      await page.getByRole('button', { name: 'Create server' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Create server' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/mcpServers/reload-failure`);
      await expectText(page, 'reload observation timed out');
      await page.getByRole('button', { name: 'Open server detail' }).click();
      await expectVisible(page.getByRole('heading', { name: 'reload-failure', exact: true }));
    } finally {
      await page.context().close();
    }
  });

  it.each([
    { width: 375, height: 812, compactInventory: true },
    { width: 800, height: 900, compactInventory: false },
  ])(
    'keeps the built console usable at $width px without page-level horizontal overflow',
    async ({ width, height, compactInventory }) => {
      const page = await newPage({ width, height, isMobile: width === 375 });

      try {
        await expectCenteredLoginGate(page);
        await login(page, { skipNavigation: true });

        await expectText(page, 'Runtime operations');
        await expectText(page, 'Overview');
        await expectVisible(page.getByRole('button', { name: 'Refresh runtime data' }));
        await expectVisible(page.getByRole('button', { name: 'Log out' }));
        await expectNoPageOverflow(page);

        const navigationToggle = page.getByRole('button', { name: 'Open operations navigation' });
        await expectVisible(navigationToggle);
        await navigationToggle.click();
        await expectVisible(page.getByRole('navigation', { name: 'Operations navigation' }));
        await page.getByRole('link', { name: 'Server inventory' }).click();
        await page.waitForURL(`${baseUrl}/admin/servers`);

        if (compactInventory) {
          await expectVisible(page.locator('.server-mobile-card').first());
          expect(await page.locator('.server-table-view').count()).toBe(0);
        } else {
          await expectVisible(page.locator('.server-table-view'));
          expect(await page.locator('.server-mobile-card').count()).toBe(0);
        }

        await page.getByRole('button', { name: 'Open operations navigation' }).click();
        await expectVisible(page.getByRole('navigation', { name: 'Operations navigation' }));
        await page.getByRole('link', { name: 'OAuth services' }).click();
        await page.waitForURL(`${baseUrl}/admin/oauth`);
        await expectVisible(page.getByRole('heading', { name: 'OAuth services' }));
        await expectVisible(page.getByRole('button', { name: 'Open operations navigation' }));
        await expectNoPageOverflow(page);
      } finally {
        await page.context().close();
      }
    },
  );

  it('creates and reopens the first stdio server from a zero-server runtime at 375x812', async () => {
    configuredServerFixture.clear();
    const page = await newPage({ width: 375, height: 812, isMobile: true });

    try {
      await expectCenteredLoginGate(page);
      const visibilityToggle = page.getByRole('button', { name: 'Show password' });
      const toggleSize = await visibilityToggle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      expect(toggleSize.width).toBeGreaterThanOrEqual(44);
      expect(toggleSize.height).toBeGreaterThanOrEqual(44);
      await visibilityToggle.focus();
      await page.keyboard.press('Enter');
      await expectVisible(page.getByRole('button', { name: 'Hide password' }));
      await login(page, { skipNavigation: true });

      await page.getByRole('button', { name: 'Open operations navigation' }).click();
      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers`);
      await expectText(page, 'No servers configured');
      await page.getByRole('button', { name: 'Configure server' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/new`);
      expect(await page.getByRole('heading', { name: 'Server inventory' }).count()).toBe(0);
      await page.getByLabel('Server Name').fill('first-stdio');
      await page.getByLabel('Command').fill('node');
      await page.getByRole('button', { name: 'Preview server' }).click();
      await page.getByRole('button', { name: 'Create server' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Create server' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/mcpServers/first-stdio`);
      await expectVisible(page.getByRole('heading', { name: 'first-stdio', exact: true }));
      await expectNoPageOverflow(page);

      await page.getByRole('button', { name: 'Back' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers`);
      await expectText(page, '1 configured target');
      await page.getByRole('button', { name: 'Edit static first-stdio server' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/mcpServers/first-stdio`);
      await expectVisible(page.getByRole('heading', { name: 'first-stdio', exact: true }));
      await expectNoPageOverflow(page);
    } finally {
      await page.context().close();
    }
  });

  it('uses mutually exclusive browse and task workspaces at 1440 px and restores filters on Back', async () => {
    const page = await newPage({ width: 1440, height: 900 });

    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.getByRole('link', { name: 'Server inventory' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers`);
      await page.getByLabel('Search servers').fill('github');
      await waitForRowCount(page, 1);
      await expectNoPageOverflow(page);

      await page.getByRole('button', { name: 'Edit static github server' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers/mcpServers/github`);
      expect(await page.locator('.server-table-view').isVisible()).toBe(false);
      expect(await page.getByRole('heading', { name: 'Server inventory' }).count()).toBe(0);
      const widthRatio = await page.locator('.server-task-workspace').evaluate((element) => {
        const taskWidth = element.getBoundingClientRect().width;
        const workspaceWidth = element.closest('.operations-workspace')?.getBoundingClientRect().width ?? taskWidth;
        return taskWidth / workspaceWidth;
      });
      expect(widthRatio).toBeGreaterThan(0.95);
      await expectNoPageOverflow(page);

      await page.getByRole('button', { name: 'Back' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers`);
      await expectVisible(page.getByRole('heading', { name: 'Server inventory' }));
      expect(await page.getByLabel('Search servers').inputValue()).toBe('github');
      await waitForRowCount(page, 1);
    } finally {
      await page.context().close();
    }
  });

  it('keeps the 26-tag matrix controls separated and removes nested vertical scrolling', async () => {
    const page = await newPage({ width: 1440, height: 1100 });

    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.getByRole('link', { name: 'Presets' }).click();
      await page.waitForURL(`${baseUrl}/admin/presets`);
      await expectVisible(page.getByRole('heading', { name: 'Tag matrix' }));
      expect(await page.locator('.preset-tag-row').count()).toBeGreaterThanOrEqual(26);

      for (const matrixWidth of [350, 520, 800]) {
        await page.locator('.workspace-grid').evaluate((element) => {
          (element as HTMLElement).style.display = 'block';
        });
        await page.locator('.preset-tag-builder').evaluate((element, width) => {
          const builder = element as HTMLElement;
          builder.style.width = `${width}px`;
          builder.style.maxWidth = 'none';
        }, matrixWidth);

        const result = await page.locator('.preset-tag-builder').evaluate((builder) => {
          const list = builder.querySelector('.preset-tag-list') as HTMLElement | null;
          const rows = Array.from(builder.querySelectorAll('.preset-tag-row')) as HTMLElement[];
          const overlap = rows.some((row) => {
            const identity = row.querySelector('.preset-tag-identity')?.getBoundingClientRect();
            const state = row.querySelector('.preset-tag-state')?.getBoundingClientRect();
            const servers = row.querySelector('.preset-tag-servers')?.getBoundingClientRect();
            if (!identity || !state || !servers) return true;
            const intersects = (left: DOMRect, right: DOMRect) =>
              left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
            return intersects(identity, state) || intersects(servers, state);
          });
          const controlHeights = rows.map(
            (row) => row.querySelector('.mantine-SegmentedControl-root')?.getBoundingClientRect().height ?? 0,
          );
          return {
            overlap,
            nestedScroll: list ? list.scrollHeight > list.clientHeight + 1 : true,
            minControlHeight: Math.min(...controlHeights),
          };
        });

        expect(result.overlap, `tag content overlaps at ${matrixWidth}px`).toBe(false);
        expect(result.nestedScroll, `tag list scrolls internally at ${matrixWidth}px`).toBe(false);
        expect(result.minControlHeight, `tag state control is too short at ${matrixWidth}px`).toBeGreaterThanOrEqual(
          44,
        );
      }
    } finally {
      await page.context().close();
    }
  });

  it('manages instruction drafts, previews, activation, legacy import, and deletion in the packaged console', async () => {
    const page = await newPage({ width: 1440, height: 1000 });

    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.getByRole('link', { name: 'Instructions' }).click();
      await page.waitForURL(`${baseUrl}/admin/instructions`);

      await expectVisible(page.getByRole('heading', { name: 'Instruction templates' }));
      await expectText(page, 'CLI rendering fell back to the built-in template for operator');
      await page.getByRole('button', { name: /default/ }).click();
      expect(await page.getByRole('button', { name: 'Delete template' }).isDisabled()).toBe(true);

      await page.getByLabel('Clone as').fill('operator');
      await page.getByRole('button', { name: 'Clone template' }).click();
      await page.getByRole('button', { name: /operator/ }).click();

      await page.getByLabel('Initialization template').fill('Initialize {{instructions}} for this request');
      await page.getByRole('tab', { name: 'CLI' }).click();
      await page.getByLabel('CLI template').fill('{{#if instructions}}Unclosed block');
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expectText(page, 'Draft validation');
      await expectText(page, 'CLI: Template syntax error');

      await page.getByLabel('CLI template').fill('CLI {{instructions}}');
      await page.getByRole('button', { name: 'Save draft' }).click();
      await page.getByRole('tab', { name: 'Initialization' }).click();
      await page.locator('[aria-label="Preview target selection"]').getByText('Tags', { exact: true }).click();
      await page.getByRole('textbox', { name: 'Tags' }).fill('docs, search');
      await page.getByRole('checkbox', { name: 'Use explicit request context' }).check();
      await page.getByLabel('Project name').fill('docs');
      await page.getByLabel('User name').fill('operator');
      await page.getByLabel('Environment prefixes').fill('ONE_MCP_, CI');
      await page.getByRole('button', { name: 'Preview initialize' }).click();
      await expectText(page, 'Rendered');
      await expectText(page, 'docs,search');
      await expectText(page, 'Unresolved Template Servers: github-context');
      const effectiveServers = page.getByLabel('Effective servers');
      await expectVisible(effectiveServers);
      await expectVisible(effectiveServers.getByText(/mcpServers \/\s*github/));
      await expectVisible(effectiveServers.getByText(/mcpTemplates \/\s*github/));
      await expectVisible(effectiveServers.getByText('Instructions', { exact: true }));
      await expectVisible(effectiveServers.getByText('No instructions', { exact: true }));
      expect(instructionTemplateFixture.lastPreview).toMatchObject({
        identity: 'operator',
        surface: 'initialize',
        selection: { mode: 'tags', tags: ['docs', 'search'] },
        requestContext: {
          project: { name: 'docs' },
          user: { name: 'operator' },
          environment: { prefixes: ['ONE_MCP_', 'CI'] },
        },
      });

      await page.getByRole('button', { name: 'Validate both surfaces' }).click();
      await page.getByRole('button', { name: 'Activate template' }).click();
      await expectText(page, 'Active: operator');
      await page.getByRole('button', { name: 'Delete template' }).click();
      await expectText(page, 'Activate another template before deleting this one.');

      await page.getByRole('button', { name: /default/ }).click();
      await page.getByRole('button', { name: 'Validate both surfaces' }).click();
      await page.getByRole('button', { name: 'Activate template' }).click();
      await page.getByRole('button', { name: /operator/ }).click();
      await page.getByRole('button', { name: 'Delete template' }).click();
      const deleteDialog = page.getByRole('dialog');
      await expectVisible(deleteDialog.getByText('Delete operator?'));
      await deleteDialog.getByRole('button', { name: 'Delete template' }).click();
      await page.waitForFunction(() => globalThis.document.querySelectorAll('.instruction-template-row').length === 1);
      expect(await page.locator('.instruction-template-row').count()).toBe(1);

      await page.getByLabel('Import legacy as').fill('legacy-copy');
      await page.getByRole('button', { name: 'Import legacy template' }).click();
      await expectText(page, 'legacy-copy');
      await expectNoPageOverflow(page);
    } finally {
      await page.context().close();
    }
  });

  it('persists light and dark themes across the supported screenshot viewports', async () => {
    const viewports = [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 375, height: 812 },
    ];

    if (SCREENSHOT_DIR) mkdirSync(SCREENSHOT_DIR, { recursive: true });

    for (const theme of ['light', 'dark'] as const) {
      for (const viewport of viewports) {
        const page = await newPage({ ...viewport, isMobile: viewport.width === 375 });

        try {
          await expectCenteredLoginGate(page);
          await login(page, { skipNavigation: true });
          await page.getByRole('button', { name: 'Choose color theme' }).click();
          await page.getByRole('menuitem', { name: theme === 'light' ? /^Light theme/ : /^Dark theme/ }).click();
          await page.reload();
          await page.waitForFunction(
            (expectedTheme) => globalThis.document.documentElement.dataset.mantineColorScheme === expectedTheme,
            theme,
          );

          await page.goto(`${baseUrl}/admin/presets`);
          await page.waitForURL(`${baseUrl}/admin/presets`);
          await expectVisible(page.getByRole('heading', { name: 'Tag matrix' }));
          await expectNoPageOverflow(page);

          if (SCREENSHOT_DIR) {
            await page.locator('.preset-tag-row').first().scrollIntoViewIfNeeded();
            await page.screenshot({
              path: path.join(SCREENSHOT_DIR, `preset-matrix-${theme}-${viewport.width}x${viewport.height}.png`),
            });
          }
        } finally {
          await page.context().close();
        }
      }
    }
  }, 60000);

  it('deletes static and Template definitions independently with exact typed confirmation', async () => {
    configuredServerFixture.showTemplateInventory();
    const page = await newPage({ width: 1280, height: 900 });

    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.goto(`${baseUrl}/admin/servers/mcpServers/github`);
      await expectVisible(page.getByRole('button', { name: 'Preview deletion' }));
      await page.getByRole('button', { name: 'Preview deletion' }).click();
      await expectText(page, 'The same-named definition in the other source remains.');
      await expectText(page, 'Identity: mcpServers/github');
      await expectText(page, 'Authority: shadowed');
      await expectText(page, 'Target fingerprint: configured_server_fixture');
      await expectText(page, 'Removal diff: present definition to removed');
      await expectText(page, 'Backup: required recovery copy before write');
      await expectText(page, 'Reload: observe after write');
      await expectText(page, 'Redacted definition');
      const staticConfirm = page.getByLabel('Type mcpServers/github to confirm');
      await staticConfirm.fill('github');
      expect(await page.getByRole('button', { name: 'Delete definition' }).isDisabled()).toBe(true);
      await staticConfirm.fill('mcpServers/github');
      await page.getByRole('button', { name: 'Delete definition' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers`);
      await expectText(page, 'mcpServers/github deleted');
      await expectText(page, 'Runtime reload observed.');
      await expectText(page, 'Configured backend removal observed after reload.');
      await expectVisible(page.getByRole('button', { name: 'Edit template github server' }));

      await page.getByRole('button', { name: 'Edit template github server' }).click();
      expect(await page.getByText('mcpServers/github deleted').count()).toBe(0);
      await page.getByRole('button', { name: 'Preview deletion' }).click();
      await expectText(page, '1 active instance will be retired after reload.');
      await page.getByLabel('Type mcpTemplates/github to confirm').fill('mcpTemplates/github');
      await page.getByRole('button', { name: 'Delete definition' }).click();
      await page.waitForURL(`${baseUrl}/admin/servers`);
      await page.waitForFunction(
        () => globalThis.document.querySelectorAll('[aria-label="Edit template github server"]').length === 0,
      );
      await expectText(page, 'mcpTemplates/github deleted');
      await expectText(page, 'Instances: 1 before, 1 retired, 0 active after. Retirement observed: yes.');
      await page.getByRole('button', { name: 'Dismiss deletion notice' }).click();
      expect(await page.getByText('mcpTemplates/github deleted').count()).toBe(0);
      await expectNoPageOverflow(page);
    } finally {
      await page.context().close();
    }
  }, 60000);

  it('keeps post-write delete recovery visible when runtime reload fails', async () => {
    configuredServerFixture.failNextDeleteReload();
    const page = await newPage({ width: 1280, height: 900 });

    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });
      await page.goto(`${baseUrl}/admin/servers/mcpServers/github`);
      await page.getByRole('button', { name: 'Preview deletion' }).click();
      await page.getByLabel('Type mcpServers/github to confirm').fill('mcpServers/github');
      await page.getByRole('button', { name: 'Delete definition' }).click();

      await page.waitForURL(`${baseUrl}/admin/servers/mcpServers/github`);
      await expectText(page, 'The definition was deleted from disk, but runtime reload failed');
      await expectText(page, 'runtime may still serve this target');
      await expectText(page, 'A recovery backup exists');
      await expectNoPageOverflow(page);
    } finally {
      await page.context().close();
    }
  }, 60000);

  it('keeps source-qualified same-name overrides independent and forwards only explicit preview context', async () => {
    const page = await newPage({ width: 1280, height: 900 });

    try {
      await expectCenteredLoginGate(page);
      await login(page, { skipNavigation: true });

      const staticDetail = await adminApi(page, 'GET', '/admin/api/configured-servers/mcpServers/github');
      const templateDetail = await adminApi(page, 'GET', '/admin/api/configured-servers/mcpTemplates/github');
      expect(staticDetail.status).toBe(200);
      expect(templateDetail.status).toBe(200);
      expect(staticDetail.body.server.target.source).toBe('mcpServers');
      expect(templateDetail.body.server.target.source).toBe('mcpTemplates');

      const replacePreview = await adminApi(page, 'POST', '/admin/api/configured-servers/mcpTemplates/github/preview', {
        edit: { instructionOverride: { action: 'set', value: 'Template replacement' } },
      });
      expect(replacePreview.status).toBe(200);
      expect(configuredServerFixture.lastEdit).toMatchObject({
        targetSource: 'mcpTemplates',
        targetName: 'github',
        edit: { instructionOverride: { action: 'set', value: 'Template replacement' } },
      });
      const replaceApply = await adminApi(page, 'POST', '/admin/api/configured-servers/mcpTemplates/github/apply', {
        edit: { instructionOverride: { action: 'set', value: 'Template replacement' } },
        previewFingerprint: 'preview_fixture',
      });
      expect(replaceApply.status).toBe(200);
      expect(
        (await adminApi(page, 'GET', '/admin/api/configured-servers/mcpTemplates/github')).body.server
          .instructionOverride,
      ).toEqual({ state: 'replace', value: 'Template replacement' });

      const suppressApply = await adminApi(page, 'POST', '/admin/api/configured-servers/mcpTemplates/github/apply', {
        edit: { instructionOverride: { action: 'set', value: '' } },
        previewFingerprint: 'preview_fixture',
      });
      expect(suppressApply.status).toBe(200);
      expect(
        (await adminApi(page, 'GET', '/admin/api/configured-servers/mcpTemplates/github')).body.server
          .instructionOverride,
      ).toEqual({ state: 'suppress', value: '' });
      const removeApply = await adminApi(page, 'POST', '/admin/api/configured-servers/mcpTemplates/github/apply', {
        edit: { instructionOverride: { action: 'remove' } },
        previewFingerprint: 'preview_fixture',
      });
      expect(removeApply.status).toBe(200);
      expect(
        (await adminApi(page, 'GET', '/admin/api/configured-servers/mcpTemplates/github')).body.server
          .instructionOverride,
      ).toEqual({ state: 'upstream' });
      expect(
        (await adminApi(page, 'GET', '/admin/api/configured-servers/mcpServers/github')).body.server
          .instructionOverride,
      ).toEqual({ state: 'upstream' });

      const preview = await adminApi(page, 'POST', '/admin/api/instruction-templates/default/preview', {
        surface: 'initialize',
        selection: { mode: 'preset', preset: 'missing-preset' },
        requestContext: {
          project: { custom: { requestId: 'explicit-only' } },
          user: {},
          environment: {},
        },
      });
      expect(preview.status).toBe(200);
      expect(preview.body.result.unresolvedTemplates).toEqual(['missing-preset']);
      expect(instructionTemplateFixture.lastPreview?.requestContext).toEqual({
        project: { custom: { requestId: 'explicit-only' } },
        user: {},
        environment: {},
      });
      const contextFreePreview = await adminApi(page, 'POST', '/admin/api/instruction-templates/default/preview', {
        surface: 'cli',
        selection: { mode: 'all' },
      });
      expect(contextFreePreview.status).toBe(200);
      expect(instructionTemplateFixture.lastPreview).not.toHaveProperty('requestContext');
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
    const browserErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    const response = await page.goto(`${baseUrl}/admin`);
    try {
      await expectVisible(page.getByRole('heading', { name: 'Operator login' }));
    } catch (error) {
      throw new Error(
        `Admin login gate did not render (HTTP ${response?.status() ?? 'unknown'}). Browser errors: ${browserErrors.join(' | ') || 'none'}. Body: ${await page.locator('body').innerText()}`,
        { cause: error },
      );
    }
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
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
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

type ResettableConfiguredServerFixture = AdminConfiguredServerOperations & {
  reset(): void;
  clear(): void;
  refreshCount: number;
  lastEdit?: Record<string, unknown>;
  showTemplateInventory(): void;
  failNextDeleteReload(): void;
};
type ResettableInstructionTemplateFixture = AdminInstructionTemplateOperations & {
  reset(): void;
  lastPreview?: Record<string, unknown>;
};

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

async function adminApi(
  page: Page,
  method: 'GET' | 'POST',
  pathName: string,
  body?: Record<string, unknown>,
): Promise<{
  status: number;
  body: {
    server: ConfiguredServerReadModel;
    result: AdminInstructionPreviewResult;
  };
}> {
  return page.evaluate(
    async ({ method: requestMethod, pathName: requestPath, body: requestBody }) => {
      const session = (await fetch('/admin/api/session').then((response) => response.json())) as { csrfToken: string };
      const response = await fetch(requestPath, {
        method: requestMethod,
        headers: {
          ...(requestMethod === 'POST'
            ? { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }
            : {}),
        },
        ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
      });
      return { status: response.status, body: await response.json() };
    },
    { method, pathName, body },
  );
}

function createConfiguredServerFixture(): ResettableConfiguredServerFixture {
  let servers = createConfiguredServerReadModels();
  let templateServer = createTemplateConfiguredServerReadModel();
  let templateDeleted = false;
  let deleteReloadFailure = false;
  let disabledTools: string[] = [];
  let toolDescriptionOverrides: Record<string, string> = {};
  let templateInventoryVisible = false;

  const fixture: ResettableConfiguredServerFixture = {
    refreshCount: 0,
    reset() {
      servers = createConfiguredServerReadModels();
      templateServer = createTemplateConfiguredServerReadModel();
      templateDeleted = false;
      deleteReloadFailure = false;
      fixture.lastEdit = undefined;
      fixture.refreshCount = 0;
      disabledTools = [];
      toolDescriptionOverrides = {};
      templateInventoryVisible = false;
    },
    clear() {
      servers = [];
    },
    showTemplateInventory() {
      templateInventoryVisible = true;
    },
    failNextDeleteReload() {
      deleteReloadFailure = true;
    },
    async getConfiguredServerCreateContract() {
      return operationSuccess('getConfiguredServerCreateContract', 'op_create_contract', {
        schemaVersion: 1,
        capabilities: {
          create: { supported: true },
          forceReplacement: { supported: false },
          rawJson: { supported: false },
          preview: { supported: true },
          apply: { supported: true },
        },
        secretPolicy: {
          allowedActions: ['replace'],
          environmentReference: {
            recommended: true,
            storesSecretMaterial: false,
            guidance: 'Keep secret material in the runtime environment.',
          },
          inlineReplacement: {
            emphasis: 'secondary',
            guidance: 'Use inline replacement only when an environment reference is unsuitable.',
          },
        },
        fieldGroups: createFieldGroups(),
      });
    },
    async previewConfiguredServerCreate(input) {
      const draft = input.draft as {
        source?: 'mcpServers' | 'mcpTemplates';
        name?: string;
        enabled?: boolean;
        tags?: string[];
        transport?: Record<string, unknown>;
      };
      const name = draft.name ?? '';
      const source = draft.source === 'mcpTemplates' ? 'mcpTemplates' : 'mcpServers';
      const exists = servers.some((server) => server.id === name) || templateServer.id === name;
      const templatePreview = source === 'mcpTemplates';
      return operationSuccess('previewConfiguredServerCreate', 'op_create_preview', {
        targetName: name,
        previewFingerprint: `preview_create_${name}`,
        validation: exists
          ? {
              status: 'invalid' as const,
              errors: [
                {
                  fieldPath: ['name'],
                  code: 'configured_server_destination_conflict',
                  message: 'A configured target already uses this name.',
                },
              ],
            }
          : { status: 'valid' as const, errors: [] },
        diff: exists
          ? []
          : [
              { fieldPath: ['name'], oldValue: undefined, newValue: name, riskFlags: [] },
              {
                fieldPath: ['enabled'],
                oldValue: undefined,
                newValue: draft.enabled !== false,
                riskFlags: ['connection_critical' as const],
              },
            ],
        configChange: {
          status: exists ? 'destination_conflict' : 'changed',
          operation: templatePreview ? 'create_template' : 'create_static',
          configPath: '[redacted]',
          target: { name, source },
          changed: !exists,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'skipped' },
          warnings: [],
        },
        connectivityCheck: templatePreview
          ? { status: 'skipped' as const, reason: 'template_structural_preview' as const }
          : draft.transport?.type === 'stdio'
            ? { status: 'skipped' as const, reason: 'local_stdio_transport' as const }
            : String(draft.transport?.url).includes('unreachable')
              ? { status: 'failed' as const, mode: 'bounded_dry_run' as const, message: 'Connection refused' }
              : { status: 'passed' as const, mode: 'bounded_dry_run' as const },
        expectedReload: {
          policy: 'observe_after_write' as const,
          possibleStatuses: ['observed', 'runtime_not_running', 'reload_disabled', 'failed'] as const,
        },
        ...(templatePreview
          ? {
              templateAnalysis: {
                syntax: { valid: true, errors: [] },
                variables: ['project.command'],
                unresolvedVariables: ['project.command'],
                fields: [
                  {
                    fieldPath: ['transport', 'command'],
                    variables: ['project.command'],
                    syntax: { valid: true as const },
                  },
                ],
              },
              runtimeImpact: { activeInstanceCount: 0, retirementRequired: false, createsInstance: false as const },
              warnings: ['Creating a Template Server definition does not create a runtime instance.'],
            }
          : {}),
      });
    },
    async applyConfiguredServerCreate(input) {
      const draft = input.draft as {
        source?: 'mcpServers' | 'mcpTemplates';
        name?: string;
        enabled?: boolean;
        tags?: string[];
        transport?: Record<string, unknown>;
      };
      const name = draft.name ?? 'custom';
      const source = draft.source === 'mcpTemplates' ? 'mcpTemplates' : 'mcpServers';
      if (name === 'apply-failure') {
        throw new AdminConfiguredServerApplyError('configured_server_create_failed');
      }
      if (name === 'post-preview-conflict') {
        throw new AdminConfiguredServerApplyError('configured_server_destination_conflict');
      }
      const type = String(draft.transport?.type ?? 'stdio');
      const label = type === 'stdio' ? String(draft.transport?.command ?? '') : String(draft.transport?.url ?? '');
      const created: ConfiguredServerReadModel = {
        id: name,
        source,
        target: { type: 'configured_server', id: name, source },
        enabled: draft.enabled !== false,
        tags: draft.tags ?? [],
        transportSummary: { kind: type, label },
        mutationAvailability: {
          available: source === 'mcpServers',
          operations: source === 'mcpServers' ? ['enable', 'disable'] : [],
        },
        actionState: actionState(name, draft.enabled !== false),
        transport: { ...(draft.transport ?? {}) },
        secretInputs: [],
        definition: {
          kind: source === 'mcpTemplates' ? 'template' : 'static',
          qualifiedId: `${source}/${name}`,
          authority: 'sole',
        },
        runtime: { objectKind: 'definition', activeInstanceCount: 0 },
        ...(source === 'mcpTemplates'
          ? {
              templateAnalysis: {
                syntax: { valid: true, errors: [] },
                variables: ['project.command'],
                unresolvedVariables: ['project.command'],
                fields: [],
              },
            }
          : {}),
      };
      if (source === 'mcpTemplates') templateServer = created;
      else servers.push(created);
      const configChange = configChangeResult(name, true);
      if (name === 'reload-failure') {
        configChange.reload = { status: 'failed', error: 'reload observation timed out' };
      }
      return operationSuccess('applyConfiguredServerCreate', 'op_create_apply', {
        targetName: name,
        targetSource: source,
        previewFingerprint: input.previewFingerprint,
        configChange: {
          ...configChange,
          operation: source === 'mcpTemplates' ? 'create_template' : 'create_static',
          target: { name, source },
        },
        ...(source === 'mcpTemplates'
          ? { runtimeImpact: { activeInstanceCount: 0 as const, createdInstance: false as const } }
          : {}),
      });
    },
    async listConfiguredServers() {
      const inventory = templateInventoryVisible
        ? [
            ...servers.map((server) =>
              server.id === templateServer.id
                ? {
                    ...server,
                    definition: {
                      kind: 'static' as const,
                      qualifiedId: `mcpServers/${server.id}`,
                      authority: 'shadowed' as const,
                    },
                  }
                : server,
            ),
            ...(templateDeleted
              ? []
              : [
                  {
                    ...templateServer,
                    definition: {
                      kind: 'template' as const,
                      qualifiedId: `mcpTemplates/${templateServer.id}`,
                      authority: 'authoritative' as const,
                    },
                  },
                ]),
          ]
        : servers;
      return operationSuccess('listConfiguredServers', 'op_list', { servers: inventory });
    },
    async getConfiguredServerDetail(input) {
      const server =
        input.targetSource === 'mcpTemplates'
          ? !templateDeleted && templateServer.id === input.targetName
            ? templateServer
            : undefined
          : servers.find((candidate) => candidate.id === input.targetName);
      if (!server) {
        throw new AdminConfiguredServerNotFoundError(input.targetName);
      }
      return operationSuccess('getConfiguredServerDetail', 'op_detail', {
        server,
        editContract: {
          schemaVersion: 3,
          target: server.target,
          capabilities: {
            singleTargetEdit: true,
            rename: { supported: true },
            create: { supported: false },
            delete: { supported: true },
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
                  fieldPath: ['id'],
                  label: 'Target ID',
                  control: 'text',
                  value: server.id,
                  editable: true,
                },
                {
                  fieldPath: ['tags'],
                  label: 'Tags',
                  control: 'tag-list',
                  value: [...server.tags],
                  editable: true,
                },
                ...(server.source === 'mcpTemplates'
                  ? [
                      {
                        fieldPath: ['transport', 'command'],
                        label: 'Command',
                        control: 'text' as const,
                        value: String(server.transport.command ?? ''),
                        editable: true,
                        applicableTransportTypes: ['stdio' as const],
                      },
                      {
                        fieldPath: ['transport', 'template', 'shareable'],
                        label: 'Share instances',
                        control: 'switch' as const,
                        value: true,
                        editable: true,
                        applicableSources: ['mcpTemplates' as const],
                      },
                    ]
                  : []),
              ],
            },
          ],
        },
        ...(server.id === 'github' && server.source === 'mcpServers'
          ? {
              toolInventory: {
                ...configuredToolInventory(disabledTools, toolDescriptionOverrides, input.model),
                freshness: 'unavailable' as const,
                generation: 'generation-passive',
                inspection: {
                  status: 'unavailable' as const,
                  reason: 'snapshot_unavailable',
                  retryable: true,
                  instances: [],
                },
              },
            }
          : {}),
      });
    },
    async refreshConfiguredToolInventory(input) {
      fixture.refreshCount += 1;
      const inventory = configuredToolInventory(disabledTools, toolDescriptionOverrides, input.model);
      if (fixture.refreshCount === 1) {
        return operationSuccess('refreshConfiguredToolInventory', 'op_tool_refresh_1', {
          ...inventory,
          freshness: 'unavailable' as const,
          generation: 'generation-passive',
          inspection: {
            status: 'failed' as const,
            reason: 'inspection_failed',
            retryable: true,
            instances: [
              { instanceId: 'github-worker', status: 'failed' as const, error: 'inspection transport closed' },
            ],
          },
        });
      }
      return operationSuccess('refreshConfiguredToolInventory', `op_tool_refresh_${fixture.refreshCount}`, {
        ...inventory,
        generation: `generation-smoke-${fixture.refreshCount}`,
        inspection: {
          status: 'complete',
          retryable: false,
          instances: [{ instanceId: input.targetName, status: 'complete' }],
        },
      });
    },
    async previewConfiguredServerEdit(input) {
      fixture.lastEdit = {
        targetName: input.targetName,
        ...(input.targetSource ? { targetSource: input.targetSource } : {}),
        edit: input.edit,
      };
      const edit = input.edit && typeof input.edit === 'object' && !Array.isArray(input.edit) ? input.edit : {};
      const toolEdit = z
        .object({
          disabledTools: z.array(z.string()).optional(),
          toolDescriptionOverrides: z.record(z.string(), z.string()).optional(),
        })
        .passthrough()
        .parse(edit);
      const proposedTargetName =
        typeof (edit as { id?: unknown }).id === 'string' ? (edit as { id: string }).id : input.targetName;
      const transportEdit =
        (edit as { transport?: unknown }).transport && typeof (edit as { transport?: unknown }).transport === 'object'
          ? ((edit as { transport: Record<string, unknown> }).transport ?? {})
          : {};
      const malformedTemplate =
        input.targetSource === 'mcpTemplates' && JSON.stringify(transportEdit).includes('{{#if');
      const server =
        input.targetSource === 'mcpTemplates'
          ? templateServer.id === input.targetName
            ? templateServer
            : undefined
          : servers.find((candidate) => candidate.id === input.targetName);
      const proposedTags = Array.isArray((edit as { tags?: unknown }).tags)
        ? (edit as { tags: unknown[] }).tags.filter((tag): tag is string => typeof tag === 'string')
        : (server?.tags ?? []);
      const proposedDisabledTools = toolEdit.disabledTools ? toolEdit.disabledTools : disabledTools;
      const proposedOverrides = toolEdit.toolDescriptionOverrides ?? toolDescriptionOverrides;
      const currentInventory = configuredToolInventory(disabledTools, toolDescriptionOverrides, input.model);
      const proposedInventory = configuredToolInventory(proposedDisabledTools, proposedOverrides, input.model);
      return operationSuccess('previewConfiguredServerEdit', 'op_preview', {
        targetName: input.targetName,
        proposedTargetName,
        previewFingerprint: 'preview_fixture',
        validation: malformedTemplate
          ? {
              status: 'invalid' as const,
              errors: [
                {
                  fieldPath: ['transport', 'command'],
                  code: 'invalid_handlebars',
                  message: 'Invalid Handlebars syntax at line 1, column 0.',
                },
              ],
            }
          : { status: 'valid' as const, errors: [] },
        diff:
          Object.keys(transportEdit).length > 0 || proposedTargetName !== input.targetName
            ? [
                ...(proposedTargetName !== input.targetName
                  ? [
                      {
                        fieldPath: ['id'],
                        oldValue: input.targetName,
                        newValue: proposedTargetName,
                        riskFlags: ['rename' as const],
                      },
                    ]
                  : []),
                ...Object.entries(transportEdit).map(([key, value]) => ({
                  fieldPath: ['transport', key],
                  oldValue: server?.transport[key],
                  newValue: malformedTemplate ? '[REDACTED]' : value,
                  riskFlags: [key === 'template' ? ('template_risk' as const) : ('connection_critical' as const)],
                })),
              ]
            : Object.hasOwn(edit, 'instructionOverride')
              ? [
                  {
                    fieldPath: ['instructionOverride'],
                    oldValue: server?.instructionOverride ?? { state: 'upstream' },
                    newValue: (edit as { instructionOverride?: unknown }).instructionOverride,
                    riskFlags: ['template_risk' as const],
                  },
                ]
              : [
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
          target: { name: input.targetName, source: input.targetSource ?? 'mcpServers' },
          changed: !malformedTemplate,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'skipped' },
          warnings: [],
        },
        connectivityCheck:
          input.targetSource === 'mcpTemplates'
            ? { status: 'skipped' as const, reason: 'template_structural_preview' as const }
            : { status: 'skipped' as const, reason: 'connection_critical_fields_unchanged' as const },
        ...(input.targetSource === 'mcpTemplates'
          ? {
              templateAnalysis: {
                syntax: {
                  valid: !malformedTemplate,
                  errors: malformedTemplate
                    ? [
                        {
                          fieldPath: ['transport', 'command'],
                          code: 'invalid_handlebars' as const,
                          message: 'Invalid Handlebars syntax at line 1, column 0.',
                        },
                      ]
                    : [],
                },
                variables: malformedTemplate ? [] : ['project.command'],
                unresolvedVariables: malformedTemplate ? [] : ['project.command'],
                fields: [],
              },
              runtimeImpact: { activeInstanceCount: 1, retirementRequired: true, createsInstance: false as const },
            }
          : {}),
        toolSelection: {
          capabilityGeneration: currentInventory.generation,
          model: proposedInventory.model,
          targetEnabled: true,
          changedTools: ['search'],
          counts: proposedInventory.counts,
          approximateTokens: {
            before: currentInventory.approximateTokens.enabled,
            after: proposedInventory.approximateTokens.enabled,
            savings: currentInventory.approximateTokens.enabled - proposedInventory.approximateTokens.enabled,
          },
          effect: 'immediate' as const,
          requiresZeroEnabledConfirmation: proposedInventory.counts.enabled === 0,
        },
      });
    },
    async applyConfiguredServerEdit(input) {
      const edit = input.edit && typeof input.edit === 'object' && !Array.isArray(input.edit) ? input.edit : {};
      const toolEdit = z
        .object({
          disabledTools: z.array(z.string()).optional(),
          toolDescriptionOverrides: z.record(z.string(), z.string()).optional(),
        })
        .passthrough()
        .parse(edit);
      const server =
        input.targetSource === 'mcpTemplates'
          ? templateServer.id === input.targetName
            ? templateServer
            : undefined
          : servers.find((candidate) => candidate.id === input.targetName);
      if (server && Array.isArray((edit as { tags?: unknown }).tags)) {
        server.tags = (edit as { tags: unknown[] }).tags.filter((tag): tag is string => typeof tag === 'string');
      }
      const proposedTargetName =
        typeof (edit as { id?: unknown }).id === 'string' ? (edit as { id: string }).id : input.targetName;
      const transportEdit =
        (edit as { transport?: unknown }).transport && typeof (edit as { transport?: unknown }).transport === 'object'
          ? (edit as { transport: Record<string, unknown> }).transport
          : undefined;
      if (server && transportEdit) server.transport = { ...server.transport, ...transportEdit };
      if (server && proposedTargetName !== input.targetName) {
        server.id = proposedTargetName;
        server.target = { ...server.target, id: proposedTargetName };
        if (server.definition) server.definition.qualifiedId = `${server.source}/${proposedTargetName}`;
      }
      const instructionOverride = (
        edit as {
          instructionOverride?: { action: 'set'; value: string } | { action: 'remove' };
        }
      ).instructionOverride;
      if (server && instructionOverride?.action === 'set') {
        server.instructionOverride = instructionOverride.value
          ? { state: 'replace', value: instructionOverride.value }
          : { state: 'suppress', value: '' };
      } else if (server && instructionOverride?.action === 'remove') {
        server.instructionOverride = { state: 'upstream' };
      }
      if (toolEdit.disabledTools) disabledTools = toolEdit.disabledTools;
      if (toolEdit.toolDescriptionOverrides) toolDescriptionOverrides = { ...toolEdit.toolDescriptionOverrides };
      return operationSuccess('applyConfiguredServerEdit', 'op_apply', {
        originalTargetName: input.targetName,
        targetName: proposedTargetName,
        previewFingerprint: input.previewFingerprint,
        configChange: configChangeResult(input.targetName, true),
      });
    },
    async previewConfiguredServerDelete(input) {
      const server =
        input.targetSource === 'mcpTemplates'
          ? !templateDeleted && templateServer.id === input.targetName
            ? templateServer
            : undefined
          : servers.find((candidate) => candidate.id === input.targetName);
      if (!server) throw new AdminConfiguredServerNotFoundError(input.targetName);
      const otherExists =
        input.targetSource === 'mcpTemplates'
          ? servers.some((candidate) => candidate.id === input.targetName)
          : !templateDeleted && templateServer.id === input.targetName;
      return operationSuccess('previewConfiguredServerDelete', 'op_delete_preview', {
        target: server.target,
        qualifiedId: `${input.targetSource}/${input.targetName}`,
        targetFingerprint: 'configured_server_fixture',
        previewFingerprint: `delete_preview_${input.targetSource}_${input.targetName}`,
        authority: server.definition?.authority ?? (otherExists ? ('shadowed' as const) : ('sole' as const)),
        removal: { definition: server, preservesSameNamedOtherSource: otherExists, cascades: false as const },
        configChange: {
          ...configChangeResult(input.targetName, true),
          operation: 'remove' as const,
          target: { name: input.targetName, source: input.targetSource },
        },
        expectedBackup: { policy: 'required' as const, recoveryCopy: true as const },
        expectedReload: {
          policy: 'observe_after_write' as const,
          possibleStatuses: ['observed', 'runtime_not_running', 'reload_disabled', 'failed'] as const,
        },
        runtimeImpact:
          input.targetSource === 'mcpTemplates'
            ? { kind: 'template' as const, activeInstanceCount: 1, retirement: 'reload_scheduled' as const }
            : { kind: 'static' as const, configuredBackendRemoval: 'after_reload' as const },
        warnings: otherExists ? ['The same-named definition in the other source remains.'] : [],
      });
    },
    async deleteConfiguredServer(input) {
      if (input.targetSource === 'mcpTemplates') templateDeleted = true;
      else servers = servers.filter((candidate) => candidate.id !== input.targetName);
      const reload = deleteReloadFailure
        ? { status: 'failed' as const, error: 'Runtime reload failed after the configuration was deleted.' }
        : { status: 'observed' as const };
      deleteReloadFailure = false;
      return operationSuccess('deleteConfiguredServer', 'op_delete', {
        target: { type: 'configured_server' as const, source: input.targetSource, id: input.targetName },
        qualifiedId: `${input.targetSource}/${input.targetName}`,
        previewFingerprint: input.previewFingerprint,
        configChange: {
          ...configChangeResult(input.targetName, true),
          operation: 'remove' as const,
          target: { name: input.targetName, source: input.targetSource },
          backup: { created: true, path: '[redacted]' },
          reload,
        },
        ...(input.targetSource === 'mcpTemplates'
          ? {
              runtimeImpact: {
                activeInstancesBefore: 1,
                retiredInstances: 1,
                activeInstancesAfter: 0,
                retirementObserved: true,
              },
            }
          : {}),
      });
    },
    async previewConfiguredServerLifecycle(input) {
      return operationSuccess('previewConfiguredServerLifecycle', 'op_lifecycle_preview', {
        target: templateServer.target,
        qualifiedId: `mcpTemplates/${input.targetName}`,
        targetFingerprint: 'configured_server_fixture',
        previewFingerprint: `lifecycle_preview_${input.targetName}_${input.enabled}`,
        current: { enabled: templateServer.enabled, disabledValueKind: 'context_expression' as const },
        proposed: { enabled: input.enabled, disabledValueKind: input.enabled ? ('absent' as const) : ('literal' as const) },
        expressionReplacement: {
          occurs: !input.enabled,
          replacement: input.enabled ? ('enabled_absent' as const) : ('disabled_true' as const),
        },
        configChange: {
          ...configChangeResult(input.targetName, input.enabled),
          target: { name: input.targetName, source: 'mcpTemplates' as const },
        },
        expectedBackup: { policy: 'required' as const, recoveryCopy: true as const },
        expectedReload: {
          policy: 'observe_after_write' as const,
          possibleStatuses: ['observed', 'runtime_not_running', 'reload_disabled', 'failed'] as const,
        },
        runtimeImpact: {
          activeInstanceCount: templateServer.runtime?.activeInstanceCount ?? 0,
          retirement: input.enabled ? ('not_required' as const) : ('after_successful_reload' as const),
          recreation: 'lazy_future_match_only' as const,
        },
        warnings: input.enabled
          ? ['Re-enable restores eligibility only; instances and Request Sessions are created lazily by future matching requests.']
          : ['Successful reload retires 1 active Template Server instance and removes its Request Session memberships.'],
      });
    },
    async applyConfiguredServerLifecycle(input) {
      templateServer.enabled = input.enabled;
      templateServer.actionState = input.enabled
        ? {
            enable: { available: false, label: 'Enable github', disabledReason: 'already_enabled' },
            disable: { available: true, label: 'Disable github' },
          }
        : {
            enable: { available: true, label: 'Enable github' },
            disable: { available: false, label: 'Disable github', disabledReason: 'already_disabled' },
          };
      if (templateServer.runtime) templateServer.runtime.activeInstanceCount = 0;
      return operationSuccess('applyConfiguredServerLifecycle', 'op_lifecycle_apply', {
        target: templateServer.target,
        qualifiedId: `mcpTemplates/${input.targetName}`,
        previewFingerprint: input.previewFingerprint,
        enabled: input.enabled,
        outcome: input.enabled ? ('enabled' as const) : ('disabled' as const),
        configChange: {
          ...configChangeResult(input.targetName, input.enabled),
          target: { name: input.targetName, source: 'mcpTemplates' as const },
        },
        runtimeImpact: {
          activeInstancesBefore: 1,
          retiredInstances: input.enabled ? 0 : 1,
          activeInstancesAfter: 0,
          retirementObserved: true,
        },
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
  return fixture;
}

function createInstructionTemplateFixture(): ResettableInstructionTemplateFixture {
  let state: InstructionTemplateAdminState;
  let fingerprintSequence = 0;
  const fixture: ResettableInstructionTemplateFixture = {
    reset() {
      fingerprintSequence = 1;
      fixture.lastPreview = undefined;
      state = {
        templates: [instructionTemplate('default', defaultInstructionVariants(), true, true)],
        activeIdentity: 'default',
        selectionExplicit: false,
        configFingerprint: 'fixture-1',
        legacyImportAvailable: true,
        renderFailures: {
          cli: {
            code: 'managed_template_render_failed',
            surface: 'cli',
            templateIdentity: 'operator',
            occurredAt: '2030-01-01T00:00:00.000Z',
          },
        },
      };
    },
    async listTemplates() {
      return operationSuccess('listInstructionTemplates', 'op_instruction_list', cloneInstructionState(state));
    },
    async getTemplate(input) {
      const template = state.templates.find((candidate) => candidate.identity === input.identity);
      if (!template) throw new Error('Instruction template was not found');
      return operationSuccess('getInstructionTemplate', 'op_instruction_detail', {
        template: structuredClone(template),
        configFingerprint: state.configFingerprint,
        renderFailures: state.renderFailures,
      });
    },
    async createTemplate(input) {
      state.templates.push(instructionTemplate(input.identity, input.variants, false, false));
      advanceInstructionFingerprint();
      return operationSuccess(
        'createInstructionTemplate',
        'op_instruction_create',
        configChangeResult(input.identity, true),
      );
    },
    async updateTemplate(input) {
      const index = state.templates.findIndex((candidate) => candidate.identity === input.identity);
      state.templates[index] = instructionTemplate(
        input.identity,
        input.variants,
        false,
        state.activeIdentity === input.identity,
      );
      advanceInstructionFingerprint();
      return operationSuccess(
        'updateInstructionTemplate',
        'op_instruction_update',
        configChangeResult(input.identity, true),
      );
    },
    async cloneTemplate(input) {
      const source = state.templates.find((candidate) => candidate.identity === input.sourceIdentity);
      if (!source)
        return operationSuccess('cloneInstructionTemplate', 'op_instruction_clone', { status: 'not_found' as const });
      state.templates.push(instructionTemplate(input.identity, source.variants, false, false));
      advanceInstructionFingerprint();
      return operationSuccess(
        'cloneInstructionTemplate',
        'op_instruction_clone',
        configChangeResult(input.identity, true),
      );
    },
    async validateTemplate(input) {
      const template = state.templates.find((candidate) => candidate.identity === input.identity);
      return operationSuccess('validateInstructionTemplate', 'op_instruction_validate', {
        identity: input.identity,
        validation: template?.validation,
        expectedConfigFingerprint: state.configFingerprint,
        previewFingerprint: `activate-${input.identity}-${state.configFingerprint}`,
      });
    },
    async previewTemplate(input) {
      fixture.lastPreview = {
        identity: input.identity,
        surface: input.surface,
        selection: input.selection,
        ...(input.requestContext ? { requestContext: input.requestContext } : {}),
      };
      const unresolvedTemplates =
        input.selection.mode === 'preset' && input.selection.preset === 'missing-preset'
          ? ['missing-preset']
          : input.selection.mode === 'tags'
            ? ['github-context']
            : [];
      const selectionLabel = input.selection.mode === 'tags' ? input.selection.tags.join(',') : input.selection.mode;
      const result: AdminInstructionPreviewResult = {
        surface: input.surface,
        rendered: `Rendered ${input.identity} for ${selectionLabel}`,
        effectiveServers: [
          { target: { source: 'mcpServers', name: 'github' }, hasInstructions: true },
          { target: { source: 'mcpTemplates', name: 'github' }, hasInstructions: false },
        ],
        unresolvedTemplates,
      };
      return operationSuccess('previewInstructionTemplate', 'op_instruction_preview', result);
    },
    async activateTemplate(input) {
      const template = state.templates.find((candidate) => candidate.identity === input.identity);
      if (!template)
        return operationSuccess('activateInstructionTemplate', 'op_instruction_activate', {
          status: 'not_found' as const,
        });
      if (!template.validation.valid) {
        return operationSuccess('activateInstructionTemplate', 'op_instruction_activate', {
          status: 'invalid' as const,
          validation: template.validation,
        });
      }
      state.activeIdentity = input.identity;
      state.selectionExplicit = true;
      state.templates = state.templates.map((candidate) => ({
        ...candidate,
        active: candidate.identity === input.identity,
        draft: candidate.identity !== input.identity && !candidate.protected,
      }));
      advanceInstructionFingerprint();
      return operationSuccess(
        'activateInstructionTemplate',
        'op_instruction_activate',
        configChangeResult(input.identity, true),
      );
    },
    async importLegacyTemplate(input) {
      state.templates.push(
        instructionTemplate(
          input.identity,
          { initialization: 'Legacy static initialization guidance', cli: 'Legacy static CLI guidance' },
          false,
          false,
        ),
      );
      advanceInstructionFingerprint();
      return operationSuccess(
        'importLegacyInstructionTemplate',
        'op_instruction_import',
        configChangeResult(input.identity, true),
      );
    },
    async previewDeleteTemplate(input) {
      const template = state.templates.find((candidate) => candidate.identity === input.identity);
      const allowed = Boolean(template && !template.protected && !template.active);
      return operationSuccess('previewDeleteInstructionTemplate', 'op_instruction_delete_preview', {
        identity: input.identity,
        allowed,
        reason: !template
          ? ('not_found' as const)
          : template.protected
            ? ('protected' as const)
            : template.active
              ? ('active_conflict' as const)
              : undefined,
        expectedConfigFingerprint: state.configFingerprint,
        previewFingerprint: `delete-${input.identity}-${state.configFingerprint}`,
      });
    },
    async deleteTemplate(input) {
      state.templates = state.templates.filter((candidate) => candidate.identity !== input.identity);
      advanceInstructionFingerprint();
      return operationSuccess(
        'deleteInstructionTemplate',
        'op_instruction_delete',
        configChangeResult(input.identity, true),
      );
    },
  };

  function advanceInstructionFingerprint(): void {
    fingerprintSequence += 1;
    state.configFingerprint = `fixture-${fingerprintSequence}`;
  }

  fixture.reset();
  return fixture;
}

function instructionTemplate(
  identity: string,
  variants: { initialization: string; cli: string },
  protectedTemplate: boolean,
  active: boolean,
): InstructionTemplateAdminState['templates'][number] {
  const initialization = instructionVariantValidation(variants.initialization);
  const cli = instructionVariantValidation(variants.cli);
  return {
    identity,
    variants: { ...variants },
    protected: protectedTemplate,
    active,
    draft: !active && !protectedTemplate,
    validation: { valid: initialization.valid && cli.valid, initialization, cli },
  };
}

function instructionVariantValidation(value: string): { valid: boolean; error?: string } {
  return validateTemplateContent(value, 'fixture', { allowUnsafeContent: true });
}

function defaultInstructionVariants(): { initialization: string; cli: string } {
  return {
    initialization: 'Initialize {{instructions}}',
    cli: 'CLI {{instructions}}',
  };
}

function cloneInstructionState(state: InstructionTemplateAdminState): InstructionTemplateAdminState {
  return structuredClone(state);
}

function configuredToolInventory(
  disabledTools: string[],
  toolDescriptionOverrides: Record<string, string>,
  model = 'gpt-4o',
) {
  const definitions = [
    { name: 'search', description: 'Search repositories', approximateTokens: 24 },
    { name: 'issues', description: 'List repository issues', approximateTokens: 20 },
  ];
  const rows = definitions.map((tool) => ({
    name: tool.name,
    upstreamDescription: tool.description,
    effectiveDescription: toolDescriptionOverrides[tool.name] ?? tool.description,
    ...(toolDescriptionOverrides[tool.name] ? { descriptionOverride: toolDescriptionOverrides[tool.name] } : {}),
    descriptionOverridden: Boolean(toolDescriptionOverrides[tool.name]),
    enabled: !disabledTools.includes(tool.name),
    observed: true,
    unresolved: false,
    observedInstanceCount: 1,
    activeInstanceCount: 1,
    observedInSomeInstances: false,
    approximateTokens: tool.approximateTokens,
  }));
  const enabledTokens = rows.reduce((total, row) => total + (row.enabled ? row.approximateTokens : 0), 0);
  return {
    targetName: 'github',
    source: 'mcpServers' as const,
    targetEnabled: true,
    freshness: 'live' as const,
    model,
    generation: 'generation-smoke',
    activeInstanceCount: 1,
    rows,
    counts: {
      observed: rows.length,
      enabled: rows.filter((row) => row.enabled).length,
      disabled: rows.filter((row) => !row.enabled).length,
      unresolved: 0,
    },
    approximateTokens: { enabled: enabledTokens, allObserved: 44, savings: 44 - enabledTokens },
  };
}

function createFieldGroups() {
  return [
    {
      id: 'identity',
      label: 'Identity',
      fields: [
        {
          fieldPath: ['source'],
          label: 'Definition Type',
          control: 'select' as const,
          value: 'mcpServers',
          options: ['mcpServers', 'mcpTemplates'],
          editable: true,
        },
        { fieldPath: ['name'], label: 'Server Name', control: 'text' as const, value: '', editable: true },
        {
          fieldPath: ['enabled'],
          label: 'Enabled',
          control: 'switch' as const,
          value: true,
          editable: true,
          applicableSources: ['mcpServers' as const],
        },
        { fieldPath: ['tags'], label: 'Tags', control: 'tag-list' as const, value: [], editable: true },
      ],
    },
    {
      id: 'transport',
      label: 'Transport',
      fields: [
        {
          fieldPath: ['transport', 'type'],
          label: 'Transport Type',
          control: 'select' as const,
          value: 'stdio',
          options: ['stdio', 'http', 'sse'],
          editable: true,
        },
        {
          fieldPath: ['transport', 'command'],
          label: 'Command',
          control: 'text' as const,
          value: '',
          editable: true,
          applicableTransportTypes: ['stdio' as const],
        },
        {
          fieldPath: ['transport', 'args'],
          label: 'Args',
          control: 'string-list' as const,
          value: [],
          editable: true,
          applicableTransportTypes: ['stdio' as const],
        },
        {
          fieldPath: ['transport', 'env'],
          label: 'Environment',
          control: 'record' as const,
          value: {},
          editable: true,
          applicableTransportTypes: ['stdio' as const],
        },
        {
          fieldPath: ['transport', 'url'],
          label: 'URL',
          control: 'text' as const,
          value: '',
          editable: true,
          applicableTransportTypes: ['http' as const, 'sse' as const],
        },
        {
          fieldPath: ['transport', 'headers'],
          label: 'Headers',
          control: 'record' as const,
          value: {},
          editable: true,
          applicableTransportTypes: ['http' as const, 'sse' as const],
        },
      ],
    },
    {
      id: 'template',
      label: 'Template instances',
      fields: [
        {
          fieldPath: ['transport', 'template', 'shareable'],
          label: 'Share instances',
          control: 'switch' as const,
          value: true,
          editable: true,
          applicableSources: ['mcpTemplates' as const],
        },
        {
          fieldPath: ['transport', 'template', 'maxInstances'],
          label: 'Maximum instances',
          control: 'number' as const,
          editable: true,
          applicableSources: ['mcpTemplates' as const],
        },
      ],
    },
  ];
}

function createConfiguredServerReadModels(): ConfiguredServerReadModel[] {
  const filesystemTags = Array.from({ length: 13 }, (_, index) =>
    index === 0 ? 'local-filesystem-and-document-storage' : `filesystem-tag-${String(index + 1).padStart(2, '0')}`,
  );
  const githubTags = Array.from({ length: 13 }, (_, index) =>
    index === 0 ? 'remote-source-code-and-collaboration' : `github-tag-${String(index + 1).padStart(2, '0')}`,
  );
  return [
    {
      id: 'filesystem',
      source: 'mcpServers',
      target: { type: 'configured_server', id: 'filesystem', source: 'mcpServers' },
      enabled: true,
      tags: filesystemTags,
      transportSummary: { kind: 'stdio', label: 'node ./servers/filesystem.js' },
      instructionOverride: { state: 'upstream' },
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
      tags: githubTags,
      transportSummary: { kind: 'http', label: 'https://mcp.example/github' },
      instructionOverride: { state: 'upstream' },
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

function createTemplateConfiguredServerReadModel(): ConfiguredServerReadModel {
  return {
    id: 'github',
    source: 'mcpTemplates',
    target: { type: 'configured_server', id: 'github', source: 'mcpTemplates' },
    enabled: true,
    tags: ['template'],
    transportSummary: { kind: 'stdio', label: '{{project.command}}' },
    mutationAvailability: { available: true, operations: ['enable', 'disable'] },
    actionState: {
      enable: { available: false, label: 'Enable github', disabledReason: 'already_enabled' },
      disable: { available: true, label: 'Disable github' },
    },
    transport: { type: 'stdio', command: '{{project.command}}', template: { shareable: true } },
    secretInputs: [],
    instructionOverride: { state: 'upstream' },
    definition: { kind: 'template', qualifiedId: 'mcpTemplates/github', authority: 'authoritative' },
    runtime: { objectKind: 'definition', activeInstanceCount: 1 },
    templateAnalysis: {
      syntax: { valid: true, errors: [] },
      variables: ['project.command'],
      unresolvedVariables: ['project.command'],
      fields: [],
    },
  };
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
