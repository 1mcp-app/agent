import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { generateMcpConfigSchema } from '../../../docs/site/.vitepress/utils/configSchemaGen.js';
import { mcpServerConfigSchema, oAuthConfigSchema, transportConfigSchema } from './transport.js';

describe('OAuth compatibility configuration', () => {
  it('defaults to strict metadata and no private-origin approval', () => {
    expect(oAuthConfigSchema.parse({})).toEqual({});
    expect(
      oAuthConfigSchema.parse({
        insecureAllowIncompleteMetadata: true,
        privateNetworkOrigins: ['https://ha.example/'],
      }),
    ).toEqual({
      insecureAllowIncompleteMetadata: true,
      privateNetworkOrigins: ['https://ha.example/'],
    });
  });
  it.each([
    'http://ha.example',
    'https://ha.example/path',
    'https://ha.example?x=1',
    'https://ha.example#fragment',
    'https://user:pass@ha.example',
    'https://*.example',
    'https://ha.example\\path',
  ])('rejects unsafe private-origin configuration %s', (origin) => {
    expect(oAuthConfigSchema.safeParse({ privateNetworkOrigins: [origin] }).success).toBe(false);
  });
});

describe.each([
  [
    'published',
    JSON.parse(
      readFileSync(new URL('../../../docs/site/public/schemas/v1.0.0/mcp-config.json', import.meta.url), 'utf8'),
    ),
  ],
  ['generated', generateMcpConfigSchema(transportConfigSchema, mcpServerConfigSchema)],
])('%s project target schema', (_name, schema) => {
  const validator = new Ajv({ strict: false });
  addFormats.default(validator);
  const validate = validator.compile(schema);

  it('publishes the independent metadata and network opt-ins with runtime-equivalent validation', () => {
    for (const oauth of [
      { insecureAllowIncompleteMetadata: true, privateNetworkOrigins: ['https://private.example'] },
      { insecureAllowIncompleteMetadata: 'true' },
      { privateNetworkOrigins: ['http://private.example'] },
      { privateNetworkOrigins: ['https://private.example/path'] },
      { privateNetworkOrigins: ['https://*.example'] },
    ]) {
      const config = { mcpServers: { backend: { type: 'http', url: 'https://private.example/mcp', oauth } } };
      expect(validate(config), JSON.stringify(oauth)).toBe(mcpServerConfigSchema.safeParse(config).success);
    }
  });

  it.each(['instructionTemplates', 'publishedInstructionTemplates'] as const)(
    'matches runtime protected identities and permissive template input for %s',
    (field) => {
      for (const [identity, extra] of [
        ['default', false],
        ['team', false],
        ['team', true],
      ] as const) {
        const config = {
          mcpServers: {},
          [field]: { [identity]: { initialization: 'init', cli: 'cli', ...(extra ? { extra: 'stripped' } : {}) } },
        };
        expect(validate(config), JSON.stringify(config)).toBe(mcpServerConfigSchema.safeParse(config).success);
      }
    },
  );

  it.each(['mcpServers', 'mcpTemplates'] as const)(
    'represents native Windows absolute definition paths for %s',
    (source) => {
      for (const file of [
        String.raw`C:\defs\recipe.json`,
        'C:/defs/recipe.json',
        String.raw`\server\share\recipe.json`,
        String.raw`\defs\recipe.json`,
        '/defs/recipe.json',
        String.raw`C:defs\recipe.json`,
        './recipe.json',
        'https://host/recipe.json',
      ]) {
        const config = {
          mcpServers: {},
          [source]: {
            backend: {
              command: 'node',
              preparation: {
                adapter: 'configured-command',
                definition: { id: 'native-test', file },
                allowedActions: [],
              },
            },
          },
        };
        expect(validate(config), file).toBe(path.win32.isAbsolute(file));
        expect(mcpServerConfigSchema.safeParse(config).success, file).toBe(path.isAbsolute(file));
      }
    },
  );

  it.each(['mcpServers', 'mcpTemplates'] as const)('matches runtime logical override names for %s', (field) => {
    for (const name of ['search', ' search', 'search ', '\tsearch', 'search\n', 'two words', '']) {
      const config = {
        mcpServers: {},
        [field]: { backend: { command: 'node', toolDescriptionOverrides: { [name]: 'text' } } },
      };
      expect(validate(config), JSON.stringify(name)).toBe(mcpServerConfigSchema.safeParse(config).success);
    }
  });

  it('preserves configured preparation authority in published and generated schemas', () => {
    const integration = {
      probe: { executable: '/installed/probe', args: ['{checkout}', '{operation}'] },
      readinessExitCodes: { '0': { state: 'ready' } },
      actions: {},
      containment: 'posix-process-group',
    };
    for (const preparation of [
      { adapter: 'configured-command', affectedTools: 'all', allowedActions: [] },
      { adapter: 'configured-command', affectedTools: ['lookup'], allowedActions: ['initialize'], integration },
      {
        adapter: 'configured-command',
        definition: { id: 'native-test' },
        activation: 'setup',
        allowedActions: ['initialize'],
      },
      {
        adapter: 'configured-command',
        definition: { id: 'native-test', file: '/installed/definition.json', inputs: { backend: 'installed' } },
        enabled: false,
        allowedActions: [],
      },
      { adapter: 'configured-command', definition: { id: 'native-test' }, integration, allowedActions: [] },
      { adapter: 'configured-command', integration, allowedActions: [] },
      { adapter: 'configured-command', affectedTools: 'all', activation: 'setup', allowedActions: [] },
      { adapter: 'configured-command', definition: { id: 'native-test', file: './relative.json' }, allowedActions: [] },
      { adapter: 'configured-command', affectedTools: [], allowedActions: [] },
      {
        adapter: 'configured-command',
        affectedTools: 'all',
        allowedActions: [],
        integration: { ...integration, readinessExitCodes: { '300': { state: 'ready' } } },
      },
      {
        adapter: 'codegraph',
        executable: '/installed/codegraph',
        expectedVersion: '1.6.2',
        allowedActions: ['initialize'],
      },
    ]) {
      const config = { mcpServers: { backend: { command: 'node', preparation } } };
      expect(validate(config), JSON.stringify(preparation)).toBe(mcpServerConfigSchema.safeParse(config).success);
    }
  });

  it.each(['mcpServers', 'mcpTemplates'] as const)('matches runtime target validation for %s', (source) => {
    for (const projectTarget of [
      { mode: 'native-set' },
      { mode: 'native-set', argument: '' },
      { mode: 'native-set', argument: 'projects' },
      { mode: 'single' },
      { mode: 'independent' },
      { mode: 'single', argument: 'project' },
      { mode: 'independent', argument: 'project' },
      { mode: 'single', argument: '' },
      { mode: 'native-set', argument: 1 },
      { mode: 'native-set', argument: 'projects', extra: true },
      { mode: 'single', extra: true },
    ]) {
      const config = { mcpServers: {}, [source]: { backend: { command: 'node', projectTarget } } };
      expect(validate(config), JSON.stringify(projectTarget)).toBe(mcpServerConfigSchema.safeParse(config).success);
    }
  });
});

