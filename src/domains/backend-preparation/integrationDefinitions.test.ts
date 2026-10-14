import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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
