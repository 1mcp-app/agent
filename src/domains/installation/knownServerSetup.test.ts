import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as runtimeBootstrap from '@src/config/runtimeBootstrap.js';
import ConfigContext from '@src/config/configContext.js';
import { mergeGlobalAndServerConfig } from '@src/config/mcpConfigMerge.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import {
  type ConfigChangeResult,
  createConfigChangeService,
  fingerprintConfiguredServerConfigDocument,
  fingerprintConfiguredServerDefaults,
  fingerprintConfiguredServerTarget,
} from '@src/domains/config-change/configChange.js';
import { HandlebarsTemplateRenderer } from '@src/template/handlebarsTemplateRenderer.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { knownServerExamples } from './knownServerCatalog.js';
import {
  type KnownServerConfiguration,
  type KnownServerSetupPorts,
  resolveKnownServerExecutable,
} from './knownServerSetup.js';
import type { KnownInstallationSource } from './serverInstallationTypes.js';
import { createServerInstallationWorkflow } from './serverInstallationWorkflow.js';

describe('known server setup', () => {
  let directory: string;
  let configuration: KnownServerConfiguration;
  let ports: Required<KnownServerSetupPorts>;
  const changed: ConfigChangeResult = {
    status: 'changed',
    operation: 'create_template',
    configPath: '/config/mcp.json',
    target: { name: 'codegraph', source: 'mcpTemplates' },
    changed: true,
    backup: { created: false },
    reload: { status: 'observed' },
    retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
    warnings: [],
  };

  beforeEach(async () => {
    directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'known-setup-')));
    configuration = { mcpServers: {}, mcpTemplates: {} };
    ports = {
      readConfiguration: vi.fn(() => configuration),
      resolveExecutable: vi.fn(async () => '/trusted/bin/codegraph'),
      createStatic: vi.fn(async () => changed),
      createTemplate: vi.fn(async () => changed),
      editTarget: vi.fn(async (): Promise<ConfigChangeResult> => ({ ...changed, operation: 'edit' })),
    };
  });

  afterEach(async () => {
    ConfigContext.getInstance().reset();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  function run(source: Partial<KnownInstallationSource> = {}, mode: 'apply' | 'preview' = 'apply', force = false) {
    return createServerInstallationWorkflow({ knownSetup: ports }).run({
      mode,
      source: { type: 'known', exampleId: 'codegraph', ...source },
      force,
    });
  }

  function existing(overrides: Partial<MCPServerParams> = {}): MCPServerParams {
    return {
      type: 'stdio',
      command: '/trusted/bin/codegraph',
      args: ['serve', '--mcp', '--path', '{{{project.path}}}', '--no-watch'],
      cwd: '{{{project.path}}}',
      ...overrides,
      env: { CODEGRAPH_NO_DOWNLOAD: '1', CODEGRAPH_NO_DAEMON: '1', ...overrides.env },
      template: { shareable: true, perClient: false, ...overrides.template },
    };
  }

  it('exports exactly three declarative examples with public native guidance', () => {
    expect(knownServerExamples.map((example) => example.id)).toEqual(['codegraph', 'code-review-graph', 'serena']);
    for (const example of knownServerExamples) {
      expect(example).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        description: expect.any(String),
        executable: expect.any(String),
      });
      expect(example.args).toContain('{{{project.path}}}');
      expect(example.prerequisites.length).toBeGreaterThan(0);
      expect(example.nativeNextSteps.length).toBeGreaterThan(0);
    }
  });

  it.each(knownServerExamples)('previews $id using its public argv and a checkout template', async (example) => {
    const result = await run({ exampleId: example.id }, 'preview');
    expect(result).toMatchObject({
      status: 'preview',
      sourceType: 'known',
      exampleId: example.id,
      targetName: example.id,
      targetSource: 'mcpTemplates',
      config: { type: 'stdio', command: '/trusted/bin/codegraph', args: example.args, cwd: '{{{project.path}}}' },
    });
    expect(result.config?.preparation).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('Automatic preparation is unsupported');
    expect(ports.resolveExecutable).toHaveBeenCalledWith(example.executable);
    expect(ports.createTemplate).not.toHaveBeenCalled();
    expect(ports.createStatic).not.toHaveBeenCalled();
  });

  it('creates templates through Config Change with the full snapshot fingerprint', async () => {
    const result = await run({ localName: 'my-graph' });
    expect(result.status).toBe('applied');
    expect(ports.createTemplate).toHaveBeenCalledWith({
      targetName: 'my-graph',
      serverConfig: result.config,
      backup: 'skip',
      expectedConfigFingerprint: fingerprintConfiguredServerConfigDocument(configuration),
    });
    expect(result.configChange?.reload.status).toBe('observed');
  });

  it('binds explicit checkout as static literal argv, preserving spaces and shell punctuation', async () => {
    const checkout = path.join(directory, "repo with 'quotes'; punctuation");
    await mkdir(checkout);
    const result = await run({ checkout });
    expect(result).toMatchObject({
      status: 'applied',
      targetSource: 'mcpServers',
      config: {
        cwd: checkout,
        args: ['serve', '--mcp', '--path', checkout, '--no-watch'],
      },
    });
    expect(ports.createStatic).toHaveBeenCalledOnce();
    expect(ports.createTemplate).not.toHaveBeenCalled();
  });

  it.each(['executable', 'checkout'] as const)(
    'rejects unsafe %s values before resolution or mutation',
    async (field) => {
      for (const value of [
        'relative/path',
        '/tmp/{{project.path}}',
        '/tmp/$SECRET',
        '/tmp/${SECRET}',
        '/tmp/line\nbreak',
        '/tmp/null\0',
      ]) {
        expect((await run({ [field]: value })).status).toBe('invalid_input');
      }
      expect(ports.resolveExecutable).not.toHaveBeenCalled();
      expect(ports.readConfiguration).not.toHaveBeenCalled();
      expect(ports.createTemplate).not.toHaveBeenCalled();
    },
  );

  it('validates unknown IDs, malformed names, and unexpected fields', async () => {
    expect((await run({ exampleId: 'unknown' })).status).toBe('not_found');
    expect((await run({ localName: '../bad' })).status).toBe('invalid_input');
    const source = { type: 'known' as const, exampleId: 'codegraph', args: ['injected'] };
    expect((await createServerInstallationWorkflow({ knownSetup: ports }).run({ mode: 'apply', source })).status).toBe(
      'invalid_input',
    );
    expect(ports.resolveExecutable).not.toHaveBeenCalled();
  });

  it('fails missing executables with actionable guidance before mutation', async () => {
    ports.resolveExecutable = vi.fn(async () => undefined);
    const result = await run();
    expect(result.status).toBe('invalid_input');
    expect(result.error).toContain('--executable');
    expect(result.fieldErrors?.executable).toEqual([result.error]);
    expect(result.error).toContain('Install CodeGraph');
    expect(ports.createTemplate).not.toHaveBeenCalled();
  });

  it('rejects unsafe resolved paths and symlinked checkout marker injection', async () => {
    ports.resolveExecutable = vi.fn(async () => '/tmp/$INJECTED');
    expect((await run()).status).toBe('invalid_input');
    ports.resolveExecutable = vi.fn(async () => '/trusted/bin/codegraph');
    const unsafe = path.join(directory, '{{project.path}}');
    const alias = path.join(directory, 'safe');
    await mkdir(unsafe);
    await symlink(unsafe, alias);
    expect((await run({ checkout: alias })).status).toBe('invalid_input');
    expect(ports.createStatic).not.toHaveBeenCalled();
  });

  it('rejects missing directories and files without mutation', async () => {
    expect((await run({ checkout: path.join(directory, 'missing') })).status).toBe('failed');
    const file = path.join(directory, 'file');
    await writeFile(file, 'not a directory');
    expect((await run({ checkout: file })).status).toBe('invalid_input');
    expect(ports.createStatic).not.toHaveBeenCalled();
  });

  it.each([false, true])('fails closed for template/static collisions with force=%s', async (force) => {
    configuration.mcpServers = { codegraph: existing() };
    expect((await run({}, 'apply', force)).status).toBe('template_conflict');
    configuration = { mcpTemplates: { codegraph: existing() } };
    expect((await run({ checkout: directory }, 'apply', force)).status).toBe('template_conflict');
    expect(ports.createTemplate).not.toHaveBeenCalled();
    expect(ports.createStatic).not.toHaveBeenCalled();
    expect(ports.editTarget).not.toHaveBeenCalled();
  });

  it('preserves secrets, native preparation disables, readiness gates, and operator overrides on repeats', async () => {
    const target = existing({
      env: { SECRET: '${TOKEN}' },
      disabled: true,
      args: ['serve', '--mcp', '--path', '{{{project.path}}}', '--no-watch'],
      template: { maxInstances: 1 },
      preparation: {
        adapter: 'configured-command',
        enabled: false,
        allowedActions: [],
        affectedTools: ['restricted'],
        integration: {
          inspectionTimeoutMs: 1000,
          outputLimitBytes: 4096,
          terminationGraceMs: 100,
          containment: 'posix-process-group',
          probe: { executable: '/trusted/probe', args: [] },
          readinessExitCodes: { '0': { state: 'ready' } },
          actions: {},
        },
      },
    });
    configuration.mcpTemplates = { codegraph: target };
    for (const force of [false, true]) {
      const result = await run({}, 'apply', force);
      expect(result.status).toBe('unchanged');
      expect(result.config).toEqual(target);
    }
    expect(ports.editTarget).not.toHaveBeenCalled();
    expect(ports.createTemplate).not.toHaveBeenCalled();
  });

  it('requires force for executable changes and preserves custom args and restrictions when forced', async () => {
    const target = existing({
      args: ['serve', '--mcp', '--path', '{{{project.path}}}', '--no-watch'],
      disabled: true,
      env: { SECRET: '$TOKEN' },
    });
    configuration.mcpTemplates = { codegraph: target };
    ports.resolveExecutable = vi.fn(async () => '/other/bin/codegraph');
    expect((await run({ executable: '/other/bin/codegraph' })).status).toBe('exists');
    const result = await run({ executable: '/other/bin/codegraph' }, 'apply', true);
    expect(result.config).toEqual({ ...target, command: '/other/bin/codegraph' });
    expect(ports.editTarget).toHaveBeenCalledWith({
      sourceName: 'codegraph',
      targetName: 'codegraph',
      targetSource: 'mcpTemplates',
      serverConfig: result.config,
      expectedSourceFingerprint: fingerprintConfiguredServerTarget(target),
      expectedGlobalConfigFingerprint: fingerprintConfiguredServerDefaults(configuration.serverDefaults),
    });
  });

  it('preserves an explicit existing launcher override when defaults are accepted again', async () => {
    const target = existing({ command: '/operator/bin/custom-codegraph' });
    configuration.mcpTemplates = { codegraph: target };
    ports.resolveExecutable = vi.fn(async (executable) => executable);
    const result = await run({}, 'apply', true);
    expect(result.status).toBe('unchanged');
    expect(result.config).toEqual(target);
    expect(ports.resolveExecutable).toHaveBeenCalledWith('/operator/bin/custom-codegraph');
    expect(ports.editTarget).not.toHaveBeenCalled();
  });

  it('supplies safe CodeGraph defaults while preserving explicit environment overrides', async () => {
    const preview = await run({}, 'preview');
    expect(preview.config?.args).toContain('--no-watch');
    expect(preview.config?.env).toEqual({ CODEGRAPH_NO_DOWNLOAD: '1', CODEGRAPH_NO_DAEMON: '1' });
    const target = existing({ env: { CODEGRAPH_NO_DOWNLOAD: '0', SECRET: '${TOKEN}' } });
    configuration.mcpTemplates = { codegraph: target };
    const repeated = await run();
    expect(repeated.status).toBe('unchanged');
    expect(repeated.config?.env).toEqual(target.env);
    expect(repeated.warnings.join(' ')).toContain('version compatibility');
  });

  it('preserves explicit array environment assignments and inheritance on repeat and forced reconfiguration', async () => {
    const env = ['API_KEY=${TOKEN}', 'CODEGRAPH_NO_DOWNLOAD=0', 'INHERITED', 'EQUALS=a=b'];
    const target = { ...existing(), env };
    configuration.mcpTemplates = { codegraph: target };
    for (const force of [false, true]) {
      const result = await run({}, 'apply', force);
      expect(result.status).toBe('unchanged');
      expect(result.config?.env).toEqual(env);
      expect(Array.isArray(result.config?.env)).toBe(true);
    }
    expect(ports.editTarget).not.toHaveBeenCalled();
    ports.resolveExecutable = vi.fn(async () => '/other/bin/codegraph');
    const changed = await run({ executable: '/other/bin/codegraph' }, 'apply', true);
    expect(changed.status).toBe('applied');
    expect(changed.config?.env).toEqual(env);
    configuration.mcpTemplates.codegraph = changed.config!;
    vi.mocked(ports.editTarget).mockClear();
    expect((await run({}, 'apply', true)).status).toBe('unchanged');
    expect(ports.editTarget).not.toHaveBeenCalled();
  });

  it.each(['new-template', 'new-static', 'existing-template', 'existing-static'] as const)(
    'preserves inherited global env arrays in effective config for %s setup',
    async (scenario) => {
      const defaults = { env: ['API_KEY=${TOKEN}', 'HTTPS_PROXY=${PROXY}', 'CODEGRAPH_NO_DOWNLOAD=0', 'INHERITED'] };
      configuration.serverDefaults = defaults;
      const isExisting = scenario.startsWith('existing');
      const isStatic = scenario.endsWith('static');
      const section = isStatic ? 'mcpServers' : 'mcpTemplates';
      const source: KnownInstallationSource = {
        type: 'known',
        exampleId: 'codegraph',
        ...(isStatic ? { checkout: directory } : {}),
      };
      if (isExisting) {
        const target = existing(
          isStatic ? { cwd: directory, args: ['serve', '--mcp', '--path', directory, '--no-watch'] } : {},
        );
        delete target.env;
        configuration[section] = { codegraph: target };
        source.executable = '/other/bin/codegraph';
        ports.resolveExecutable = vi.fn(async () => '/other/bin/codegraph');
      }
      const workflow = createServerInstallationWorkflow({ knownSetup: ports });
      const preview = await workflow.run({ mode: 'preview', source, force: true });
      expect(preview.status).toBe('preview');
      expect(preview.config?.env).toBeUndefined();
      expect(mergeGlobalAndServerConfig(defaults, preview.config!).env).toEqual(defaults.env);
      const applied = await workflow.run({
        mode: 'apply',
        source,
        force: true,
        expectedSetupFingerprint: preview.setupFingerprint,
      });
      expect(applied.status).toBe('applied');
      expect(applied.config?.env).toBeUndefined();
      expect(mergeGlobalAndServerConfig(defaults, applied.config!).env).toEqual(defaults.env);
      configuration[section] = { codegraph: applied.config! };
      vi.mocked(ports.editTarget).mockClear();
      expect((await workflow.run({ mode: 'apply', source, force: true })).status).toBe('unchanged');
      expect(ports.editTarget).not.toHaveBeenCalled();
    },
  );

  it.each([{ API_KEY: '${OVERRIDE}' }, ['API_KEY=${OVERRIDE}', 'CUSTOM_INHERITED']])(
    'preserves explicit server env precedence over inherited arrays: %j',
    async (env) => {
      const defaults = { env: ['API_KEY=${TOKEN}', 'HTTPS_PROXY=${PROXY}'] };
      configuration.serverDefaults = defaults;
      const target = { ...existing(), env };
      configuration.mcpTemplates = { codegraph: target };
      const result = await run({}, 'apply', true);
      expect(result.status).toBe('unchanged');
      expect(result.config?.env).toEqual(env);
      expect(mergeGlobalAndServerConfig(defaults, result.config!).env).toEqual(env);
      expect(ports.editTarget).not.toHaveBeenCalled();
    },
  );

  it('defaults Serena 2.0.0 to individual tools and preserves an explicitly selected REPL interface', async () => {
    const preview = await run({ exampleId: 'serena' }, 'preview');
    expect(preview.config?.args?.slice(-2)).toEqual(['--agent-interface', 'tools']);
    expect(knownServerExamples.find((example) => example.id === 'serena')?.prerequisites.join(' ')).toContain(
      'Other versions are unverified',
    );
    const target = { ...preview.config!, args: [...preview.config!.args!.slice(0, -1), 'repl'] };
    configuration.mcpTemplates = { serena: target };
    const repeat = await run({ exampleId: 'serena' }, 'apply', true);
    expect(repeat.status).toBe('unchanged');
    expect(repeat.config?.args?.slice(-2)).toEqual(['--agent-interface', 'repl']);
    expect(ports.editTarget).not.toHaveBeenCalled();
  });

  it('returns a stable setup fingerprint for preview and unchanged results and accepts the reviewed apply token', async () => {
    const workflow = createServerInstallationWorkflow({ knownSetup: ports });
    const source: KnownInstallationSource = { type: 'known', exampleId: 'codegraph' };
    const preview = await workflow.run({ mode: 'preview', source });
    expect(preview.setupFingerprint).toEqual(expect.any(String));
    expect((await workflow.run({ mode: 'preview', source })).setupFingerprint).toBe(preview.setupFingerprint);
    const applied = await workflow.run({ mode: 'apply', source, expectedSetupFingerprint: preview.setupFingerprint });
    expect(applied.status).toBe('applied');
    expect(applied.setupFingerprint).toBe(preview.setupFingerprint);
    configuration.mcpTemplates = { codegraph: applied.config! };
    const unchanged = await workflow.run({ mode: 'preview', source });
    expect(unchanged.status).toBe('unchanged');
    expect(unchanged.setupFingerprint).toEqual(expect.any(String));
    vi.mocked(ports.createTemplate).mockClear();
    expect(
      (await workflow.run({ mode: 'apply', source, expectedSetupFingerprint: unchanged.setupFingerprint })).status,
    ).toBe('unchanged');
    expect(ports.createTemplate).not.toHaveBeenCalled();
    expect(ports.editTarget).not.toHaveBeenCalled();
  });

  it.each(['target', 'command', 'deleted', 'collision', 'defaults', 'unrelated'] as const)(
    'rejects concurrent %s changes after preview without configuration side effects',
    async (change) => {
      configuration.mcpTemplates = { codegraph: existing() };
      const workflow = createServerInstallationWorkflow({ knownSetup: ports });
      const source: KnownInstallationSource = { type: 'known', exampleId: 'codegraph' };
      const preview = await workflow.run({ mode: 'preview', source, force: true });
      if (change === 'target') configuration.mcpTemplates.codegraph = existing({ disabled: true });
      if (change === 'command')
        configuration.mcpTemplates.codegraph = existing({ command: '/concurrent/bin/codegraph' });
      if (change === 'deleted') delete configuration.mcpTemplates.codegraph;
      if (change === 'collision') configuration.mcpServers = { codegraph: existing() };
      if (change === 'defaults') configuration.serverDefaults = { timeout: 4567 };
      if (change === 'unrelated') configuration.mcpServers = { other: { type: 'stdio', command: '/bin/echo' } };
      const applied = await workflow.run({
        mode: 'apply',
        source,
        force: true,
        expectedSetupFingerprint: preview.setupFingerprint,
      });
      expect(applied.status).toBe('setup_conflict');
      expect(applied.error).toContain('changed after preview');
      expect(ports.editTarget).not.toHaveBeenCalled();
      expect(ports.createStatic).not.toHaveBeenCalled();
      expect(ports.createTemplate).not.toHaveBeenCalled();
    },
  );

  it('rejects a checkout symlink retarget between preview and apply', async () => {
    const first = path.join(directory, 'first');
    const second = path.join(directory, 'second');
    const checkout = path.join(directory, 'selected');
    await Promise.all([mkdir(first), mkdir(second)]);
    await symlink(first, checkout);
    const workflow = createServerInstallationWorkflow({ knownSetup: ports });
    const source: KnownInstallationSource = { type: 'known', exampleId: 'codegraph', checkout };
    const preview = await workflow.run({ mode: 'preview', source });
    expect(preview.config?.cwd).toBe(first);
    await rm(checkout);
    await symlink(second, checkout);
    const result = await workflow.run({
      mode: 'apply',
      source,
      force: true,
      expectedSetupFingerprint: preview.setupFingerprint,
    });
    expect(result.status).toBe('setup_conflict');
    expect(ports.createStatic).not.toHaveBeenCalled();
  });

  it('rejects an executable change after preview and validates supplied fingerprint values', async () => {
    ports.resolveExecutable = vi.fn(async (executable) =>
      executable.startsWith('/') ? executable : '/trusted/bin/codegraph',
    );
    const workflow = createServerInstallationWorkflow({ knownSetup: ports });
    const source: KnownInstallationSource = { type: 'known', exampleId: 'codegraph' };
    const preview = await workflow.run({ mode: 'preview', source });
    const changed = await workflow.run({
      mode: 'apply',
      source: { ...source, executable: '/other/bin/codegraph' },
      expectedSetupFingerprint: preview.setupFingerprint,
    });
    expect(changed.status).toBe('setup_conflict');
    expect((await workflow.run({ mode: 'apply', source, expectedSetupFingerprint: '' })).status).toBe('invalid_input');
    expect((await workflow.run({ mode: 'apply', source, expectedSetupFingerprint: 'different-token' })).status).toBe(
      'setup_conflict',
    );
    expect(ports.createTemplate).not.toHaveBeenCalled();
  });

  it('retains Config Change fencing for a race after setup fingerprint comparison', async () => {
    const configPath = path.join(directory, 'mcp.json');
    ConfigContext.getInstance().setConfigPath(configPath);
    await writeFile(configPath, JSON.stringify({ mcpServers: {} }));
    const reload = vi.fn();
    const service = createConfigChangeService({ getConfigPath: () => configPath, reloadConfig: reload });
    const concurrent = { mcpServers: {}, serverDefaults: { timeout: 4567 } };
    const workflow = createServerInstallationWorkflow({
      knownSetup: {
        resolveExecutable: ports.resolveExecutable,
        createTemplate: async (input) => {
          await writeFile(configPath, JSON.stringify(concurrent));
          return service.createTemplateConfiguredServerTarget(input);
        },
      },
    });
    const source: KnownInstallationSource = { type: 'known', exampleId: 'codegraph' };
    const preview = await workflow.run({ mode: 'preview', source });
    const result = await workflow.run({ mode: 'apply', source, expectedSetupFingerprint: preview.setupFingerprint });
    expect(result.status).toBe('failed');
    expect(result.configChange?.status).toBe('source_conflict');
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(concurrent);
    expect(await readdir(directory)).toEqual(['mcp.json']);
    expect(reload).not.toHaveBeenCalled();
  });

  it('declares shared instances only for CodeGraph without adding backend branches to setup', async () => {
    expect((await run({}, 'preview')).config?.template).toEqual({ shareable: true, perClient: false });
    for (const exampleId of ['code-review-graph', 'serena']) {
      expect((await run({ exampleId }, 'preview')).config?.template).toBeUndefined();
    }
  });

  it.each(knownServerExamples)(
    'renders $id checkout paths literally and identically to static setup',
    async (example) => {
      const checkout = path.join(directory, `repo & tools 'quoted' <source>`);
      await mkdir(checkout);
      const preview = await run({ exampleId: example.id }, 'preview');
      const rendered = new HandlebarsTemplateRenderer().renderTemplate(preview.config!, {
        project: { path: checkout },
        user: {},
        environment: {},
      });
      const fixed = await run({ exampleId: example.id, checkout }, 'preview');
      expect(rendered.cwd).toBe(checkout);
      expect(rendered.args).toContain(checkout);
      expect(rendered.args).toEqual(fixed.config?.args);
      expect(rendered.cwd).toEqual(fixed.config?.cwd);
    },
  );

  it.each(['argument', 'cwd', 'both'])(
    'rejects a falsely reusable template with a fixed %s binding even with force',
    async (binding) => {
      const target = existing();
      if (binding !== 'cwd') target.args = ['serve', '--mcp', '--path', '/old/repo', '--no-watch'];
      if (binding !== 'argument') target.cwd = '/old/repo';
      configuration.mcpTemplates = { codegraph: target };
      for (const mode of ['preview', 'apply'] as const) {
        for (const force of [false, true]) {
          const result = await run({}, mode, force);
          expect(result.status).toBe('invalid_input');
          expect(result.error).toContain('not reusable');
        }
      }
      expect(configuration.mcpTemplates.codegraph).toEqual(target);
      expect(ports.editTarget).not.toHaveBeenCalled();
    },
  );

  it('preserves explicit template isolation and pool restrictions on equivalent repeats', async () => {
    const target = existing({ template: { shareable: false, perClient: true, maxInstances: 1, idleTimeout: 1234 } });
    configuration.mcpTemplates = { codegraph: target };
    expect((await run()).config).toEqual(target);
    expect((await run()).status).toBe('unchanged');
    expect(ports.editTarget).not.toHaveBeenCalled();
  });

  it('requires force to add sharing defaults to a legacy target without explicit instance settings', async () => {
    const target = existing();
    delete target.template;
    configuration.mcpTemplates = { codegraph: target };
    expect((await run()).status).toBe('exists');
    const result = await run({}, 'apply', true);
    expect(result.status).toBe('applied');
    expect(result.config?.template).toEqual({ shareable: true, perClient: false });
    expect(ports.editTarget).toHaveBeenCalledOnce();
  });

  it.each(['preview', 'apply'] as const)(
    'validates preserved candidates before %s can report unchanged',
    async (mode) => {
      configuration.mcpTemplates = { codegraph: existing({ disabledTools: [''] }) };
      const result = await run({}, mode);
      expect(result.status).toBe('invalid_input');
      expect(result.fieldErrors?.disabledTools).toBeDefined();
      expect(ports.editTarget).not.toHaveBeenCalled();
    },
  );

  it('requires explicit force before adopting an unverified custom launch configuration', async () => {
    const target = existing({
      command: '/trusted/bin/unrelated',
      args: ['unrelated-operation', '--mcp', '--path', '{{{project.path}}}'],
    });
    configuration.mcpTemplates = { codegraph: target };
    ports.resolveExecutable = vi.fn(async (executable) => executable);
    expect((await run()).status).toBe('exists');
    const accepted = await run({}, 'apply', true);
    expect(accepted.status).toBe('unchanged');
    expect(accepted.config).toEqual(target);
    expect(accepted.warnings).toContain('Preserved custom launch configuration is not a verified example recipe.');
    expect(ports.editTarget).not.toHaveBeenCalled();
  });

  it('requires force for checkout changes and preserves additional argv overrides', async () => {
    const target = existing({ cwd: '/old/repo', args: ['serve', '--mcp', '--path', '/old/repo', '--no-watch'] });
    configuration.mcpServers = { codegraph: target };
    expect((await run({ checkout: directory })).status).toBe('exists');
    const result = await run({ checkout: directory }, 'apply', true);
    expect(result.config?.args).toEqual(['serve', '--mcp', '--path', directory, '--no-watch']);
    expect(result.config?.cwd).toBe(directory);
    configuration.mcpServers.codegraph = result.config!;
    vi.mocked(ports.editTarget).mockClear();
    expect((await run({ checkout: directory }, 'apply', true)).status).toBe('unchanged');
    expect(ports.editTarget).not.toHaveBeenCalled();
  });

  it('fails closed rather than discarding custom launch arguments during checkout rebinding', async () => {
    configuration.mcpServers = { codegraph: existing({ args: ['custom-launch'] }) };
    const result = await run({ checkout: directory }, 'apply', true);
    expect(result.status).toBe('invalid_input');
    expect(result.error).toContain('cannot be rebound safely');
    expect(ports.editTarget).not.toHaveBeenCalled();
  });

  it('does not silently change transport even when forced', async () => {
    configuration.mcpTemplates = { codegraph: { type: 'http', url: 'https://example.test' } };
    expect((await run({}, 'apply', true)).status).toBe('exists');
    expect(ports.editTarget).not.toHaveBeenCalled();
  });

  it('previews forced edits without mutation', async () => {
    configuration.mcpTemplates = { codegraph: existing() };
    ports.resolveExecutable = vi.fn(async () => '/other/bin/codegraph');
    expect((await run({ executable: '/other/bin/codegraph' }, 'preview', true)).status).toBe('preview');
    expect(ports.editTarget).not.toHaveBeenCalled();
  });

  it.each(['source_conflict', 'destination_conflict', 'failed'] as const)(
    'reports Config Change %s without retry',
    async (status) => {
      ports.createTemplate = vi.fn(async () => ({ ...changed, status, changed: false, error: 'observed failure' }));
      const result = await run();
      expect(result.status).toBe(status === 'destination_conflict' ? 'exists' : 'failed');
      expect(result.error).toBe('observed failure');
      expect(ports.createTemplate).toHaveBeenCalledOnce();
    },
  );

  it('carries backup and reload outcomes separately from a successful config write', async () => {
    ports.createTemplate = vi.fn(async (): Promise<ConfigChangeResult> => ({
      ...changed,
      backup: { created: true, path: '/backup' },
      reload: { status: 'failed', error: 'runtime unavailable' },
      warnings: ['reload warning'],
    }));
    const result = await run();
    expect(result.status).toBe('applied');
    expect(result.configChange?.backup.created).toBe(true);
    expect(result.configChange?.reload.status).toBe('failed');
    expect(result.warnings).toContain('reload warning');
  });

  it('resolves only absolute trusted PATH entries without running scripts or probes', async () => {
    const launcher = path.join(directory, 'codegraph');
    const marker = path.join(directory, 'executed');
    await writeFile(launcher, `#!/bin/sh\ntouch '${marker}'\n`);
    await chmod(launcher, 0o755);
    vi.spyOn(runtimeBootstrap, 'getRuntimeParentEnvironment').mockReturnValue({ PATH: `.:relative:${directory}` });
    expect(await resolveKnownServerExecutable('codegraph')).toBe(launcher);
    await expect(readFile(marker)).rejects.toThrow();
    vi.mocked(runtimeBootstrap.getRuntimeParentEnvironment).mockReturnValue({ PATH: '.:relative' });
    expect(await resolveKnownServerExecutable('codegraph')).toBeUndefined();
  });

  it('keeps the original Python console launcher and rejects nonexecutables and unsafe canonical paths', async () => {
    const script = path.join(directory, 'console-script');
    const launcher = path.join(directory, 'serena');
    await writeFile(script, '#!/virtualenv/bin/python\n');
    await chmod(script, 0o755);
    await symlink(script, launcher);
    expect(await resolveKnownServerExecutable(launcher)).toBe(launcher);
    await chmod(script, 0o644);
    expect(await resolveKnownServerExecutable(launcher)).toBeUndefined();
    expect(await resolveKnownServerExecutable(directory)).toBeUndefined();
    const unsafe = path.join(directory, '$INJECTED');
    await writeFile(unsafe, '#!/bin/sh\n');
    await chmod(unsafe, 0o755);
    const alias = path.join(directory, 'alias');
    await symlink(unsafe, alias);
    expect(await resolveKnownServerExecutable(alias)).toBeUndefined();
  });

  it.each(['template', 'static'])(
    'uses real Config Change validation, backups and reload for %s targets',
    async (kind) => {
      const configPath = path.join(directory, 'mcp.json');
      ConfigContext.getInstance().setConfigPath(configPath);
      const original = {
        mcpServers: { untouched: { type: 'stdio', command: '/bin/echo', env: { SECRET: '${TOKEN}' } } },
        serverDefaults: { timeout: 1234 },
        unrelated: { preserved: true },
      };
      await writeFile(configPath, JSON.stringify(original));
      const reload = vi.fn();
      const service = createConfigChangeService({ getConfigPath: () => configPath, reloadConfig: reload });
      const resolveExecutable = vi.fn(async () => '/trusted/bin/codegraph');
      const workflow = createServerInstallationWorkflow({
        knownSetup: {
          resolveExecutable,
          createTemplate: service.createTemplateConfiguredServerTarget.bind(service),
          createStatic: service.createStaticConfiguredServerTarget.bind(service),
          editTarget: service.editConfiguredServerTarget.bind(service),
        },
      });
      const source: KnownInstallationSource = {
        type: 'known',
        exampleId: 'codegraph',
        ...(kind === 'static' ? { checkout: directory } : {}),
      };
      const created = await workflow.run({ mode: 'apply', source, backup: 'required' });
      expect(created.status).toBe('applied');
      expect(created.configChange?.backup.created).toBe(true);
      expect(created.configChange?.reload.status).toBe('observed');
      expect(JSON.parse(await readFile(created.configChange!.backup.path!, 'utf8'))).toEqual(original);
      const document = JSON.parse(await readFile(configPath, 'utf8'));
      expect(document.mcpServers.untouched).toEqual(original.mcpServers.untouched);
      expect(document.unrelated).toEqual(original.unrelated);
      const filesBefore = await readdir(directory);
      const repeat = await workflow.run({ mode: 'apply', source, force: true });
      expect(repeat.status).toBe('unchanged');
      expect(reload).toHaveBeenCalledTimes(1);
      expect(await readdir(directory)).toEqual(filesBefore);
      expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(document);
      resolveExecutable.mockResolvedValue('/another/bin/codegraph');
      const edited = await workflow.run({
        mode: 'apply',
        source: { ...source, executable: '/another/bin/codegraph' },
        force: true,
      });
      expect(edited.status).toBe('applied');
      expect(edited.configChange?.backup.created).toBe(true);
      expect(edited.configChange?.operation).toBe('edit');
      expect(reload).toHaveBeenCalledTimes(2);
    },
  );

  it('rejects invalid existing configuration through Config Change before backup or reload', async () => {
    const configPath = path.join(directory, 'mcp.json');
    ConfigContext.getInstance().setConfigPath(configPath);
    const original = { mcpServers: { invalid: { type: 'unsupported' } } };
    await writeFile(configPath, JSON.stringify(original));
    const reload = vi.fn();
    const service = createConfigChangeService({ getConfigPath: () => configPath, reloadConfig: reload });
    const workflow = createServerInstallationWorkflow({
      knownSetup: {
        resolveExecutable: ports.resolveExecutable,
        createTemplate: service.createTemplateConfiguredServerTarget.bind(service),
      },
    });
    expect(
      (await workflow.run({ mode: 'apply', source: { type: 'known', exampleId: 'codegraph' }, backup: 'required' }))
        .status,
    ).toBe('failed');
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(original);
    expect(await readdir(directory)).toEqual(['mcp.json']);
    expect(reload).not.toHaveBeenCalled();
  });
});
