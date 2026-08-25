import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { mcpServerConfigSchema, transportConfigSchema } from './transport.js';

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
