import type { MCPServerParams } from '@src/core/types/index.js';

import { describe, expect, it } from 'vitest';

import {
  filterDisabledTools,
  getDisabledToolError,
  getDisabledToolMessage,
  getDisabledTools,
  isToolDisabled,
  withToolDisabledState,
} from './disabledTools.js';

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

  it('matches disabled tools by raw and qualified names for the same server', () => {
    const serverConfigs: Record<string, MCPServerParams> = {
      runner: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['echo_args'],
      },
      qualified: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['qualified_1mcp_write_file'],
      },
    };

    expect(isToolDisabled(serverConfigs, 'runner', 'runner_1mcp_echo_args')).toBe(true);
    expect(isToolDisabled(serverConfigs, 'qualified', 'write_file')).toBe(true);
    expect(
      filterDisabledTools(
        [{ name: 'runner_1mcp_echo_args' }, { name: 'runner_1mcp_emit_text' }],
        serverConfigs,
        'runner',
      ),
    ).toEqual([{ name: 'runner_1mcp_emit_text' }]);
  });

  it('builds a shared disabled-tool error payload', () => {
    const serverConfigs: Record<string, MCPServerParams> = {
      filesystem: {
        type: 'stdio',
        command: 'node',
        disabledTools: ['write_file'],
      },
    };

    expect(getDisabledToolMessage('filesystem', 'write_file')).toContain('Tool is disabled: filesystem:write_file');
    expect(getDisabledToolError(serverConfigs, 'filesystem', 'write_file')).toEqual({
      type: 'not_found',
      message:
        "Tool is disabled: filesystem:write_file. Use '1mcp mcp tools enable filesystem write_file' to re-enable it.",
    });
    expect(getDisabledToolError(serverConfigs, 'filesystem', 'read_file')).toBeUndefined();
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

    const qualified = withToolDisabledState(baseConfig, 'filesystem_1mcp_write_file', true, 'filesystem');
    expect(qualified.disabledTools).toEqual(['write_file']);

    const reenabledQualified = withToolDisabledState(qualified, 'filesystem_1mcp_write_file', false, 'filesystem');
    expect(reenabledQualified.disabledTools).toBeUndefined();
  });
});
