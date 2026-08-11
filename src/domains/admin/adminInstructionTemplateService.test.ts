import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  InstructionTemplateCollectionReadModel,
  InstructionTemplateManager,
  InstructionTemplateMutationResult,
} from '../instruction-template/instructionTemplateManager.js';
import type { ConfigChangeResult } from '../config-change/configChange.js';
import {
  type AdminInstructionPreviewInput,
  type AdminInstructionPreviewResult,
  AdminInstructionTemplateService,
} from './adminInstructionTemplateService.js';
import { type AdminOperationContext, AdminOperationService } from './adminOperationService.js';

describe('AdminInstructionTemplateService', () => {
  let storageDir: string;
  let state: InstructionTemplateCollectionReadModel;
  let manager: InstructionTemplateManager;
  let preview: ReturnType<
    typeof vi.fn<(input: AdminInstructionPreviewInput) => Promise<AdminInstructionPreviewResult>>
  >;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-instruction-template-'));
    state = collection();
    manager = {
      list: vi.fn(async () => state),
      create: vi.fn(async (input) => {
        state.templates.push({
          identity: input.identity,
          variants: input.template,
          protected: false,
          active: false,
          draft: true,
          validation: validation(false),
        });
        state.configFingerprint = 'config-2';
        return changed('template_create', input.identity);
      }),
      update: vi.fn(),
      clone: vi.fn(),
      delete: vi.fn(),
      activate: vi.fn(async (): Promise<InstructionTemplateMutationResult> => ({
        status: 'invalid',
        validation: validation(false),
      })),
      importLegacy: vi.fn(async () => changed('template_import', 'legacy')),
      validate: vi.fn(async () => validation(false)),
    };
    preview = vi.fn<(input: AdminInstructionPreviewInput) => Promise<AdminInstructionPreviewResult>>(async () => ({
      surface: 'cli',
      rendered: 'preview output',
      effectiveServers: [{ target: { source: 'mcpServers', name: 'alpha' }, hasInstructions: true }],
      unresolvedTemplates: ['contextual'],
    }));
  });

  afterEach(() => fs.rmSync(storageDir, { recursive: true, force: true }));

  it('saves invalid drafts and reports sanitized render failures while activation remains guarded', async () => {
    const service = createService({
      renderFailures: () => ({
        initialization: {
          surface: 'initialization',
          templateIdentity: 'broken',
          error: '/private/config/mcp.json: secret-token',
          occurredAt: new Date('2026-08-11T01:02:03.000Z'),
        },
      }),
    });

    const created = await service.createTemplate({
      context: context('create'),
      identity: 'broken',
      variants: { initialization: '{{#if open}}', cli: 'valid' },
      expectedConfigFingerprint: 'config-1',
    });
    const validated = await service.validateTemplate({
      context: context('validate'),
      identity: 'broken',
      expectedConfigFingerprint: 'config-2',
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const activated = await service.activateTemplate({
      context: context('activate'),
      identity: 'broken',
      expectedConfigFingerprint: 'config-2',
      previewFingerprint: validated.result.previewFingerprint,
    });
    const listed = await service.listTemplates({ context: context('list') });

    expect(created).toMatchObject({ ok: true, result: { status: 'changed' } });
    expect(activated).toMatchObject({ ok: true, result: { status: 'invalid', validation: { valid: false } } });
    expect(listed).toMatchObject({
      ok: true,
      result: {
        renderFailures: {
          initialize: {
            code: 'managed_template_render_failed',
            surface: 'initialize',
            templateIdentity: 'broken',
            occurredAt: '2026-08-11T01:02:03.000Z',
          },
        },
      },
    });
    expect(JSON.stringify(listed)).not.toContain('secret-token');
  });

  it('previews a selected surface and explicit context without persisting configuration', async () => {
    const service = createService();

    const result = await service.previewTemplate({
      context: context('preview'),
      identity: 'default',
      surface: 'cli',
      selection: { mode: 'tags', tags: ['docs'] },
      requestContext: {
        project: { name: 'admin-preview' },
        user: {},
        environment: {},
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: { rendered: 'preview output', unresolvedTemplates: ['contextual'] },
    });
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: 'default',
        surface: 'cli',
        template: state.templates[0].variants.cli,
        selection: { mode: 'tags', tags: ['docs'] },
        requestContext: expect.objectContaining({ project: { name: 'admin-preview' } }),
      }),
    );
    expect(manager.create).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.activate).not.toHaveBeenCalled();
  });

  it('imports only injected legacy initialization content', async () => {
    const service = createService({ legacyInitialization: () => 'legacy {{instructions}}' });

    const result = await service.importLegacyTemplate({
      context: context('import'),
      identity: 'legacy',
      expectedConfigFingerprint: 'config-1',
    });

    expect(result).toMatchObject({ ok: true, result: { status: 'changed' } });
    expect(manager.importLegacy).toHaveBeenCalledWith({
      identity: 'legacy',
      initialization: 'legacy {{instructions}}',
      expectedConfigFingerprint: 'config-1',
    });
  });

  it('completes a persisted mutation while preserving reload failure details', async () => {
    vi.mocked(manager.update).mockResolvedValue({
      ...changed('template_update', 'default'),
      reload: { status: 'failed', error: 'reload watcher unavailable' },
    });
    const service = createService();

    const result = await service.updateTemplate({
      context: context('reload-failed'),
      identity: 'default',
      variants: { initialization: 'init', cli: 'cli' },
      expectedConfigFingerprint: 'config-1',
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      result: { status: 'changed', changed: true, reload: { status: 'failed', error: 'reload watcher unavailable' } },
    });
  });

  function createService(
    overrides: {
      legacyInitialization?: () => string | undefined;
      renderFailures?: () => Record<string, unknown>;
    } = {},
  ) {
    return new AdminInstructionTemplateService({
      operationService: new AdminOperationService({ runtimeScopeId: 'scope', storageDir }),
      manager,
      preview,
      getLegacyInitialization: overrides.legacyInitialization ?? (() => undefined),
      getRenderFailures: overrides.renderFailures ?? (() => ({})),
    });
  }
});

function context(requestId: string): AdminOperationContext {
  return {
    actor: { type: 'admin_session', accountId: 'account', sessionId: 'session' },
    origin: 'browser',
    target: { type: 'instruction_template_collection' },
    runtimeIdentity: { runtimeScopeId: 'scope' },
    request: { requestId },
    idempotencyKey: `idem-${requestId}`,
    requestFingerprint: `fingerprint-${requestId}`,
  };
}

function collection(): InstructionTemplateCollectionReadModel {
  return {
    activeIdentity: 'default',
    selectionExplicit: false,
    configFingerprint: 'config-1',
    templates: [
      {
        identity: 'default',
        variants: { initialization: 'init {{instructions}}', cli: 'cli {{instructions}}' },
        protected: true,
        active: true,
        draft: false,
        validation: validation(true),
      },
    ],
  };
}

function validation(valid: boolean) {
  const result = valid ? { valid: true as const } : { valid: false as const, error: 'invalid' };
  return { valid, initialization: result, cli: result };
}

function changed(operation: string, identity: string): ConfigChangeResult {
  return {
    status: 'changed',
    operation: operation as never,
    configPath: '/config/mcp.json',
    target: { name: identity },
    changed: true,
    backup: { created: true },
    retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
    reload: { status: 'observed' },
    warnings: [],
  };
}