describe('transportConfigSchema stderr', () => {
  it.each(['inherit', 'ignore', 'overlapped', 'pipe'] as const)('accepts %s', (stderr) => {
    expect(transportConfigSchema.parse({ type: 'stdio', command: 'node', stderr }).stderr).toBe(stderr);
  });

  it('accepts a numeric file descriptor', () => {
    expect(transportConfigSchema.parse({ type: 'stdio', command: 'node', stderr: 2 }).stderr).toBe(2);
  });

  it('rejects unsupported stderr strings', () => {
    expect(() => transportConfigSchema.parse({ type: 'stdio', command: 'node', stderr: 'verbose' })).toThrow();
  });
});

describe('transportConfigSchema protocol version', () => {
  it.each(['auto', 'legacy', '2026-07-28'] as const)('accepts %s', (protocolVersion) => {
    expect(transportConfigSchema.parse({ command: 'node', protocolVersion })).toMatchObject({ protocolVersion });
  });

  it('preserves omission so runtime negotiation owns the default', () => {
    expect(transportConfigSchema.parse({ command: 'node' })).not.toHaveProperty('protocolVersion');
  });

  it('rejects unsupported pins', () => {
    expect(() => transportConfigSchema.parse({ command: 'node', protocolVersion: '2025-11-25' })).toThrow();
  });
});

describe('transportConfigSchema restart policy', () => {
  it('rejects a fractional maxRestarts value', () => {
    expect(() => transportConfigSchema.parse({ type: 'stdio', command: 'node', maxRestarts: 1.5 })).toThrow();
  });
});

