import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { describe, expect, it } from 'vitest';

import {
  applyEffectiveToolDescription,
  getEffectiveToolDescription,
  withToolDescriptionOverride,
} from './toolDescriptionOverrides.js';

describe('tool description overrides', () => {
  const config = {
    type: 'stdio' as const,
    command: 'node',
    toolDescriptionOverrides: {
      read_file: 'Read a workspace file safely',
    },
  };

  it('resolves override-first descriptions by logical or qualified tool name', () => {
    expect(getEffectiveToolDescription(config, 'filesystem', 'read_file', 'Upstream description')).toBe(
      'Read a workspace file safely',
    );
    expect(getEffectiveToolDescription(config, 'filesystem', 'filesystem_1mcp_read_file', 'Upstream description')).toBe(
      'Read a workspace file safely',
    );
    expect(getEffectiveToolDescription(config, 'filesystem', 'write_file', 'Write upstream')).toBe('Write upstream');
  });

  it('changes only the tool description', () => {
    const upstream: Tool = {
      name: 'read_file',
      description: 'Upstream description',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { content: { type: 'string' } } },
      annotations: { readOnlyHint: true },
    };

    expect(applyEffectiveToolDescription(upstream, config, 'filesystem')).toEqual({
      ...upstream,
      description: 'Read a workspace file safely',
    });
  });

  it('removes blank overrides and omits the empty record', () => {
    expect(withToolDescriptionOverride(config, 'read_file', '   ').toolDescriptionOverrides).toBeUndefined();
    expect(withToolDescriptionOverride(config, 'write_file', ' Write a file ')).toMatchObject({
      toolDescriptionOverrides: {
        read_file: 'Read a workspace file safely',
        write_file: 'Write a file',
      },
    });
  });
});
