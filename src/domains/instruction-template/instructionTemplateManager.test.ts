import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createConfigChangeService } from '../config-change/configChange.js';
import { createInstructionTemplateManager, DEFAULT_CLI_INSTRUCTION_TEMPLATE } from './instructionTemplateManager.js';

describe('InstructionTemplateManager', () => {
  let tempDir: string;
  let configPath: string;
  let reload: ReturnType<typeof vi.fn<(configPath: string) => void>>;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `instruction-template-manager-${randomBytes(4).toString('hex')}`);
    await fs.mkdir(tempDir, { recursive: true });
    configPath = path.join(tempDir, 'mcp.json');
    reload = vi.fn<(configPath: string) => void>();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('includes the protected default and reports validation facts for managed drafts', async () => {
    await writeConfig({
      mcpServers: {},
      instructionTemplates: {
        broken: { initialization: '{{#if open}}', cli: 'valid {{instructions}}' },
      },
      activeInstructionTemplate: 'broken',
    });

    const state = await manager().list();

    expect(state.activeIdentity).toBe('broken');
    expect(state.selectionExplicit).toBe(true);
    expect(state.templates[0]).toMatchObject({ identity: 'default', protected: true, draft: false });
    expect(state.templates[1]).toMatchObject({
      identity: 'broken',
      protected: false,
      active: true,
      draft: false,
      validation: { valid: false, initialization: { valid: false }, cli: { valid: true } },
    });
  });

  it('keeps exactly one protected default active when manually edited config violates identity invariants', async () => {
    await writeConfig({
      mcpServers: {},
      instructionTemplates: { default: { initialization: 'shadow', cli: 'shadow' } },
      activeInstructionTemplate: 'missing',
    });

    const state = await manager().list();

    expect(state.activeIdentity).toBe('default');
    expect(state.templates.filter((template) => template.identity === 'default')).toHaveLength(1);
    expect(state.templates.filter((template) => template.active)).toHaveLength(1);
    expect(state.templates[0]).toMatchObject({ identity: 'default', protected: true, active: true });
  });

  it('persists invalid drafts but rejects their activation without writing', async () => {
    await writeConfig({ mcpServers: {} });
    const service = manager();
    const initial = await service.list();

    const created = await service.create({
      identity: 'broken',
      template: { initialization: '{{#if open}}', cli: 'valid' },
      expectedConfigFingerprint: initial.configFingerprint,
    });
    expect(created.status).toBe('changed');
    expect((await readConfig()).instructionTemplates.broken.initialization).toBe('{{#if open}}');

    const afterCreate = await service.list();
    const activated = await service.activate({
      identity: 'broken',
      expectedConfigFingerprint: afterCreate.configFingerprint,
    });
    expect(activated).toMatchObject({ status: 'invalid', validation: { valid: false } });
    expect((await readConfig()).activeInstructionTemplate).toBeUndefined();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('clones default, protects active templates, and atomically changes the one active identity', async () => {
    await writeConfig({ mcpServers: {} });
    const service = manager();
    const initial = await service.list();
    const cloned = await service.clone({
      sourceIdentity: 'default',
      identity: 'team',
      expectedConfigFingerprint: initial.configFingerprint,
    });
    expect(cloned.status).toBe('changed');

    let state = await service.list();
    expect(
      (await service.delete({ identity: 'default', expectedConfigFingerprint: state.configFingerprint })).status,
    ).toBe('protected');
    expect(
      (await service.activate({ identity: 'team', expectedConfigFingerprint: state.configFingerprint })).status,
    ).toBe('changed');

    state = await service.list();
    expect(state.templates.filter((template) => template.active).map((template) => template.identity)).toEqual([
      'team',
    ]);
    expect(
      (await service.delete({ identity: 'team', expectedConfigFingerprint: state.configFingerprint })).status,
    ).toBe('active_conflict');
    expect(
      (await service.activate({ identity: 'default', expectedConfigFingerprint: state.configFingerprint })).status,
    ).toBe('changed');

    state = await service.list();
    expect(state.activeIdentity).toBe('default');
    expect(
      (await service.delete({ identity: 'team', expectedConfigFingerprint: state.configFingerprint })).status,
    ).toBe('changed');
  });

  it('imports legacy initialization content with the built-in CLI variant and rejects identity conflicts', async () => {
    await writeConfig({ mcpServers: {} });
    const service = manager();
    const initial = await service.list();
    expect(
      (
        await service.importLegacy({
          identity: 'legacy',
          initialization: 'legacy {{instructions}}',
          expectedConfigFingerprint: initial.configFingerprint,
        })
      ).status,
    ).toBe('changed');

    const state = await service.list();
    expect(state.templates.find((template) => template.identity === 'legacy')?.variants).toEqual({
      initialization: 'legacy {{instructions}}',
      cli: DEFAULT_CLI_INSTRUCTION_TEMPLATE,
    });
    expect(
      (
        await service.create({
          identity: 'legacy',
          template: { initialization: 'other', cli: 'other' },
          expectedConfigFingerprint: state.configFingerprint,
        })
      ).status,
    ).toBe('identity_conflict');
  });

  it('rejects stale writes before replacing a newer template collection', async () => {
    await writeConfig({ mcpServers: {} });
    const service = manager();
    const stale = await service.list();
    await writeConfig({ mcpServers: {}, instructionTemplates: { newer: { initialization: 'new', cli: 'new' } } });

    const result = await service.create({
      identity: 'stale',
      template: { initialization: 'old', cli: 'old' },
      expectedConfigFingerprint: stale.configFingerprint,
    });

    expect(result.status).toBe('conflict');
    expect((await readConfig()).instructionTemplates).toEqual({ newer: { initialization: 'new', cli: 'new' } });
    expect(
      (await service.delete({ identity: 'default', expectedConfigFingerprint: stale.configFingerprint })).status,
    ).toBe('conflict');
  });

  function manager() {
    return createInstructionTemplateManager({
      getConfigPath: () => configPath,
      configChangeService: createConfigChangeService({ getConfigPath: () => configPath, reloadConfig: reload }),
    });
  }

  async function writeConfig(config: Record<string, unknown>): Promise<void> {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  async function readConfig(): Promise<Record<string, any>> {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  }
});
