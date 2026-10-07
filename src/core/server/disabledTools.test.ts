import { buildCatalogGeneration } from '@src/core/capabilities/catalogGeneration.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import { toProtocolTool } from '@src/sdk/contracts/index.js';
import { buildPublicToolName } from '@src/utils/core/toolNames.js';

import { describe, expect, it } from 'vitest';

import {
  filterDisabledTools,
  getDisabledToolError,
  getDisabledToolMessage,
  getDisabledTools,
  isSourceToolDisabled,
  isToolDisabled,
  normalizeDisabledToolsForServer,
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
    expect(qualified.disabledTools).toEqual(['filesystem_1mcp_write_file']);

    const reenabledQualified = withToolDisabledState(qualified, 'filesystem_1mcp_write_file', false, 'filesystem');
    expect(reenabledQualified.disabledTools).toBeUndefined();
  });

  it.each(['raw', 'qualified', 'public'] as const)(
    'applies %s disabled references to compact tools using exact source provenance',
    (referenceKind) => {
      const server = 'files';
      const name = `files_1mcp_${'x'.repeat(80)}`;
      const publicIdentity = buildPublicToolName(server, name);
      const references = { raw: name, qualified: `${server}_1mcp_${name}`, public: publicIdentity };
      const configs = {
        [server]: { type: 'stdio' as const, command: 'node', disabledTools: [references[referenceKind]] },
      };
      const entry = buildCatalogGeneration(1, [
        { kind: 'tools', server, connectionKey: server, object: { name, inputSchema: { type: 'object' } } },
      ]).entries[0];
      expect(isSourceToolDisabled(configs, server, name)).toBe(true);
      expect(filterDisabledTools([toProtocolTool(entry.publicObject)], configs, server)).toEqual([]);
      if (referenceKind === 'public')
        expect(isSourceToolDisabled(configs, server, name.slice(`${server}_1mcp_`.length))).toBe(false);
    },
  );

  it('preserves compact config references and enables them by either raw or public identity', () => {
    const server = 'files';
    const name = 'x'.repeat(80);
    const publicIdentity = buildPublicToolName(server, name);
    const base: MCPServerParams = { type: 'stdio', command: 'node' };
    const disabled = withToolDisabledState(base, publicIdentity, true, server);
    expect(disabled.disabledTools).toEqual([publicIdentity]);
    expect(getDisabledToolMessage(server, publicIdentity)).toContain(`tools enable ${server} ${publicIdentity}`);
    expect(normalizeDisabledToolsForServer(server, [` ${publicIdentity} `, publicIdentity])).toEqual([publicIdentity]);
    expect(isToolDisabled({ [server]: disabled }, server, name)).toBe(true);
    expect(withToolDisabledState(disabled, name, false, server).disabledTools).toBeUndefined();
    expect(withToolDisabledState(disabled, publicIdentity, false, server).disabledTools).toBeUndefined();
    const rawDisabled = withToolDisabledState(base, name, true, server);
    expect(isToolDisabled({ [server]: rawDisabled }, server, publicIdentity)).toBe(true);
    expect(withToolDisabledState(rawDisabled, publicIdentity, false, server).disabledTools).toBeUndefined();
  });
});
