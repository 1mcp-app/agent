import type { MCPServerParams } from '@src/core/types/index.js';

import { describe, expect, it } from 'vitest';

import { filterDisabledTools, getDisabledTools, isToolDisabled, withToolDisabledState } from './disabledTools.js';

describe('disabledTools helpers', () => {
  it('normalizes disabled tool names and removes duplicates', () => {
    const disabledTools = getDisabledTools({
      disabledTools: [' read_file ', 'write_file', 'read_file', ''],
    });

    expect(disabledTools).toEqual(['read_file', 'write_file']);
  });

  it('checks disabled state by logical server name', () => {
    const serverConfigs: Record<string, MCPServerParams> = {
      filesystem: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['write_file'],
      },
    };

    expect(isToolDisabled(serverConfigs, 'filesystem', 'write_file')).toBe(true);
    expect(isToolDisabled(serverConfigs, 'filesystem', 'read_file')).toBe(false);
    expect(isToolDisabled(serverConfigs, 'missing', 'write_file')).toBe(false);
  });

  it('filters disabled tools from a tool list', () => {
    const serverConfigs: Record<string, MCPServerParams> = {
      filesystem: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['write_file'],
      },
    };

    const filtered = filterDisabledTools(
      [
        { name: 'read_file', description: 'Read file', inputSchema: { type: 'object' } },
        { name: 'write_file', description: 'Write file', inputSchema: { type: 'object' } },
      ],
      serverConfigs,
      'filesystem',
    );

    expect(filtered.map((tool) => tool.name)).toEqual(['read_file']);
  });

  it('adds and removes disabled tools without leaving empty arrays behind', () => {
    const baseConfig: MCPServerParams = {
      type: 'stdio',
      command: 'node',
    };

    const disabled = withToolDisabledState(baseConfig, 'write_file', true);
    expect(disabled.disabledTools).toEqual(['write_file']);

    const reenabled = withToolDisabledState(disabled, 'write_file', false);
    expect(reenabled.disabledTools).toBeUndefined();
  });
});
