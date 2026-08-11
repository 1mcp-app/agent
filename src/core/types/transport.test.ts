import { describe, expect, it } from 'vitest';

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

  it('rejects redefining the protected default or selecting a missing managed template', () => {
    expect(() =>
      mcpServerConfigSchema.parse({
        mcpServers: {},
        instructionTemplates: { default: { initialization: 'custom', cli: 'custom' } },
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