describe('transportConfigSchema template pool compatibility', () => {
  it('continues accepting legacy non-negative per-template values', () => {
    const config = transportConfigSchema.parse({
      type: 'stdio',
      command: 'node',
      template: { maxInstances: 10000.5, idleTimeout: 2_592_000_000 },
    });

    expect(config.template).toMatchObject({ maxInstances: 10000.5, idleTimeout: 2_592_000_000 });
  });
});

describe('transportConfigSchema URL JSON schema', () => {
  it('publishes the same URI-or-environment-reference alternatives accepted at runtime', () => {
    const jsonSchema = z.toJSONSchema(transportConfigSchema, {
      target: 'draft-7',
      io: 'input',
      unrepresentable: 'any',
    });
    const urlSchema = (jsonSchema.properties as Record<string, Record<string, unknown>>).url;

    expect(urlSchema.anyOf).toEqual(
      expect.arrayContaining([
        { type: 'string', format: 'uri' },
        { type: 'string', pattern: '\\$\\{[^}]+\\}|\\$[A-Za-z_][A-Za-z0-9_]*' },
      ]),
    );
  });
});

describe('instruction management configuration', () => {
  it('structurally preserves invalid managed template drafts and their active identity', () => {
    const config = mcpServerConfigSchema.parse({
      mcpServers: {},
      instructionTemplates: {
        draft: {
          initialization: '{{#if broken}}',
          cli: '{{missing closing braces',
        },
      },
      activeInstructionTemplate: 'draft',
    });

    expect(config.instructionTemplates).toEqual({
      draft: {
        initialization: '{{#if broken}}',
        cli: '{{missing closing braces',
      },
    });
    expect(config.activeInstructionTemplate).toBe('draft');
  });

  it('preserves an optional published snapshot independently from its draft', () => {
    const config = mcpServerConfigSchema.parse({
      mcpServers: {},
      instructionTemplates: { team: { initialization: 'draft init', cli: 'draft cli' } },
      publishedInstructionTemplates: { team: { initialization: 'published init', cli: 'published cli' } },
      activeInstructionTemplate: 'team',
    });

    expect(config.publishedInstructionTemplates).toEqual({
      team: { initialization: 'published init', cli: 'published cli' },
    });
  });

  it('rejects redefining the protected default or selecting a missing managed template', () => {
    expect(() =>
      mcpServerConfigSchema.parse({
        mcpServers: {},
        instructionTemplates: { default: { initialization: 'custom', cli: 'custom' } },
      }),
    ).toThrow(/protected default/);
    expect(() =>
      mcpServerConfigSchema.parse({
        mcpServers: {},
        publishedInstructionTemplates: { default: { initialization: 'custom', cli: 'custom' } },
      }),
    ).toThrow(/protected default/);
    expect(() => mcpServerConfigSchema.parse({ mcpServers: {}, activeInstructionTemplate: 'missing' })).toThrow(
      /must reference/,
    );
  });

  it.each(['mcpServers', 'mcpTemplates'] as const)(
    'preserves absent, empty, and non-empty instruction overrides in %s',
    (source) => {
      const config = mcpServerConfigSchema.parse({
        mcpServers: source === 'mcpServers' ? { upstream: { command: 'node' } } : {},
        ...(source === 'mcpTemplates'
          ? { mcpTemplates: { suppressed: { command: '{{command}}', instructionOverride: '' } } }
          : {}),
      });

      const targets = config[source]!;
      const targetName = source === 'mcpServers' ? 'upstream' : 'suppressed';
      expect(Object.hasOwn(targets[targetName], 'instructionOverride')).toBe(source === 'mcpTemplates');
      if (source === 'mcpTemplates') expect(targets[targetName].instructionOverride).toBe('');

      const replaced = mcpServerConfigSchema.parse({
        mcpServers: {},
        [source]: { replaced: { command: 'node', instructionOverride: 'Use this server literally.' } },
      });
      expect(replaced[source]?.replaced.instructionOverride).toBe('Use this server literally.');
    },
  );
});

describe('transportConfigSchema tool description overrides', () => {
  it('rejects logical tool names with surrounding whitespace', () => {
    expect(() =>
      transportConfigSchema.parse({
        toolDescriptionOverrides: { ' search ': 'first', search: 'second' },
      }),
    ).toThrow();
  });
});

describe('named preparation selection', () => {
  it('accepts named definitions without requiring handwritten affected tools', () => {
    expect(
      transportConfigSchema.safeParse({
        preparation: {
          adapter: 'configured-command',
          definition: { id: 'codegraph' },
          activation: 'setup',
          allowedActions: ['initialize', 'sync'],
        },
      }).success,
    ).toBe(true);
  });
});
