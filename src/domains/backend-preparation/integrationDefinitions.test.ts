import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConfiguredCommandPreparationAdapter } from './configuredCommandAdapter.js';
import {
  IntegrationDefinitionSchema,
  resolveIntegrationDefinition,
  validatePreparationConfig,
} from './integrationDefinitions.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function definitionFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-definition-'));
  directories.push(directory);
  const file = path.join(directory, 'definition.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 1,
      id: 'local-test',
      revision: '1',
      helperRevision: 'helper-1',
      compatibility: {
        backend: 'native-test',
        versions: ['1'],
        platforms: ['linux', 'darwin', 'win32'],
        readinessScope: 'selected checkout',
      },
      inputs: { backend: { required: true } },
      affectedTools: ['search'],
      integration: {
        containment: 'posix-process-group',
        probe: { executable: './probe', args: ['{input:backend}', '{checkout}'] },
        readinessExitCodes: { '0': { state: 'ready' } },
        actions: {},
      },
    }),
  );
  return { file, directory };
}

describe('runtime-owned integration definitions', () => {
  it('resolves an explicitly selected local JSON recipe with literal operator inputs independent of cwd', () => {
    const { file, directory } = definitionFile();
    expect(
      resolveIntegrationDefinition(
        { id: 'local-test', file, inputs: { backend: '/installed/backend with spaces' } },
        [],
      ),
    ).toMatchObject({
      integration: {
        probe: {
          executable: path.join(fs.realpathSync(directory), 'probe'),
          args: ['/installed/backend with spaces', '{checkout}'],
        },
      },
      affectedTools: ['search'],
    });
  });
  it.skipIf(process.platform === 'win32')(
    'executes declared helpers beside the definition for probes and actions, never checkout lookalikes',
    async () => {
      const { file, directory } = definitionFile();
      const checkout = path.join(directory, 'checkout');
      fs.mkdirSync(checkout);
      fs.writeFileSync(
        path.join(directory, 'helper.cjs'),
        'if(process.argv[2]==="prepare") process.stdout.write("declared"); else process.exit(10);',
      );
      fs.writeFileSync(path.join(checkout, 'helper.cjs'), 'process.exit(0);');
      const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
      definition.helperFiles = ['./helper.cjs'];
      definition.integration = {
        containment: 'posix-process-group',
        probe: { executable: process.execPath, args: ['./helper.cjs'] },
        readinessExitCodes: {
          '0': { state: 'ready' },
          '10': { state: 'required', action: 'initialize', instructions: 'Declared helper is cold' },
        },
        actions: {
          initialize: { executable: process.execPath, args: ['helper.cjs', 'prepare'], successExitCodes: [10] },
        },
      };
      fs.writeFileSync(file, JSON.stringify(definition));
      const resolved = resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend' } });
      const adapter = new ConfiguredCommandPreparationAdapter(resolved.integration);
      const target = {
        checkoutRoot: checkout,
        backendName: 'test',
        backendIdentity: 'test',
        configurationKey: resolved.revision,
      };
      expect(await adapter.inspect(target, 'search')).toMatchObject({ state: 'required' });
      await expect(
        adapter.prepare(target, 'initialize', { signal: new AbortController().signal, executionDeadlineMs: 5000 }),
      ).rejects.toMatchObject({ code: 'command_exit', message: expect.stringContaining('declared') });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'pins a declared executable to its canonical helper even if its symlink is retargeted',
    async () => {
      const { file, directory } = definitionFile();
      fs.writeFileSync(path.join(directory, 'old-helper'), '#!/bin/sh\nexit 10\n', { mode: 0o755 });
      fs.writeFileSync(path.join(directory, 'new-helper'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      fs.symlinkSync('./old-helper', path.join(directory, 'helper'));
      const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
      definition.helperFiles = ['./helper'];
      definition.integration.probe = { executable: 'helper', args: [] };
      definition.integration.readinessExitCodes['10'] = {
        state: 'required',
        action: 'initialize',
        instructions: 'Old helper',
      };
      fs.writeFileSync(file, JSON.stringify(definition));
      const resolved = resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend' } });
      fs.unlinkSync(path.join(directory, 'helper'));
      fs.symlinkSync('./new-helper', path.join(directory, 'helper'));
      const adapter = new ConfiguredCommandPreparationAdapter(resolved.integration);
      expect(
        await adapter.inspect(
          {
            checkoutRoot: directory,
            backendName: 'test',
            backendIdentity: 'test',
            configurationKey: resolved.revision,
          },
          'search',
        ),
      ).toMatchObject({ state: 'required' });
    },
  );

  it('rejects embedded declared-helper references instead of parsing interpreter strings or compound flags', () => {
    const { file, directory } = definitionFile();
    fs.writeFileSync(path.join(directory, 'helper.cjs'), 'process.exit(0)');
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    definition.helperFiles = ['./helper.cjs'];
    definition.integration.probe = { executable: process.execPath, args: ['-e', 'require("./helper.cjs")'] };
    fs.writeFileSync(file, JSON.stringify(definition));
    expect(() => resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend' } })).toThrow(
      /whole executable or argv argument/,
    );
  });

  it.skipIf(process.platform === 'win32')(
    'rejects changed helper bytes in a retained adapter even after a new definition resolution',
    async () => {
      const { file, directory } = definitionFile();
      const helper = path.join(directory, 'helper.cjs');
      fs.writeFileSync(helper, 'process.exit(10);');
      const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
      definition.helperFiles = ['./helper.cjs'];
      definition.integration.probe = { executable: process.execPath, args: ['./helper.cjs'] };
      definition.integration.readinessExitCodes['10'] = {
        state: 'required',
        action: 'initialize',
        instructions: 'Initialize',
      };
      definition.integration.actions.initialize = { executable: process.execPath, args: ['./helper.cjs'] };
      fs.writeFileSync(file, JSON.stringify(definition));
      const selection = { id: 'local-test', file, inputs: { backend: 'backend' } };
      const original = resolveIntegrationDefinition(selection);
      const retained = new ConfiguredCommandPreparationAdapter(original.integration, original.helperSnapshots);
      const target = {
        checkoutRoot: directory,
        backendName: 'test',
        backendIdentity: 'test',
        configurationKey: original.revision,
      };
      expect(await retained.inspect(target, 'search')).toMatchObject({ state: 'required' });
      fs.writeFileSync(helper, 'process.exit(0);');
      const updated = resolveIntegrationDefinition(selection);
      expect(updated.revision).not.toBe(original.revision);
      expect(await retained.inspect(target, 'search')).toMatchObject({
        state: 'unknown',
        reason: 'probe_failed',
        instructions: expect.stringContaining('helper'),
      });
      await expect(
        retained.prepare(target, 'initialize', { signal: new AbortController().signal, executionDeadlineMs: 5000 }),
      ).rejects.toMatchObject({ code: 'helper_revision_changed', retryable: false });
      expect(
        await new ConfiguredCommandPreparationAdapter(updated.integration, updated.helperSnapshots).inspect(
          target,
          'search',
        ),
      ).toMatchObject({ state: 'ready' });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a ready probe whose declared helper changes while the command runs',
    async () => {
      const { file, directory } = definitionFile();
      fs.writeFileSync(
        path.join(directory, 'helper.cjs'),
        'require("fs").writeFileSync(__filename, "process.exit(0);"); process.exit(0);',
      );
      const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
      definition.helperFiles = ['./helper.cjs'];
      definition.integration.probe = { executable: process.execPath, args: ['./helper.cjs'] };
      fs.writeFileSync(file, JSON.stringify(definition));
      const resolved = resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend' } });
      const adapter = new ConfiguredCommandPreparationAdapter(resolved.integration, resolved.helperSnapshots);
      expect(
        await adapter.inspect(
          {
            checkoutRoot: directory,
            backendName: 'test',
            backendIdentity: 'test',
            configurationKey: resolved.revision,
          },
          'search',
        ),
      ).toMatchObject({
        state: 'unknown',
        reason: 'probe_failed',
        instructions: expect.stringContaining('helper content changed'),
      });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a helper changed during containment checks before its action can launch',
    async () => {
      const { file, directory } = definitionFile();
      const helper = path.join(directory, 'helper.cjs');
      fs.writeFileSync(helper, 'process.exit(0);');
      const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
      definition.helperFiles = ['./helper.cjs'];
      definition.integration.probe = { executable: process.execPath, args: ['./helper.cjs'] };
      definition.integration.actions.initialize = { executable: process.execPath, args: ['./helper.cjs'] };
      fs.writeFileSync(file, JSON.stringify(definition));
      const resolved = resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend' } });
      const adapter = new ConfiguredCommandPreparationAdapter(resolved.integration, resolved.helperSnapshots);
      const preparing = adapter.prepare(
        { checkoutRoot: directory, backendName: 'test', backendIdentity: 'test', configurationKey: resolved.revision },
        'initialize',
        { signal: new AbortController().signal, executionDeadlineMs: 5000 },
      );
      const rejected = expect(preparing).rejects.toMatchObject({ code: 'helper_revision_changed', retryable: false });
      fs.writeFileSync(helper, 'require("fs").writeFileSync("unsafe-launch", "yes");');
      await rejected;
      expect(fs.existsSync(path.join(directory, 'unsafe-launch'))).toBe(false);
    },
  );

  it.each(['helper.cjs', 'search helper.cjs text'])(
    'preserves literal operator query %s beside a static helper reference',
    (query) => {
      const { file, directory } = definitionFile();
      const helper = path.join(directory, 'helper.cjs');
      fs.writeFileSync(helper, 'process.exit(0);');
      const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
      definition.inputs = { query: { required: true } };
      definition.helperFiles = ['./helper.cjs'];
      const command = { executable: process.execPath, args: ['./helper.cjs', '{input:query}'] };
      definition.integration.probe = command;
      definition.integration.actions.initialize = command;
      fs.writeFileSync(file, JSON.stringify(definition));
      const resolved = resolveIntegrationDefinition({ id: 'local-test', file, inputs: { query } });
      expect(resolved.integration.probe.args).toEqual([fs.realpathSync(helper), query]);
      expect(resolved.integration.actions.initialize?.args).toEqual([fs.realpathSync(helper), query]);
    },
  );

  it.each([
    ['interpreter source', ['-e', 'require("./helper.cjs")']],
    ['compound flag', ['--require=./helper.cjs']],
  ])('rejects relative static helper references in %s when the helper declaration is absolute', (_kind, args) => {
    const { file, directory } = definitionFile();
    const helper = path.join(directory, 'helper.cjs');
    fs.writeFileSync(helper, 'process.exit(10);');
    const checkout = path.join(directory, 'checkout');
    fs.mkdirSync(checkout);
    fs.writeFileSync(path.join(checkout, 'helper.cjs'), 'process.exit(0);');
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    definition.helperFiles = [helper];
    definition.integration.probe = { executable: process.execPath, args };
    fs.writeFileSync(file, JSON.stringify(definition));
    expect(() => resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend' } })).toThrow(
      /embedded references are unsupported/,
    );
  });

  it('rejects a canonical helper directory marker before it can redirect a probe to a ready sibling', () => {
    const { file, directory } = definitionFile();
    const declared = path.join(directory, 'runtime-{operation}');
    const alternate = path.join(directory, 'runtime-lookup');
    fs.mkdirSync(declared);
    fs.mkdirSync(alternate);
    fs.writeFileSync(path.join(declared, 'helper.cjs'), 'process.exit(10);');
    fs.writeFileSync(path.join(alternate, 'helper.cjs'), 'process.exit(0);');
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    definition.helperFiles = ['./helper.cjs'];
    definition.integration.probe = { executable: process.execPath, args: ['./helper.cjs'] };
    definition.integration.readinessExitCodes['10'] = {
      state: 'required',
      action: 'initialize',
      instructions: 'Genuine helper is cold',
    };
    const selected = path.join(declared, 'definition.json');
    fs.writeFileSync(selected, JSON.stringify(definition));
    expect(() =>
      resolveIntegrationDefinition({ id: 'local-test', file: selected, inputs: { backend: 'backend' } }),
    ).toThrow(/reserved command marker/);
  });

  it('rejects a declared input-marker helper alias even when its canonical symlink target is safe', () => {
    const { file, directory } = definitionFile();
    fs.writeFileSync(path.join(directory, 'safe-helper.cjs'), 'process.exit(0);');
    // Windows cannot create filenames containing a colon; rejection still precedes path lookup.
    if (process.platform !== 'win32') fs.symlinkSync('./safe-helper.cjs', path.join(directory, '{input:backend}'));
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    definition.helperFiles = ['{input:backend}'];
    definition.integration.probe = { executable: process.execPath, args: ['{input:backend}'] };
    fs.writeFileSync(file, JSON.stringify(definition));
    expect(() => resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'literal data' } })).toThrow(
      /reserved command marker/,
    );
  });

  it('preserves unrelated curly literals in declared helper argv paths', () => {
    const { file, directory } = definitionFile();
    const helper = path.join(directory, 'helper{literal}.cjs');
    fs.writeFileSync(helper, 'process.exit(0);');
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    definition.helperFiles = ['./helper{literal}.cjs'];
    definition.integration.probe = { executable: process.execPath, args: ['./helper{literal}.cjs'] };
    fs.writeFileSync(file, JSON.stringify(definition));
    expect(
      resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend' } }).integration.probe.args,
    ).toEqual([fs.realpathSync(helper)]);
  });

  it('rejects operator inputs that could be reinterpreted as runtime command markers', () => {
    const { file } = definitionFile();
    for (const backend of ['{checkout}', '{operation}', '{input:backend}']) {
      expect(() => resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend } }, [])).toThrow(
        /reserved/i,
      );
    }
  });

  it('rejects unsupported host platforms before returning executable commands', () => {
    const { file } = definitionFile();
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    definition.compatibility.platforms = process.platform === 'win32' ? ['linux'] : ['win32'];
    fs.writeFileSync(file, JSON.stringify(definition));
    expect(() => resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend' } }, [])).toThrow(
      /Unsupported.*platform/,
    );
  });

  it('includes declared local helper bytes in identity while retaining a coherent resolved snapshot', () => {
    const { file, directory } = definitionFile();
    const helper = path.join(directory, 'helper.py');
    fs.writeFileSync(helper, 'print("revision one")');
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    definition.helperFiles = ['./helper.py'];
    fs.writeFileSync(file, JSON.stringify(definition));
    const selection = { id: 'local-test', file, inputs: { backend: 'backend' } };
    const first = resolveIntegrationDefinition(selection, []);
    fs.writeFileSync(helper, 'print("revision two")');
    const second = resolveIntegrationDefinition(selection, []);
    expect(second.revision).not.toBe(first.revision);
    expect(first.integration.probe.args).toEqual(['backend', '{checkout}']);
  });

  it.each([
    ['schemaVersion', 2],
    ['id', 'Not a valid identity'],
    ['extra', true],
  ])('rejects malformed definition field %s', (field, value) => {
    const { file } = definitionFile();
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    definition[field] = value;
    fs.writeFileSync(file, JSON.stringify(definition));
    expect(() =>
      resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend' } }, []),
    ).toThrow();
  });

  it('rejects identity mismatches, missing inputs, unknown inputs, and unbound placeholders', () => {
    const { file } = definitionFile();
    expect(() => resolveIntegrationDefinition({ id: 'other-id', file, inputs: { backend: 'backend' } }, [])).toThrow(
      /identity/,
    );
    expect(() => resolveIntegrationDefinition({ id: 'local-test', file }, [])).toThrow(/Missing required.*backend/);
    expect(() =>
      resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend', unknown: 'value' } }, []),
    ).toThrow(/Unknown.*unknown/);
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    definition.integration.probe.args = ['{input:undeclared}'];
    fs.writeFileSync(file, JSON.stringify(definition));
    expect(() => resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend' } }, [])).toThrow(
      /Missing.*undeclared/,
    );
  });

  it('rejects duplicate registry identities, local builtin collisions, and unknown builtin IDs', () => {
    const { file } = definitionFile();
    const definition = IntegrationDefinitionSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    definition.integration.probe.executable = process.execPath;
    expect(() =>
      resolveIntegrationDefinition({ id: 'local-test', inputs: { backend: 'backend' } }, [definition, definition]),
    ).toThrow(/Ambiguous/);
    expect(() =>
      resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend' } }, [definition]),
    ).toThrow(/conflicts/);
    expect(() => resolveIntegrationDefinition({ id: 'codegraph' })).toThrow(/Unknown integration definition/);
    expect(
      resolveIntegrationDefinition({ id: 'local-test', inputs: { backend: 'backend' } }, [definition]).integration.probe
        .executable,
    ).toBe(process.execPath);
  });

  it('rejects conflicting inline/named selections and affected tools without granting definition actions', () => {
    const { file } = definitionFile();
    const definition = IntegrationDefinitionSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    const selection = { id: 'local-test', file, inputs: { backend: 'backend' } };
    expect(() =>
      validatePreparationConfig({
        adapter: 'configured-command',
        definition: selection,
        integration: definition.integration,
        allowedActions: [],
      }),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      validatePreparationConfig({
        adapter: 'configured-command',
        definition: selection,
        affectedTools: 'all',
        allowedActions: [],
      }),
    ).toThrow(/affectedTools conflicts/);
    expect(
      validatePreparationConfig({ adapter: 'configured-command', definition: selection, allowedActions: [] })
        .allowedActions,
    ).toEqual([]);
  });

  it('bounds aggregate helper reads instead of allowing each file a large separate budget', () => {
    const { file, directory } = definitionFile();
    fs.writeFileSync(path.join(directory, 'one.py'), Buffer.alloc(600 * 1024));
    fs.writeFileSync(path.join(directory, 'two.py'), Buffer.alloc(600 * 1024));
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    definition.helperFiles = ['./one.py', './two.py'];
    fs.writeFileSync(file, JSON.stringify(definition));
    expect(() => resolveIntegrationDefinition({ id: 'local-test', file, inputs: { backend: 'backend' } })).toThrow(
      /totaling no more than 1 MiB/,
    );
  });
});
